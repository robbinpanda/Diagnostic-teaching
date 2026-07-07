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


SYSTEM_PROMPT = """你是一个面向中国初高中学生的诊断式数学答疑老师。
你的目标不是从头完整讲题，而是先判断学生卡在哪里，再从断点附近推进。

强规则：
1. 如果需要检测学生是否跟上，生成和题目强相关的选择题检查点，不要问“你懂了吗”。
2. 检查点必须有 3 个选项，且恰好 1 个正确、2 个错误；错误选项要对应常见误区。
3. 单次讲解只讲一个关键点，避免长篇标准答案。
4. 学生选“我不知道”不是失败，要降低难度或讲原理。
5. 输出必须是 JSON，不能包裹 markdown。
6. message 必须是非空中文，必须能直接展示给学生，不能写 JSON 说明文字。
7. 不要在内部做冗长的思考过程，直接产出最终 JSON；宁可简洁也不要长时间不出字。
"""


JSON_CONTRACT = """返回 JSON 格式：
{
  "phase": "diagnosing|scaffolding|explaining|checking|recovering|summarizing",
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
"""


def build_messages(session: Row, history: list[Row]) -> list[dict[str, str]]:
    history_text = "\n".join(render_history_row(row) for row in history)
    user_prompt = f"""题目：
{session['problem_text']}

学生初始思路：
{session['student_initial_thought'] or '学生还没有提供明确思路'}

当前阶段：{session['phase']}
历史对话：
{history_text or '暂无'}

请决定下一步教学动作。记住：如果讲解已经涉及关键跳步，优先生成一个选择题检查点。
{JSON_CONTRACT}
"""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def render_history_row(row: Row) -> str:
    role = row["role"]
    content = row["content"]
    if role == "assistant" and ('```json' in content[:30] or '"phase"' in content[:200]):
        content = recover_tutor_turn_from_raw(content).message
    return f"{role}: {content}"


def extract_json_object(content: str) -> dict:
    text = strip_code_fence(content)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def strip_code_fence(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    return text


def _json_string_field(text: str, field: str) -> str | None:
    match = re.search(rf'"{re.escape(field)}"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
    if not match:
        return None
    raw_value = match.group(1)
    try:
        return json.loads(f'"{raw_value}"')
    except json.JSONDecodeError:
        return raw_value.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")


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
        looks_like_json = text.lstrip().startswith("{") or '"phase"' in text or '"action"' in text
        message = "" if looks_like_json else sanitize_visible_message(text[:800])

    if not message:
        message = "这一轮模型返回的格式不完整。我先接着当前题目往下讲：你刚才的选择已经说明等比数列中可以用中项性质，下一步要把它和方程两个根的乘积联系起来。"

    action = _json_string_field(text, "action") or "EXPLAIN_LOCAL"
    if action == "SHOW_CHECKPOINT_MC":
        action = "EXPLAIN_LOCAL"
    return TutorTurn(
        phase=_json_string_field(text, "phase") or "explaining",
        action=action,
        message=message,
        breakpoint_description=_json_string_field(text, "breakpoint_description"),
        breakpoint_confidence=_json_number_field(text, "breakpoint_confidence"),
        checkpoint=None,
        debug={"parse_fallback": True},
    )


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


async def generate_tutor_turn(
    profile: LlmProfile,
    session: Row,
    history: list[Row],
    *,
    logger: SessionLogger | None = None,
) -> TutorTurn:
    messages = build_messages(session, history)
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
    messages = build_messages(session, history)
    started = time.perf_counter()
    extractor = MessageStreamExtractor()
    raw_parts: list[str] = []
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
