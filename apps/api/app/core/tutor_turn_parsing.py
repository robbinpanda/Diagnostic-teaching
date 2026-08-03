from __future__ import annotations

import json
import re
from typing import Any

from app.core.schemas import TutorTurn
from app.core.tutor_turn_policy import (
    VALID_ACTIONS,
    TutorTurnActionError,
    apply_backend_action_policy,
    validate_card_contract,
    validate_checkpoint,
)


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

    return re.sub(r'\\(u[0-9a-fA-F]{4}|["\\/nrtbf])', replace_escape, raw_value)


def repair_unescaped_string_field(text: str, field: str) -> str:
    key_match = re.search(rf'("{re.escape(field)}"\s*:\s*)"', text, re.DOTALL)
    if not key_match:
        return text

    value_start = key_match.end()
    next_field = re.search(
        r'"\s*,\s*"(?:state_hint|phase|action|message|breakpoint_description|breakpoint_confidence|checkpoint|knowledge_card|problem_card|wait_for_student|debug)"\s*:',
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
        r'"\s*,\s*"(?:state_hint|phase|action|message|breakpoint_description|breakpoint_confidence|checkpoint|knowledge_card|problem_card|wait_for_student|debug)"\s*:',
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
    if action in {"ASK_MULTIPLE_CHOICE", "EXPLAIN_PRINCIPLE", "SUMMARIZE"}:
        action = "EXPLAIN_LOCAL"
    turn = TutorTurn(
        state_hint=_json_string_field(text, "state_hint") or _json_string_field(text, "phase") or "explaining",
        action=action,
        message=message,
        breakpoint_description=_json_string_field(text, "breakpoint_description"),
        breakpoint_confidence=_json_number_field(text, "breakpoint_confidence"),
        checkpoint=None,
        knowledge_card=None,
        problem_card=None,
        debug={"parse_fallback": True},
    )
    apply_backend_action_policy(turn)
    return turn


def parse_and_validate_tutor_turn(
    raw: str,
    *,
    force_blocking: bool = False,
    current_context_status: str = "ready",
    current_problem_text: str = "",
    current_student_thought: str = "",
) -> TutorTurn:
    payload = extract_json_object(raw)
    action = payload.get("action")
    if not isinstance(action, str) or action not in VALID_ACTIONS:
        allowed = "|".join(sorted(VALID_ACTIONS))
        raise TutorTurnActionError(
            f"action must be one of {allowed}; received {action!r}"
        )
    turn = TutorTurn.model_validate(payload)
    if turn.knowledge_card is not None and action not in {"EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE"}:
        raise ValueError("knowledge_card is only allowed for EXPLAIN_LOCAL or EXPLAIN_PRINCIPLE")
    turn.message = sanitize_visible_message(turn.message)
    if not turn.message:
        raise ValueError("message must not be empty")
    apply_backend_action_policy(
        turn,
        force_blocking=force_blocking,
        current_context_status=current_context_status,
        current_problem_text=current_problem_text,
        current_student_thought=current_student_thought,
    )
    if turn.checkpoint:
        validate_checkpoint(turn.checkpoint)
    validate_card_contract(turn)
    return turn


def build_format_retry_messages(
    messages: list[dict[str, Any]],
    raw: str,
    error: Exception,
) -> list[dict[str, Any]]:
    if isinstance(error, TutorTurnActionError):
        retry_instruction = (
            "你刚才返回的 action 不对：action 缺失，或不在允许的 action 列表中。"
            f"action 必须且只能是以下值之一：{'、'.join(sorted(VALID_ACTIONS))}。"
            "请修正 action，并重新生成该 action 对应的最小 JSON。"
            "只输出一个完整 JSON 对象，不要解释、不要 Markdown，也不要添加无关 null 字段。"
        )
    elif "card math expressions must use" in str(error):
        retry_instruction = (
            "你刚才的学习卡片含有未被 LaTeX 定界符包裹的数学表达。请重写本轮 JSON："
            "卡片标题和所有字段中的变量、下标、上标、方程、不等式、运算式与数学符号都必须"
            "完整放进 $...$ 或 $$...$$，例如写 `$a_3$`、`$x^2+6x+1=0$`、"
            "`$a_1a_5=a_3^2$`，不得裸写。JSON 中的反斜杠必须正确转义。"
            "只输出完整 JSON，不要解释、不要 Markdown，也不要添加无关 null 字段。"
        )
    else:
        retry_instruction = (
            "你刚才的输出不是完整、合法且满足合同的 JSON。请重新生成本轮结果。"
            "只输出该 action 对应的最小 JSON 对象，不要解释、不要 Markdown，也不要添加无关 null 字段。"
        )
    return [
        *messages,
        {"role": "assistant", "content": raw},
        {
            "role": "user",
            "content": retry_instruction,
        },
    ]
