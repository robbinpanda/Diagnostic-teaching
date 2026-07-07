from __future__ import annotations

import json
import re
from sqlite3 import Row

from pydantic import ValidationError

from app.core.schemas import TutorCheckpoint, TutorTurn
from app.llm.provider import LlmProfile, chat_completion


SYSTEM_PROMPT = """你是一个面向中国初高中学生的诊断式数学答疑老师。
你的目标不是从头完整讲题，而是先判断学生卡在哪里，再从断点附近推进。

强规则：
1. 如果需要检测学生是否跟上，生成和题目强相关的选择题检查点，不要问“你懂了吗”。
2. 检查点必须有 3 个选项，且恰好 1 个正确、2 个错误；错误选项要对应常见误区。
3. 单次讲解只讲一个关键点，避免长篇标准答案。
4. 学生选“我不知道”不是失败，要降低难度或讲原理。
5. 输出必须是 JSON，不能包裹 markdown。
6. message 必须是非空中文，必须能直接展示给学生，不能写 JSON 说明文字。
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


async def generate_tutor_turn(profile: LlmProfile, session: Row, history: list[Row]) -> TutorTurn:
    raw = await chat_completion(profile, build_messages(session, history), max_tokens=max(profile.max_output_tokens, 2000))
    try:
        payload = extract_json_object(raw)
        turn = TutorTurn.model_validate(payload)
    except (json.JSONDecodeError, ValidationError, ValueError):
        return recover_tutor_turn_from_raw(raw)
    turn.message = sanitize_visible_message(turn.message)
    if not turn.message:
        return recover_tutor_turn_from_raw(raw)
    if turn.checkpoint:
        try:
            validate_checkpoint(turn.checkpoint)
        except ValueError:
            turn.debug["checkpoint_removed"] = True
            turn.checkpoint = None
            if turn.action == "SHOW_CHECKPOINT_MC":
                turn.action = "EXPLAIN_LOCAL"
    return turn
