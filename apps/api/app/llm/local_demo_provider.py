from __future__ import annotations

import json
import re
from typing import Any

WORKFLOW_CONTROL_KINDS = {
    "workflow_continue",
}


def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text") or "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return str(content or "")


def workflow_control_payload(content: Any) -> dict[str, Any] | None:
    text = message_text(content)
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("kind") not in WORKFLOW_CONTROL_KINDS:
        return None
    return payload


def is_workflow_control_message(content: Any) -> bool:
    return workflow_control_payload(content) is not None


def local_demo_stream(messages: list[dict[str, Any]]) -> list[dict]:
    """local_demo 的等价流式：把 local_demo_response 拆成小 chunk 发出。"""
    full = local_demo_response(messages)
    # 按 ~4 个字符一组模拟流式打字
    step = 4
    for i in range(0, len(full), step):
        yield {"delta": full[i : i + step], "finish_reason": None}
    yield {"delta": "", "finish_reason": "stop"}


def local_demo_knowledge_card() -> dict[str, Any]:
    return {
        "type": "knowledge_card",
        "title": "负系数平方项与函数最值",
        "knowledge_point": "利用平方项非负性判断形如 $-a(x-h)^2+k$ 的最大值",
        "core_idea": "平方项始终不小于 0；乘上负系数后结果不大于 0，所以整体在平方项取 0 时最大。",
        "derivation_steps": [
            {"title": "确定平方项范围", "content": "对任意实数 $x$，都有 $(x-h)^2\\ge 0$。"},
            {"title": "结合负系数", "content": "当 $a>0$ 时，$-a(x-h)^2\\le 0$。"},
            {"title": "定位最值", "content": "当且仅当 $x=h$ 时平方项为 0，函数取得最大值 $k$。"},
        ],
        "when_to_use": ["函数已写成负系数乘平方项再加常数的形式", "需要直接判断二次函数最大值及其取值位置"],
        "common_mistakes": ["只看到平方项非负，却忽略前面的负号", "误以为平方项越大，整个函数也越大"],
        "connection_to_problem": "本题中 $(x-3)^2$ 最小为 0，因此 $-2(x-3)^2+5$ 在 $x=3$ 时最大。",
    }


def local_demo_problem_card() -> dict[str, Any]:
    return {
        "type": "problem_card",
        "title": "函数 $y=-2(x-3)^2+5$ 的最大值",
        "problem_summary": "求函数 $y=-2(x-3)^2+5$ 的最大值，并确定取得最大值时 $x$ 的取值。",
        "solution_overview": "先用平方项非负确定 $-2(x-3)^2$ 的上界，再判断等号何时成立。",
        "solution_steps": [
            {"step": 1, "title": "锁定平方项范围", "reasoning": "看到完全平方 $(x-3)^2$，先利用它恒不小于 0。", "result": "$(x-3)^2\\ge 0$。"},
            {"step": 2, "title": "处理负系数", "reasoning": "乘以负数时不等号方向改变，平方项越小，负项越大。", "result": "$-2(x-3)^2\\le 0$。"},
            {"step": 3, "title": "确定最大值和取值点", "reasoning": "要让函数最大，就让负项达到上界 0；这要求平方项等于 0。", "result": "$x=3$ 时，$y_{\\max}=5$。"},
        ],
        "pitfalls": ["不能因为 $(x-3)^2\\ge0$ 就判断函数最小为 5；负号会反转大小关系。", "答案要同时写出最大值和取得最大值时的 $x$。"],
        "how_to_think": ["看到完全平方，先问它的取值范围。", "再看平方项前系数的正负，判断应让平方项取最小还是最大。", "最后检查等号成立条件，把最值和自变量取值一起写出。"],
        "final_answer": "当 $x=3$ 时，函数取得最大值 $5$。",
    }


def local_demo_response(messages: list[dict[str, Any]]) -> str:
    joined = "\n".join(message_text(message["content"]) for message in messages[-3:])
    latest_workflow_control = None
    for candidate in reversed(messages):
        if candidate["role"] != "user":
            continue
        latest_workflow_control = workflow_control_payload(candidate["content"])
        if latest_workflow_control is not None:
            break
    last_user_index = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if messages[index]["role"] == "user"
            and not is_workflow_control_message(messages[index]["content"])
        ),
        -1,
    )
    last_user = message_text(messages[last_user_index]["content"]) if last_user_index >= 0 else ""
    session_context: dict[str, Any] = {}
    for candidate in messages:
        if candidate["role"] != "user":
            continue
        try:
            possible_context = json.loads(message_text(candidate["content"]))
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(possible_context, dict) and possible_context.get("kind") == "session_context":
            session_context = possible_context
            break

    latest_student_text = last_user
    try:
        latest_envelope = json.loads(last_user)
    except (TypeError, json.JSONDecodeError):
        latest_envelope = None
    if isinstance(latest_envelope, dict) and latest_envelope.get("kind") == "student_message":
        latest_student_text = str(latest_envelope.get("message") or "").strip()

    context_status = str(session_context.get("context_status") or "ready")
    context_fields: dict[str, Any] = {
        "context_status": "ready",
        "problem_summary": None,
        "student_thought_summary": None,
    }
    if context_status != "ready":
        compact = re.sub(r"[\s，。！？!?、]", "", latest_student_text).lower()
        is_filler = compact in {"你好", "您好", "嗨", "hello", "hi", "在吗", "谢谢", "好的", "好"}
        has_thought_marker = bool(
            re.search(
                r"没思路|没有思路|不知道从哪|完全不会|卡在|我(?:想到|做到|试过)|思路\s*[:：]",
                latest_student_text,
            )
        )
        has_problem_marker = bool(
            re.search(
                r"题目\s*[:：]|已知|求|证明|计算|方程|函数|几何|数列|多少|[？?]",
                latest_student_text,
            )
        )

        if context_status == "need_problem":
            if is_filler or (not has_problem_marker and not has_thought_marker):
                return json.dumps(
                    {
                        "state_hint": "diagnosing",
                        "context_status": "need_problem",
                        "problem_summary": None,
                        "student_thought_summary": None,
                        "action": "ASK_OPEN_QUESTION",
                        "message": "你好！把你想解决的完整题目发给我吧，可以直接粘贴文字，也可以上传题目图片。你现在想解决的是哪道题？",
                        "breakpoint_description": None,
                        "breakpoint_confidence": 0,
                        "checkpoint": None,
                        "knowledge_card": None,
                        "problem_card": None,
                        "debug": {"source": "local_demo", "context_collection": True},
                    },
                    ensure_ascii=False,
                )
            if has_thought_marker and not has_problem_marker:
                return json.dumps(
                    {
                        "state_hint": "diagnosing",
                        "context_status": "need_problem",
                        "problem_summary": None,
                        "student_thought_summary": latest_student_text,
                        "action": "ASK_OPEN_QUESTION",
                        "message": "我记下你现在的状态了。请把要解决的完整题目发给我，可以发文字或题目图片。你想解决的是哪道题？",
                        "breakpoint_description": None,
                        "breakpoint_confidence": 0,
                        "checkpoint": None,
                        "knowledge_card": None,
                        "problem_card": None,
                        "debug": {"source": "local_demo", "context_collection": True},
                    },
                    ensure_ascii=False,
                )
            context_fields["problem_summary"] = latest_student_text
            if has_thought_marker:
                context_fields["student_thought_summary"] = latest_student_text
            else:
                context_fields["context_status"] = "need_thought"
                return json.dumps(
                    {
                        "state_hint": "diagnosing",
                        **context_fields,
                        "action": "ASK_OPEN_QUESTION",
                        "message": "题目已经明确了。你已经试过什么、想到哪一步，或者具体卡在哪里？完全没思路也可以直接说。",
                        "breakpoint_description": None,
                        "breakpoint_confidence": 0,
                        "checkpoint": None,
                        "knowledge_card": None,
                        "problem_card": None,
                        "debug": {"source": "local_demo", "context_collection": True},
                    },
                    ensure_ascii=False,
                )
        elif context_status == "need_thought":
            if is_filler or latest_student_text == "上传了一张题目图片":
                return json.dumps(
                    {
                        "state_hint": "diagnosing",
                        "context_status": "need_thought",
                        "problem_summary": None,
                        "student_thought_summary": None,
                        "action": "ASK_OPEN_QUESTION",
                        "message": "题目已经明确了。你已经试过什么、想到哪一步，或者具体卡在哪里？完全没思路也可以直接说。",
                        "breakpoint_description": None,
                        "breakpoint_confidence": 0,
                        "checkpoint": None,
                        "knowledge_card": None,
                        "problem_card": None,
                        "debug": {"source": "local_demo", "context_collection": True},
                    },
                    ensure_ascii=False,
                )
            context_fields["student_thought_summary"] = latest_student_text
    assistants_after_last_user = (
        [message for message in messages[last_user_index + 1 :] if message["role"] == "assistant"]
        if last_user_index >= 0
        else []
    )
    checkpoint_already_responded = bool(assistants_after_last_user)
    followup_explanation_sent = any(
        '"action": "EXPLAIN_LOCAL"' in message_text(message["content"])
        or '"action": "EXPLAIN_PRINCIPLE"' in message_text(message["content"])
        for message in assistants_after_last_user
    )
    history_match = re.search(r"历史对话：\n(?P<history>.*?)(?:\n\n请决定下一步教学动作。|\Z)", last_user, re.DOTALL)
    history_text = history_match.group("history") if history_match else last_user
    # 学生刚回答检查点的标志是最后一条结构化 user/checkpoint_result 中出现
    # “选了：...”字样。历史里可能也含“我不知道”（如学生初始思路），所以只取
    # 最后一次“选了：...”之后的内容判断，避免误判。
    answer_match = None
    for m in re.finditer(r"选了：\s*([^\n]+)", history_text):
        answer_match = m.group(1)
    if "选了：" in history_text and answer_match is not None:
        answer = answer_match.strip()
        if not checkpoint_already_responded:
            if answer.startswith("UNKNOWN") or "我不知道" in answer:
                state_hint = "recovering"
                message = "你愿意直接选择“我不知道”很有价值，这让接下来的帮助有了明确方向，不用着急。"
            elif answer.startswith("A") or "尽量小" in answer or "为 0" in answer:
                state_hint = "scaffolding"
                message = "这一步判断正确，你已经稳稳推进了一个关键小步骤，继续保持这个节奏。"
            else:
                state_hint = "recovering"
                message = "这一步暂时没有选对，但你的选择让卡点更清楚了，这正是继续推进所需要的信息，不用气馁。"
            payload = {
                "state_hint": state_hint,
                **context_fields,
                "action": "RESPOND_TO_CHECKPOINT",
                "message": message,
                "checkpoint": None,
                "debug": {"source": "local_demo", "recent": joined[-120:]},
            }
            return json.dumps(payload, ensure_ascii=False)

        already_explained = (
            followup_explanation_sent
            or "平方项 (x-3)^2 当 x=3 时为 0" in joined
            or "要拿到最大值，应该让平方项取到 0" in joined
        )
        if answer.startswith("UNKNOWN") or "我不知道" in answer:
            state_hint = "recovering"
            if already_explained:
                action = "ASK_OPEN_QUESTION"
                message = "你先试着说说：这道题里 x 取多少时 $(x-3)^2$ 会等于 0？"
            else:
                action = "EXPLAIN_PRINCIPLE"
                message = "没关系，我们从原理开始：平方项永远不小于 0，所以当它前面带负号时，平方项越大，整体反而越小。要拿到最大值，应该让平方项取到 0。"
        elif answer.startswith("A") or "尽量小" in answer or "为 0" in answer:
            state_hint = "summarizing" if already_explained else "scaffolding"
            if already_explained:
                action = "SUMMARIZE"
                message = "这道题的关键已经打通：平方项 $(x-3)^2$ 始终非负，前面乘以负数后，要让整体最大就应让平方项取最小值 $0$。因此 $x=3$ 时函数取得最大值 $5$；以后看到“负系数乘平方项再加常数”，可以先判断平方项应取最小值。"
            else:
                action = "EXPLAIN_LOCAL"
                message = "对了。平方项 $(x-3)^2$ 当 $x=3$ 时为 0，这时整体 $-2(x-3)^2+5$ 取到最大值 5。"
        else:
            state_hint = "recovering"
            if already_explained:
                action = "ASK_OPEN_QUESTION"
                message = "你先用自己的话判断一下：平方项前面有负号时，要让整体最大，平方项应该大还是小？"
            else:
                action = "EXPLAIN_LOCAL"
                message = "这里有个误区：平方项本身不会小于 0，但前面有负号，所以平方项越大整体越小，最大值出现在平方项最小（为 0）的时候。"
        payload = {
            "state_hint": state_hint,
            **context_fields,
            "action": action,
            "message": message,
            "breakpoint_description": "已根据检查点选择推进",
            "breakpoint_confidence": 0.8,
            "checkpoint": None,
            "knowledge_card": local_demo_knowledge_card() if action == "EXPLAIN_PRINCIPLE" else None,
            "problem_card": local_demo_problem_card() if action == "SUMMARIZE" else None,
            "debug": {"source": "local_demo", "recent": joined[-120:]},
        }
        return json.dumps(payload, ensure_ascii=False)

    checkpoint = {
        "type": "checkpoint_mc",
        "question": "要让一个带负号的平方项整体变大，平方项应该尽量怎样？",
        "options": [
            {"id": "A", "text": "尽量小，最好为 0", "is_correct": True, "misconception": None},
            {"id": "B", "text": "尽量大", "is_correct": False, "misconception": "忽略了平方项前面的负号"},
            {"id": "C", "text": "取负数", "is_correct": False, "misconception": "平方项本身不会小于 0"},
        ],
        "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
        "tested_point": "平方项非负，负系数会让它越大整体越小",
        "difficulty": "easy",
    }
    payload = {
        "state_hint": "checking",
        **context_fields,
        "action": "ASK_MULTIPLE_CHOICE",
        "message": "我先不从头讲完整题，先抓你现在最可能卡住的一点：带负号的平方项会怎样影响最大值。",
        "breakpoint_description": "不确定平方项和负系数怎样共同影响函数最大值",
        "breakpoint_confidence": 0.68,
        "checkpoint": checkpoint,
        "debug": {"source": "local_demo", "recent": joined[-120:]},
    }
    return json.dumps(payload, ensure_ascii=False)
