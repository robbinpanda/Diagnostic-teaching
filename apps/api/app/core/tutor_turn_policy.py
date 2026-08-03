from __future__ import annotations

import re

from app.core.schemas import TutorCheckpoint, TutorTurn

BLOCKING_ACTIONS = {"ASK_OPEN_QUESTION", "ASK_MULTIPLE_CHOICE"}
NONBLOCKING_ACTIONS = {"EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE", "RESPOND_TO_CHECKPOINT"}
TERMINAL_ACTIONS = {"SUMMARIZE"}
VALID_ACTIONS = BLOCKING_ACTIONS | NONBLOCKING_ACTIONS | TERMINAL_ACTIONS

_DELIMITED_MATH_RE = re.compile(
    r"\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\\)\$(?:\\.|[^$])+?(?<!\\)\$",
    re.DOTALL,
)
_BARE_MATH_RE = re.compile(
    r"(?:"
    r"[A-Za-z][A-Za-z0-9]*_[{]?[A-Za-z0-9+\-]+[}]?"
    r"|[A-Za-z0-9)}]\^[{]?[A-Za-z0-9+\-]+[}]?"
    r"|\\(?:frac|sqrt|cdot|times|pm|leq?|geq?|neq|sum|prod|angle|overline)\b"
    r"|[≤≥≠±√]"
    r"|(?<![\w$])(?:[A-Za-z]\d*|\d+)\s*(?:[+\-*/=<>]|·)\s*(?:[A-Za-z]\d*|\d+)"
    r")"
)


class TutorTurnActionError(ValueError):
    """The model omitted action or returned an action outside the protocol."""


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


def validate_card_contract(turn: TutorTurn) -> None:
    if turn.action == "EXPLAIN_PRINCIPLE":
        if turn.knowledge_card is None:
            raise ValueError("EXPLAIN_PRINCIPLE requires knowledge_card")
    elif turn.action != "EXPLAIN_LOCAL" and turn.knowledge_card is not None:
        raise ValueError("knowledge_card is only allowed for EXPLAIN_LOCAL or EXPLAIN_PRINCIPLE")

    if turn.action == "SUMMARIZE":
        if turn.problem_card is None:
            raise ValueError("SUMMARIZE requires problem_card")
        step_numbers = [step.step for step in turn.problem_card.solution_steps]
        if step_numbers != list(range(1, len(step_numbers) + 1)):
            raise ValueError("problem_card solution_steps must be numbered from 1 without gaps")
    elif turn.problem_card is not None:
        raise ValueError("problem_card is only allowed for SUMMARIZE")

    if turn.action != "ASK_MULTIPLE_CHOICE" and turn.checkpoint is not None:
        raise ValueError("checkpoint is only allowed for ASK_MULTIPLE_CHOICE")

    card = turn.knowledge_card or turn.problem_card
    if card is None:
        return

    if turn.knowledge_card is not None:
        visible_fields = [
            card.title,
            card.knowledge_point,
            card.core_idea,
            *(step.title for step in card.derivation_steps),
            *(step.content for step in card.derivation_steps),
            *card.when_to_use,
            *card.common_mistakes,
            card.connection_to_problem,
        ]
    else:
        visible_fields = [
            card.title,
            card.problem_summary,
            card.solution_overview,
            *(step.title for step in card.solution_steps),
            *(step.reasoning for step in card.solution_steps),
            *(step.result for step in card.solution_steps),
            *card.pitfalls,
            *card.how_to_think,
            card.final_answer,
        ]

    for text in visible_fields:
        outside_math = _DELIMITED_MATH_RE.sub("", text)
        if _BARE_MATH_RE.search(outside_math):
            raise ValueError(
                "card math expressions must use $...$ or $$...$$ delimiters"
            )


def apply_backend_action_policy(
    turn: TutorTurn,
    *,
    force_blocking: bool = False,
    current_context_status: str = "ready",
    current_problem_text: str = "",
    current_student_thought: str = "",
) -> None:
    original_action = turn.action
    original_context_status = turn.context_status
    turn.problem_summary = (turn.problem_summary or "").strip() or None
    turn.student_thought_summary = (turn.student_thought_summary or "").strip() or None

    valid_context_statuses = {"need_problem", "need_thought", "ready"}
    current_status = (
        current_context_status
        if current_context_status in valid_context_statuses
        else "ready"
    )
    proposed_status = (
        turn.context_status
        if "context_status" in turn.model_fields_set
        and turn.context_status in valid_context_statuses
        else current_status
    )
    status_rank = {"need_problem": 0, "need_thought": 1, "ready": 2}
    if status_rank[proposed_status] < status_rank[current_status]:
        proposed_status = current_status

    has_problem = bool(
        current_status in {"need_thought", "ready"}
        or current_problem_text.strip()
        or turn.problem_summary
    )
    if proposed_status == "ready" and not has_problem:
        proposed_status = "need_problem"
    elif proposed_status == "need_thought" and not has_problem:
        proposed_status = "need_problem"
    turn.context_status = proposed_status

    if turn.action not in VALID_ACTIONS:
        turn.debug["invalid_action"] = turn.action
        turn.action = "EXPLAIN_LOCAL"

    if turn.checkpoint and turn.action != "ASK_MULTIPLE_CHOICE":
        turn.debug["action_corrected_for_checkpoint"] = turn.action
        turn.action = "ASK_MULTIPLE_CHOICE"

    if turn.action == "ASK_MULTIPLE_CHOICE" and not turn.checkpoint:
        turn.debug["checkpoint_missing_for_multiple_choice"] = True
        turn.action = "EXPLAIN_LOCAL"

    if turn.context_status != "ready":
        if turn.action != "ASK_OPEN_QUESTION" or not re.search(r"[？?]\s*$", turn.message):
            turn.message = (
                "请把你想解决的完整题目发给我，可以直接粘贴文字，也可以上传题目图片。你现在想解决的是哪道题？"
                if turn.context_status == "need_problem"
                else "这道题你已经试过什么、想到哪一步，或者具体卡在哪里？完全没思路也可以直接说。"
            )
        turn.debug["context_action_guard"] = {
            "from": turn.action,
            "context_status": turn.context_status,
        }
        turn.state_hint = "diagnosing"
        turn.action = "ASK_OPEN_QUESTION"
        turn.checkpoint = None
        turn.knowledge_card = None
        turn.problem_card = None
    elif force_blocking and turn.action in NONBLOCKING_ACTIONS:
        turn.debug["forced_blocking_after_action"] = turn.action
        turn.action = "ASK_OPEN_QUESTION"
        turn.knowledge_card = None
        turn.problem_card = None
        if not re.search(r"[？?]\s*$", turn.message):
            turn.message = turn.message.rstrip("。！？!?") + "。你先说说：这一步你觉得下一步应该做什么？"

    turn.wait_for_student = turn.action in BLOCKING_ACTIONS
    if turn.action == "ASK_MULTIPLE_CHOICE" and not turn.checkpoint:
        turn.wait_for_student = False
    if turn.action in TERMINAL_ACTIONS:
        turn.wait_for_student = False

    if original_action != turn.action:
        turn.debug.setdefault("backend_action_policy", True)
    if original_context_status != turn.context_status:
        turn.debug["context_status_normalized_from"] = original_context_status
