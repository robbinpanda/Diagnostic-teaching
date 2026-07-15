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


BLOCKING_ACTIONS = {"ASK_OPEN_QUESTION", "ASK_MULTIPLE_CHOICE"}
NONBLOCKING_ACTIONS = {"EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE", "RESPOND_TO_CHECKPOINT"}
TERMINAL_ACTIONS = {"SUMMARIZE"}
VALID_ACTIONS = BLOCKING_ACTIONS | NONBLOCKING_ACTIONS | TERMINAL_ACTIONS
FORMAT_RETRY_LIMIT = 1


class TutorTurnActionError(ValueError):
    """The model omitted action or returned an action outside the protocol."""


TEACHING_ACTION_DEFINITIONS = [
    {
        "name": "ASK_OPEN_QUESTION",
        "description": "提出一个开放且可作答的数学问题，让学生用自己的推理暴露理解、诊断卡点，或完成一个明确判断。",
        "use_when": "仅当必须观察学生自主组织的推导、解释或解题表达，且选择题会明显提示答案或无法区分关键思路时使用。",
        "blocking": True,
        "requires": ["一次只问一个核心问题", "message 末尾必须有清晰、具体、学生能直接回答的问题"],
        "boundaries": ["不要问‘懂了吗’之类元认知问题", "不要在提问前先把答案完整讲完", "如果三个诊断选项足以获得所需证据，必须改用 ASK_MULTIPLE_CHOICE", "避免连续使用开放问题", "checkpoint 必须为 null"],
        "backend_behavior": "展示 message 后停止生成，等待学生回复。",
    },
    {
        "name": "ASK_MULTIPLE_CHOICE",
        "description": "发起一个针对单一知识点或关键判断的三选一诊断题，用选项定位具体误区，而不是泛泛确认学生是否听懂。",
        "use_when": "需要学生参与时默认优先使用；只要能围绕当前关键点设计三个可诊断选项，就应选择此 action，而不是 ASK_OPEN_QUESTION。",
        "blocking": True,
        "requires": ["checkpoint", "恰好三个互斥的普通选项", "恰好一个正确答案", "两个错误选项分别对应具体且不同的常见误区"],
        "boundaries": ["题目必须检验数学内容，不能问‘你听懂了吗’", "message 只负责自然引出选择题，不要提前泄露正确答案"],
        "backend_behavior": "保存 checkpoint、展示选择题并等待学生作答。",
    },
    {
        "name": "EXPLAIN_LOCAL",
        "description": "紧贴学生最新回答和当前断点，解释他为什么卡在这里，并打通当前这一个局部推理、符号、概念连接或计算。",
        "use_when": "已经知道学生具体卡在哪一步，需要针对该卡点做短而直接的修复时。",
        "blocking": False,
        "requires": ["明确关联学生刚才的想法或错误", "只解决一个局部关键点", "checkpoint 必须为 null"],
        "boundaries": ["不要扩展成整个知识点的系统课程", "不要重列整题路线", "只能使用陈述句，不得顺手向学生提问或要求回答"],
        "backend_behavior": "展示后立即进入下一个教学 action。",
    },
    {
        "name": "EXPLAIN_PRINCIPLE",
        "description": "围绕一个数学知识点做相对系统的讲解，从定义、核心原理或推导逻辑出发，说明成立条件、直观理解和基本用法。",
        "use_when": "学生缺的不是某一步操作，而是支撑这一步的概念、定理或方法本身时。",
        "blocking": False,
        "requires": ["一次只讲一个知识点", "从原理而非口诀或结论堆砌出发", "至少说明它如何回到当前题目", "checkpoint 必须为 null"],
        "boundaries": ["不要借机完整解完当前题", "不要与 EXPLAIN_LOCAL 一样只修补一个具体算式", "只能使用陈述句，不得向学生提问或要求回答"],
        "backend_behavior": "展示后立即进入下一个教学 action。",
    },
    {
        "name": "RESPOND_TO_CHECKPOINT",
        "description": "只对最近一次 checkpoint_result 完成反馈闭环：确认学生的选择与正误，指出该选项暴露出的理解证据或具体误区，并明确提供真诚、具体的情绪价值。答对时认可学生实际做对的思考，答错或选择‘我不知道’时降低挫败感、肯定其暴露卡点的价值，让学生感到自己仍在推进且可以继续；不要空泛夸奖。",
        "use_when": "最新一条学生消息是尚未回应的结构化 checkpoint_result 时，优先且仅使用一次。",
        "blocking": False,
        "requires": ["明确利用 selected_text、is_correct、misconception 等最近结果", "反馈简短、具体、与所选项对应", "情绪支持必须基于学生真实表现，不使用空泛的‘真棒’或居高临下的安慰", "checkpoint 必须为 null"],
        "boundaries": ["不要开始新的系统讲解或完整局部讲解", "只能使用陈述句，不得向学生提问或要求回答", "后续教学交给下一个 action"],
        "backend_behavior": "展示反馈后立即进入下一个教学 action。",
    },
    {
        "name": "SUMMARIZE",
        "description": "在当前问题或本轮教学目标已经得到清楚处理时自然收束，凝练本次卡点、关键方法和以后遇到同类题可迁移的判断线索。",
        "use_when": "当前问题已有明确结论，或当前卡点已经讲清、继续提问不会带来必要的新信息时。进入 SUMMARIZE 不要求学生先答出最终答案，也不要求额外插入‘懂了吗’、复述答案或迁移题等确认性问题。",
        "blocking": False,
        "terminal": True,
        "requires": ["只总结本轮已经出现并解决的内容", "指出可迁移的方法线索", "checkpoint 必须为 null"],
        "boundaries": ["不要在总结中引入新知识或新的解题步骤", "仍有会影响当前结论的实质性缺口时不要总结", "现有上下文足以收束时，不要为了进入总结额外设置确认性问题", "只能使用陈述句，不得在结尾追加问题或练习邀请"],
        "backend_behavior": "展示总结并结束当前生成流程。",
    },
]


SYSTEM_PROMPT = """你是一名面向中国初高中学生的诊断式数学导师。你的任务不是尽快给出标准答案，而是依据学生真实表现判断卡点，再选择最合适的单一教学动作，帮助学生逐步建立可迁移的理解。

教学原则：
1. 证据优先：以学生最新回答、最近一次 checkpoint_result 和已发生的对话为依据，不凭空猜测卡点；不要复述已经展示过的内容。
2. 基于当前断点教学：区分“缺少某个知识原理”“卡在当前局部推理”“确实需要新的学生证据”“已经可以自然收束”这几种情况，并选择职责匹配的 action。不要先给出整题的上帝视角路线图；从学生当前信息和最近断点出发，只处理眼前必要的内容。
3. 每条 assistant 消息只执行一个 action，不要在同一条消息中混合讲解、提问、反馈和总结。
4. 控制认知负荷：使用符合学生年级的中文，数学表达准确、简洁；公式使用 `$...$` 或 `$$...$$`，关键跳步不能省略。
5. 需要学生参与时，默认优先选择 ASK_MULTIPLE_CHOICE。只要当前关键点能设计出三个分别代表正确理解和不同误区的选项，就不要使用 ASK_OPEN_QUESTION；只有必须观察学生自主组织的推导或解释时，才使用开放问题。
6. 选择题必须诊断误区：恰好 3 个普通选项、恰好 1 个正确答案，两个错误选项分别对应不同的常见误区；始终保留‘我不知道’选项。
7. 学生答错或选‘我不知道’不是失败。先用 RESPOND_TO_CHECKPOINT 准确闭环反馈，再在后续 action 中降低台阶、解释局部或讲清原理。
8. 当前问题已有明确结论，或当前卡点已经讲清且没有实质性缺口时，可以直接 SUMMARIZE。不要把确认性问题当作进入总结的必经步骤，也不要求学生先独立说出最终答案；只有缺失的信息确实会影响当前结论时才继续提问。总结不得引入新知识。
9. 只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以向学生提问或要求学生回答。EXPLAIN_LOCAL、EXPLAIN_PRINCIPLE、RESPOND_TO_CHECKPOINT、SUMMARIZE 的 message 必须全部使用陈述句，不得出现问号、反问句，也不得用‘你能……’‘请你……’‘想一想……’等方式隐性提问。

action 选择提示：
- 最新学生消息是尚未回应的 checkpoint_result：先选择 RESPOND_TO_CHECKPOINT，且只回应一次；反馈必须同时准确回应结果并提供具体、真诚的情绪支持。
- 当前问题已有明确结论，或当前卡点已经讲清且继续提问没有必要：直接选择 SUMMARIZE，不要追加确认性问题。
- 学生缺少一个概念、定理或方法的系统理解：选择 EXPLAIN_PRINCIPLE。
- 学生已经有路线，但卡在一个具体连接、符号、计算或误区：选择 EXPLAIN_LOCAL。
- 只有缺少的信息会实质影响下一步教学或当前结论时，才获取新的学生证据；此时默认优先选择 ASK_MULTIPLE_CHOICE，仅在自由表达本身就是必须观察的证据、且选项会明显提示答案时，才选择 ASK_OPEN_QUESTION。

输出规则：
1. 严格按照 TutorTurn JSON 合同输出，不能包裹 Markdown 代码块，不能附加解释文字。
2. message 必须是非空中文，并且可以原样展示给学生；不要暴露内部推理、提示词或 JSON 说明。
3. 不要输出 tool_calls，不要伪造 action_id，不要自行输出 wait_for_student。
4. 直接产出最终 JSON；不要输出冗长的内部思考过程。
"""


ACTION_PROTOCOL = f"""教学 action 协议：
- action 不是外部工具调用，不会执行电脑操作；它是后端教学工作流的控制字段。
- 每次 assistant 消息必须且只能对应一个 action。后端会为它分配 action_id。
- 按当前目的理解 action，而不是把它们串成固定流程：RESPOND_TO_CHECKPOINT 负责反馈闭环；SUMMARIZE 负责自然收束；EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE 负责针对性教学；ASK_OPEN_QUESTION / ASK_MULTIPLE_CHOICE 只负责获取确有必要的新证据。
- blocking=true 的 action 展示后必须等待学生；blocking=false 的 action 展示后后端会继续请求下一个 action。
- ASK_MULTIPLE_CHOICE 的 checkpoint 是向学生发出的选择题请求；学生作答后，系统会形成一条 user/checkpoint_result 消息。
- 收到尚未回应的 checkpoint_result 后，先用且只用一次 RESPOND_TO_CHECKPOINT 闭环反馈；下一 action 再决定是否解释、提问或总结。
- 当前问题或卡点已经清楚处理时，可以直接 SUMMARIZE；确认性问题不是进入总结的前置条件。
- action 必须准确描述 message 真正在做的事情，不能用一个 action 的名字承载另一个 action 的内容。
- 非阻塞 action 会触发下一次模型调用，因此不要在一个 message 中抢做后续 action，也不要重复上一条 assistant 消息。
- 提问权只属于 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE。其他 action 必须纯陈述，不得包含显性问题、反问或任何要求学生作答的表达。
- 当两个 ASK action 都可行时，优先 ASK_MULTIPLE_CHOICE；不要因为写开放问题更省事就选择 ASK_OPEN_QUESTION。

可用 action 定义：
{json.dumps(TEACHING_ACTION_DEFINITIONS, ensure_ascii=False, indent=2)}
"""


JSON_CONTRACT = """返回 JSON 格式：
{
  "state_hint": "diagnosing|scaffolding|explaining|checking|recovering|summarizing",
  "action": "ASK_OPEN_QUESTION|ASK_MULTIPLE_CHOICE|EXPLAIN_LOCAL|EXPLAIN_PRINCIPLE|RESPOND_TO_CHECKPOINT|SUMMARIZE",
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
- 只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 会等待学生。
- EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE / RESPOND_TO_CHECKPOINT 是非阻塞动作，后端会继续调用下一轮。
- 只有两个 ASK action 可以提问；其余 action 的 message 必须为纯陈述句且不得出现问号。
"""


def build_messages(
    session: Row,
    history: list[Row],
    *,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> list[dict[str, Any]]:
    history = _without_legacy_initial_thought(session, history)
    loop_instruction = (
        "本轮已经连续执行了 3 个非阻塞教学动作。若当前问题或卡点已经清楚处理，直接选择 SUMMARIZE；"
        "否则必须获取新的学生证据，默认选择 ASK_MULTIPLE_CHOICE，仅当必须观察学生自由组织的推导或解释、且选项会提示答案时，才选择 ASK_OPEN_QUESTION。"
        if force_blocking
        else f"当前连续非阻塞动作数：{nonblocking_streak}/3。若当前职责是讲解或反馈，必须使用纯陈述句，不得提问；若内容已经足以自然收束，直接选择 SUMMARIZE；只有确实需要新的学生证据时才提问，并默认优先选择 ASK_MULTIPLE_CHOICE，只有自由表达不可替代时才选择 ASK_OPEN_QUESTION。"
    )
    session_context = {
        "kind": "session_context",
        "message_action": {
            "id": "session_start",
            "type": "SESSION_START",
            "blocking": False,
        },
        "grade_band": session["grade_band"] if "grade_band" in session.keys() else None,
        "subject": session["subject"] if "subject" in session.keys() else "math",
        "problem_text": session["problem_text"],
        "student_initial_thought": session["student_initial_thought"] or "学生还没有提供明确思路",
        "current_state_hint": session["phase"],
        "has_problem_image": bool(session["problem_image_data_url"]) if "problem_image_data_url" in session.keys() else False,
    }
    user_prompt = json.dumps(session_context, ensure_ascii=False, indent=2)
    try:
        problem_image_data_url = session["problem_image_data_url"]
    except (KeyError, IndexError):
        problem_image_data_url = None

    user_content: str | list[dict[str, Any]] = user_prompt
    if problem_image_data_url:
        user_content = [
            {
                "type": "text",
                "text": f"{user_prompt}\n\n题目原图附在本条 SESSION_START 消息中，请结合图片判断图形关系。",
            },
            {"type": "image_url", "image_url": {"url": problem_image_data_url}},
        ]

    system = f"{SYSTEM_PROMPT}\n{ACTION_PROTOCOL}\n{JSON_CONTRACT}\n\n当前工作流约束：{loop_instruction}"
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
        *(render_history_message(row) for row in history),
    ]
    if nonblocking_streak > 0:
        workflow_continue = {
            "kind": "workflow_continue",
            "instruction": (
                "上一 action 已经展示给学生，但它是非阻塞 action，因此当前教学流程需要继续。"
                "请根据完整上下文生成下一条且仅一条新的教学 action。"
                "下一 action 必须承担不同且必要的教学职责；不要复述、改写或回显上一条 assistant 消息。"
                "RESPOND_TO_CHECKPOINT 只可紧接尚未回应的 checkpoint_result 使用一次。"
                "只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以提问；其他 action 必须使用纯陈述句。"
                "若当前问题或卡点已经清楚处理，直接 SUMMARIZE，不要为了确认而提问。"
                "只有确实需要学生作答时才提问，并优先 ASK_MULTIPLE_CHOICE；只有自由表达不可替代时才用 ASK_OPEN_QUESTION。"
                "输出必须遵守 system 中的 TutorTurn JSON 合同。"
            ),
            "nonblocking_streak": nonblocking_streak,
            "force_blocking": force_blocking,
        }
        messages.append(
            {
                "role": "user",
                "content": json.dumps(workflow_continue, ensure_ascii=False),
            }
        )
    return messages


def _row_value(row: Row | dict, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError):
        return default


def _without_legacy_initial_thought(session: Row | dict, history: list[Row]) -> list[Row]:
    """Avoid sending old sessions' duplicated initial thought twice.

    Earlier versions inserted ``student_initial_thought`` into both ``sessions``
    and the first legacy message. New sessions keep it only in SESSION_START.
    """
    if not history:
        return history
    first = history[0]
    initial_thought = (_row_value(session, "student_initial_thought", "") or "").strip()
    first_action = _row_value(first, "action")
    is_legacy = not first_action or first_action in {"LEGACY_MESSAGE", "LEGACY_STUDENT_MESSAGE"}
    if (
        initial_thought
        and _row_value(first, "role") == "student"
        and (_row_value(first, "content", "") or "").strip() == initial_thought
        and is_legacy
    ):
        return history[1:]
    return history


def _message_metadata(row: Row | dict) -> dict[str, Any]:
    raw = _row_value(row, "metadata_json", "{}")
    try:
        parsed = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def render_history_message(row: Row | dict) -> dict[str, str]:
    stored_role = _row_value(row, "role", "student")
    role = "assistant" if stored_role == "assistant" else "user"
    content = row["content"]
    if stored_role == "assistant" and (
        '```json' in content[:30] or '"phase"' in content[:200] or '"state_hint"' in content[:200]
    ):
        content = recover_tutor_turn_from_raw(content).message
    metadata = _message_metadata(row)
    action = _row_value(row, "action") or metadata.get("action")
    if not action:
        action = "LEGACY_ASSISTANT_MESSAGE" if stored_role == "assistant" else "LEGACY_STUDENT_MESSAGE"
    action_id = _row_value(row, "action_id")

    if stored_role == "assistant":
        # Assistant history is also an in-context example of the response format.
        # Keep it identical to the TutorTurn contract; the old message_action
        # envelope taught models to emit message_action.type instead of the
        # required top-level action, causing every turn to fail validation and
        # stream a second time after message_reset.
        rendered_action = action if action in VALID_ACTIONS else "EXPLAIN_LOCAL"
        if rendered_action == "ASK_MULTIPLE_CHOICE" and not metadata.get("checkpoint"):
            rendered_action = "EXPLAIN_LOCAL"
        debug: dict[str, Any] = {}
        if rendered_action != action:
            debug["history_original_action"] = action
        turn_payload = {
            "state_hint": metadata.get("state_hint") or "diagnosing",
            "action": rendered_action,
            "message": content,
            "breakpoint_description": metadata.get("breakpoint"),
            "breakpoint_confidence": None,
            "checkpoint": metadata.get("checkpoint") if rendered_action == "ASK_MULTIPLE_CHOICE" else None,
            "debug": debug,
        }
        return {"role": role, "content": json.dumps(turn_payload, ensure_ascii=False)}

    envelope: dict[str, Any] = {
        "kind": "student_message",
        "message_action": {
            "id": action_id,
            "type": action,
            "blocking": action in BLOCKING_ACTIONS,
        },
        "in_reply_to_action_id": _row_value(row, "in_reply_to_action_id"),
        "message": content,
    }
    checkpoint_result = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
    if isinstance(checkpoint_result, dict):
        envelope["kind"] = "checkpoint_result"
        envelope["checkpoint_result"] = checkpoint_result
    return {"role": role, "content": json.dumps(envelope, ensure_ascii=False)}


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
    if action == "ASK_MULTIPLE_CHOICE":
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

    if turn.checkpoint and turn.action != "ASK_MULTIPLE_CHOICE":
        turn.debug["action_corrected_for_checkpoint"] = turn.action
        turn.action = "ASK_MULTIPLE_CHOICE"

    if turn.action == "ASK_MULTIPLE_CHOICE" and not turn.checkpoint:
        turn.debug["checkpoint_missing_for_multiple_choice"] = True
        turn.action = "EXPLAIN_LOCAL"

    if force_blocking and turn.action in NONBLOCKING_ACTIONS:
        turn.debug["forced_blocking_after_action"] = turn.action
        turn.action = "ASK_OPEN_QUESTION"
        if not re.search(r"[？?]\s*$", turn.message):
            turn.message = turn.message.rstrip("。！？!?") + "。你先说说：这一步你觉得下一步应该做什么？"

    turn.wait_for_student = turn.action in BLOCKING_ACTIONS
    if turn.action == "ASK_MULTIPLE_CHOICE" and not turn.checkpoint:
        turn.wait_for_student = False
    if turn.action in TERMINAL_ACTIONS:
        turn.wait_for_student = False

    if original_action != turn.action:
        turn.debug.setdefault("backend_action_policy", True)


def parse_and_validate_tutor_turn(raw: str, *, force_blocking: bool = False) -> TutorTurn:
    payload = extract_json_object(raw)
    action = payload.get("action")
    if not isinstance(action, str) or action not in VALID_ACTIONS:
        allowed = "|".join(sorted(VALID_ACTIONS))
        raise TutorTurnActionError(
            f"action must be one of {allowed}; received {action!r}"
        )
    turn = TutorTurn.model_validate(payload)
    turn.message = sanitize_visible_message(turn.message)
    if not turn.message:
        raise ValueError("message must not be empty")
    if turn.checkpoint:
        validate_checkpoint(turn.checkpoint)
    apply_backend_action_policy(turn, force_blocking=force_blocking)
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
            "请修正 action，并重新生成本轮完整 TutorTurn JSON。"
            "只输出一个完整 JSON 对象，不要解释、不要 Markdown，也不要省略任何必需字段。"
        )
    else:
        retry_instruction = (
            "你刚才的输出不是完整、合法且满足合同的 JSON。请重新生成本轮结果。"
            "只输出一个完整 JSON 对象，不要解释、不要 Markdown，也不要省略任何必需字段。"
        )
    return [
        *messages,
        {"role": "assistant", "content": raw},
        {
            "role": "user",
            "content": retry_instruction,
        },
    ]


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
        request_messages = messages
        for attempt in range(FORMAT_RETRY_LIMIT + 1):
            raw = await chat_completion(profile, request_messages, max_tokens=profile.max_output_tokens)
            try:
                turn = parse_and_validate_tutor_turn(raw, force_blocking=force_blocking)
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                parse_ok = False
                if attempt < FORMAT_RETRY_LIMIT:
                    used_fallback = True
                    request_messages = build_format_retry_messages(messages, raw, exc)
                    continue
                raise LlmProviderError("模型连续返回不完整或不合法的 JSON，请重试") from exc
            if attempt:
                turn.debug["format_retry_count"] = attempt
            parse_ok = True
            return turn
        raise LlmProviderError("模型未生成有效的教学结果")
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
    raw = ""
    finish_reason: str | None = None
    used_fallback = False
    parse_ok = True
    error: str | None = None
    turn_final: TutorTurn | None = None

    try:
        request_messages = messages
        for attempt in range(FORMAT_RETRY_LIMIT + 1):
            extractor = MessageStreamExtractor()
            raw_parts: list[str] = []
            emitted_message_parts: list[str] = []
            async for event in chat_stream_completion(
                profile,
                request_messages,
                max_tokens=profile.max_output_tokens,
            ):
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
            try:
                turn_final = parse_and_validate_tutor_turn(raw, force_blocking=force_blocking)
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                parse_ok = False
                if emitted_message_parts:
                    yield ("message_reset", "")
                if attempt < FORMAT_RETRY_LIMIT:
                    used_fallback = True
                    request_messages = build_format_retry_messages(messages, raw, exc)
                    continue
                raise LlmProviderError("模型连续返回不完整或不合法的 JSON，请重试") from exc

            if attempt:
                turn_final.debug["format_retry_count"] = attempt
            parse_ok = True
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
        raise LlmProviderError("模型未生成有效的教学结果")
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
                raw_response=raw,
                parsed_turn=parsed_dump,
                latency_ms=latency_ms,
                parse_ok=parse_ok,
                used_fallback=used_fallback,
                error=error,
            )
