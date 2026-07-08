from __future__ import annotations

import json
import re
import time
from sqlite3 import Row
from typing import Any, AsyncIterator

from pydantic import ValidationError

from app.core.schemas import TutorCheckpoint, TutorTurn
from app.core.streaming import MessageStreamExtractor
from app.llm.provider import LlmProfile, LlmProviderError, chat_completion, chat_stream_completion
from app.storage.session_logger import SessionLogger


BLOCKING_ACTIONS = {"ASK_OPEN_QUESTION", "SHOW_CHECKPOINT_MC"}
NONBLOCKING_ACTIONS = {"DECOMPOSE_STEP", "EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE", "RESPOND_TO_CHECKPOINT"}
TERMINAL_ACTIONS = {"SUMMARIZE"}
VALID_ACTIONS = BLOCKING_ACTIONS | NONBLOCKING_ACTIONS | TERMINAL_ACTIONS


SYSTEM_PROMPT = """你是一个面向中国初高中学生的诊断式数学答疑老师。
你的目标不是从头完整讲题，而是先判断学生卡在哪里，再从断点附近推进。

强规则：
1. 每一轮只输出一个教学原子动作。讲解类动作只讲一个关键点，不要同时承担检查职责。
2. 检查点必须有 3 个选项，且恰好 1 个正确、2 个错误；错误选项要对应常见误区。
3. 如果要等待学生，只能选择 ASK_OPEN_QUESTION 或 SHOW_CHECKPOINT_MC；SHOW_CHECKPOINT_MC 必须带 checkpoint。
4. 学生选“我不知道”不是失败，要降低难度或讲原理。
5. 输出必须是 JSON，不能包裹 markdown。
6. message 必须是非空中文，必须能直接展示给学生，不能写 JSON 说明文字。
7. 不要在内部做冗长的思考过程，直接产出最终 JSON；宁可简洁也不要长时间不出字。
"""


JSON_CONTRACT = """返回 JSON 格式：
{
  "state_hint": "diagnosing|scaffolding|explaining|checking|recovering|summarizing",
  "action": "ASK_OPEN_QUESTION|SHOW_CHECKPOINT_MC|DECOMPOSE_STEP|EXPLAIN_LOCAL|EXPLAIN_PRINCIPLE|RESPOND_TO_CHECKPOINT|SUMMARIZE",
  "message": "给学生看的中文内容",
  "breakpoint_description": "当前卡点，可为 null",
  "breakpoint_confidence": 0.0,
  "checkpoint": null 或 {
    "type": "checkpoint_mc",
    "question": "一个和当前题目强相关的小问题",
    "options": [
      {"id": "A", "text": "...", "is_correct": true, "misconception": null},
      {"id": "B", "text": "...", "is_correct": false, "misconception": "..."},
      {"id": "C", "text": "...", "is_correct": false, "misconception": "..."}
    ],
    "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
    "tested_point": "这个检查点测试的知识点",
    "difficulty": "easy"
  },
  "debug": {}
}

说明：
- state_hint 只是教学状态提示，不是流程控制器。
- action 是本轮唯一教学动作。
- 不要输出 wait_for_student；后端会根据 action 强制填充。
- 只有 ASK_OPEN_QUESTION 和 SHOW_CHECKPOINT_MC 会等待学生。
- DECOMPOSE_STEP / EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE / RESPOND_TO_CHECKPOINT 是非阻塞动作，后端会继续调用下一轮。
"""


def build_messages(
    session: Row,
    history: list[Row],
    *,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> list[dict[str, str]]:
    history_text = "\n".join(render_history_row(row) for row in history)
    loop_instruction = (
        "本轮已经连续执行了 3 个非阻塞教学动作；你必须选择 ASK_OPEN_QUESTION 或 SHOW_CHECKPOINT_MC，"
        "让学生回答后再继续。若选择 SHOW_CHECKPOINT_MC，必须提供合法 checkpoint。"
        if force_blocking
        else f"当前连续非阻塞动作数：{nonblocking_streak}/3。若还只是在讲解，可以选择非阻塞动作；若需要学生参与，请选择 ASK_OPEN_QUESTION 或 SHOW_CHECKPOINT_MC。"
    )
    user_prompt = f"""题目：
{session['problem_text']}

学生初始思路：
{session['student_initial_thought'] or '学生还没有提供明确思路'}

当前状态提示：{session['phase']}
历史对话：
{history_text or '暂无'}

请决定下一步教学动作。
{loop_instruction}
{JSON_CONTRACT}
"""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def render_history_row(row: Row) -> str:
    role = row["role"]
    content = row["content"]
    if role == "assistant" and (
        '```json' in content[:30] or '"phase"' in content[:200] or '"state_hint"' in content[:200]
    ):
        content = recover_tutor_turn_from_raw(content).message
    return f"{role}: {content}"


def extract_json_object(content: str) -> dict:
    text = strip_code_fence(content)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        repaired = repair_unescaped_string_field(text, "message")
        if repaired != text:
            return json.loads(repaired)
        raise


def strip_code_fence(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    return text


def _decode_json_string_lenient(raw_value: str) -> str:
    try:
        return json.loads(f'"{raw_value}"')
    except json.JSONDecodeError:
        pass

    def replace_escape(match: re.Match[str]) -> str:
        escape = match.group(1)
        if escape.startswith("u") and len(escape) == 5:
            try:
                return chr(int(escape[1:], 16))
            except ValueError:
                return "\\" + escape
        return {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "b": "\b",
            "f": "\f",
        }.get(escape, "\\" + escape)

    return re.sub(r"\\(u[0-9a-fA-F]{4}|[\"\\/nrtbf])", replace_escape, raw_value)


def repair_unescaped_string_field(text: str, field: str) -> str:
    key_match = re.search(rf'("{re.escape(field)}"\s*:\s*)"', text, re.DOTALL)
    if not key_match:
        return text

    value_start = key_match.end()
    next_field = re.search(
        r'"\s*,\s*"(?:state_hint|phase|action|message|breakpoint_description|breakpoint_confidence|checkpoint|wait_for_student|debug)"\s*:',
        text[value_start:],
        re.DOTALL,
    )
    if not next_field:
        return text

    value_end_quote = value_start + next_field.start()
    raw_value = text[value_start:value_end_quote]
    repaired_value = json.dumps(_decode_json_string_lenient(raw_value), ensure_ascii=False)
    return text[: key_match.start()] + key_match.group(1) + repaired_value + text[value_end_quote + 1 :]


def _json_string_field(text: str, field: str) -> str | None:
    match = re.search(rf'"{re.escape(field)}"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
    if match:
        after_value = text[match.end() :].lstrip()
        if re.match(r"^[,}\]]", after_value):
            raw_value = match.group(1)
            try:
                return json.loads(f'"{raw_value}"')
            except json.JSONDecodeError:
                return _decode_json_string_lenient(raw_value)

    raw_value = _json_string_field_lenient(text, field)
    if raw_value is None:
        return None
    return raw_value


def _json_string_field_lenient(text: str, field: str) -> str | None:
    key_match = re.search(rf'"{re.escape(field)}"\s*:\s*"', text, re.DOTALL)
    if not key_match:
        return None
    value_start = key_match.end()
    next_field = re.search(
        r'"\s*,\s*"(?:state_hint|phase|action|message|breakpoint_description|breakpoint_confidence|checkpoint|wait_for_student|debug)"\s*:',
        text[value_start:],
        re.DOTALL,
    )
    if next_field:
        raw_value = text[value_start : value_start + next_field.start()]
    else:
        match = re.search(r'((?:\\.|[^"\\])*)"', text[value_start:], re.DOTALL)
        if not match:
            return None
        raw_value = match.group(1)
    try:
        return json.loads(f'"{raw_value}"')
    except json.JSONDecodeError:
        return _decode_json_string_lenient(raw_value)


def _json_number_field(text: str, field: str) -> float | None:
    match = re.search(rf'"{re.escape(field)}"\s*:\s*([0-9.]+)', text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def sanitize_visible_message(message: str) -> str:
    clean = strip_code_fence(message).strip()
    clean = re.sub(r"\s*来检测一下[:：]?\s*$", "。", clean)
    clean = re.sub(r"\s*下面给你一个检查点[:：]?\s*$", "。", clean)
    return clean.strip()


def recover_tutor_turn_from_raw(raw: str) -> TutorTurn:
    text = strip_code_fence(raw)
    message = _json_string_field(text, "message")
    if message:
        message = sanitize_visible_message(message)
    else:
        looks_like_json = text.lstrip().startswith("{") or '"phase"' in text or '"state_hint"' in text or '"action"' in text
        message = "" if looks_like_json else sanitize_visible_message(text[:800])

    if not message:
        message = "这一轮模型返回的格式不完整。我先接着当前题目往下讲：你刚才的选择已经说明等比数列中可以用中项性质，下一步要把它和方程两个根的乘积联系起来。"

    action = _json_string_field(text, "action") or "EXPLAIN_LOCAL"
    if action == "SHOW_CHECKPOINT_MC":
        action = "EXPLAIN_LOCAL"
    turn = TutorTurn(
        state_hint=_json_string_field(text, "state_hint") or _json_string_field(text, "phase") or "explaining",
        action=action,
        message=message,
        breakpoint_description=_json_string_field(text, "breakpoint_description"),
        breakpoint_confidence=_json_number_field(text, "breakpoint_confidence"),
        checkpoint=None,
        debug={"parse_fallback": True},
    )
    apply_backend_action_policy(turn)
    return turn


def validate_checkpoint(checkpoint: TutorCheckpoint) -> None:
    if len(checkpoint.options) != 3:
        raise ValueError("checkpoint must have exactly 3 options")
    correct = [option for option in checkpoint.options if option.is_correct]
    if len(correct) != 1:
        raise ValueError("checkpoint must have exactly one correct option")
    for option in checkpoint.options:
        if not option.is_correct and not option.misconception:
            raise ValueError("wrong options must include misconception")
    blocked = ["懂了吗", "听懂了吗", "跟上了吗", "理解了吗"]
    if any(word in checkpoint.question for word in blocked):
        raise ValueError("checkpoint question is too meta")


def apply_backend_action_policy(turn: TutorTurn, *, force_blocking: bool = False) -> None:
    original_action = turn.action
    if turn.action not in VALID_ACTIONS:
        turn.debug["invalid_action"] = turn.action
        turn.action = "EXPLAIN_LOCAL"

    if turn.checkpoint and turn.action != "SHOW_CHECKPOINT_MC":
        turn.debug["action_corrected_for_checkpoint"] = turn.action
        turn.action = "SHOW_CHECKPOINT_MC"

    if turn.action == "SHOW_CHECKPOINT_MC" and not turn.checkpoint:
        turn.debug["checkpoint_missing_for_show_action"] = True
        turn.action = "EXPLAIN_LOCAL"

    if force_blocking and turn.action in NONBLOCKING_ACTIONS:
        turn.debug["forced_blocking_after_action"] = turn.action
        turn.action = "ASK_OPEN_QUESTION"
        if not re.search(r"[？?]\s*$", turn.message):
            turn.message = turn.message.rstrip("。！？!?") + "。你先说说：这一步你觉得下一步应该做什么？"

    turn.wait_for_student = turn.action in BLOCKING_ACTIONS
    if turn.action == "SHOW_CHECKPOINT_MC" and not turn.checkpoint:
        turn.wait_for_student = False
    if turn.action in TERMINAL_ACTIONS:
        turn.wait_for_student = False

    if original_action != turn.action:
        turn.debug.setdefault("backend_action_policy", True)


async def generate_tutor_turn(
    profile: LlmProfile,
    session: Row,
    history: list[Row],
    *,
    logger: SessionLogger | None = None,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> TutorTurn:
    messages = build_messages(session, history, nonblocking_streak=nonblocking_streak, force_blocking=force_blocking)
    started = time.perf_counter()
    raw = ""
    used_fallback = False
    parse_ok = True
    error: str | None = None
    turn: TutorTurn | None = None
    try:
        raw = await chat_completion(profile, messages, max_tokens=max(profile.max_output_tokens, 2000))
        try:
            payload = extract_json_object(raw)
            turn = TutorTurn.model_validate(payload)
        except (json.JSONDecodeError, ValidationError, ValueError):
            used_fallback = True
            parse_ok = False
            turn = recover_tutor_turn_from_raw(raw)
        else:
            turn.message = sanitize_visible_message(turn.message)
            if not turn.message:
                used_fallback = True
                parse_ok = False
                turn = recover_tutor_turn_from_raw(raw)
        if turn.checkpoint:
            try:
                validate_checkpoint(turn.checkpoint)
            except ValueError:
                turn.debug["checkpoint_removed"] = True
                turn.checkpoint = None
                if turn.action == "SHOW_CHECKPOINT_MC":
                    turn.action = "EXPLAIN_LOCAL"
        apply_backend_action_policy(turn, force_blocking=force_blocking)
        return turn
    except Exception as exc:
        # 不吞 LLM/网络错误：交给 chat 路由的 try/except 转成 SSE error 事件
        error = str(exc)
        raise
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        if logger is not None:
            parsed_dump: dict[str, Any] | None = None
            try:
                parsed_dump = turn.model_dump() if turn is not None else None
                # 完整保留 checkpoint 的 is_correct/misconception 标签，不裁剪
            except Exception:
                parsed_dump = None
            logger.log_tutor_turn(
                session_id=session["id"],
                model_profile_id=profile.id,
                model=profile.model,
                messages=messages,
                raw_response=raw,
                parsed_turn=parsed_dump,
                latency_ms=latency_ms,
                parse_ok=parse_ok,
                used_fallback=used_fallback,
                error=error,
            )


async def generate_tutor_turn_stream(
    profile: LlmProfile,
    session: Row,
    history: list[Row],
    *,
    logger: SessionLogger | None = None,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> AsyncIterator:
    """流式答疑生成器：边从 LLM 收增量边 yield message 可见字符，最后 yield 完整 TutorTurn。

    yield 顺序：
        ("message_delta", "一段可见文本")   多次
        ("turn", TutorTurn)                 最后一次

    可见文本来自 LLM 原始 JSON 中 `"message":"..."` 字段的实时解码字符，
    checkpoint / phase / action 等仍等整段 raw 完整后用 extract_json_object 解析，
    保证结构化字段不被增量解析的边界问题污染。LLM 空响应会抛 LlmProviderError，
    由 chat 路由转成 SSE error 事件，而不是静默断流。
    """
    messages = build_messages(session, history, nonblocking_streak=nonblocking_streak, force_blocking=force_blocking)
    started = time.perf_counter()
    extractor = MessageStreamExtractor()
    raw_parts: list[str] = []
    emitted_message_parts: list[str] = []
    finish_reason: str | None = None
    used_fallback = False
    parse_ok = True
    error: str | None = None
    turn_final: TutorTurn | None = None

    try:
        async for event in chat_stream_completion(profile, messages, max_tokens=max(profile.max_output_tokens, 2000)):
            delta = event.get("delta") or ""
            if delta:
                raw_parts.append(delta)
                inc = extractor.feed(delta)
                if inc:
                    emitted_message_parts.append(inc)
                    yield ("message_delta", inc)
            if event.get("finish_reason"):
                finish_reason = event["finish_reason"]
        raw = "".join(raw_parts)
        # 关键：raw 完整后再做 sanitize + checkpoint 解析，保证结构化字段准确
        message_so_far = extractor.visible_so_far()
        try:
            payload = extract_json_object(raw)
            turn_final = TutorTurn.model_validate(payload)
            turn_final.message = sanitize_visible_message(turn_final.message or message_so_far)
            if not turn_final.message:
                used_fallback = True
                parse_ok = False
                turn_final = recover_tutor_turn_from_raw(raw)
        except (json.JSONDecodeError, ValidationError, ValueError):
            used_fallback = True
            parse_ok = False
            turn_final = recover_tutor_turn_from_raw(raw)
        if turn_final.checkpoint:
            try:
                validate_checkpoint(turn_final.checkpoint)
            except ValueError:
                turn_final.debug["checkpoint_removed"] = True
                turn_final.checkpoint = None
                if turn_final.action == "SHOW_CHECKPOINT_MC":
                    turn_final.action = "EXPLAIN_LOCAL"
        apply_backend_action_policy(turn_final, force_blocking=force_blocking)
        emitted_message = "".join(emitted_message_parts)
        if turn_final.message:
            if not emitted_message:
                yield ("message_delta", turn_final.message)
            elif turn_final.message.startswith(emitted_message):
                missing_suffix = turn_final.message[len(emitted_message) :]
                if missing_suffix:
                    yield ("message_delta", missing_suffix)
        yield ("turn", turn_final)
        return
    except Exception as exc:
        error = str(exc)
        # 不吞错误：交给 chat 路由的 try/except 转成 SSE error 事件。
        # 但如果已经在中途 yield 过 message，前端已能看到部分讲解；
        # 这里仍然把异常 raise 出去，保证主流程按"出错"处理。
        raise
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        if logger is not None:
            parsed_dump: dict[str, Any] | None = None
            try:
                parsed_dump = turn_final.model_dump() if turn_final is not None else None
            except Exception:
                parsed_dump = None
            logger.log_tutor_turn(
                session_id=session["id"],
                model_profile_id=profile.id,
                model=profile.model,
                messages=messages,
                raw_response="".join(raw_parts),
                parsed_turn=parsed_dump,
                latency_ms=latency_ms,
                parse_ok=parse_ok,
                used_fallback=used_fallback,
                error=error,
            )
