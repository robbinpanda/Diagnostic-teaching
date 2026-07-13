import asyncio
import json

import pytest

from app.core.schemas import TutorCheckpoint, TutorCheckpointOption
from app.core import teaching_controller as teaching
from app.core.teaching_controller import (
    apply_backend_action_policy,
    build_messages,
    extract_json_object,
    recover_tutor_turn_from_raw,
    validate_checkpoint,
)
from app.llm.provider import LlmProfile


def test_checkpoint_requires_exactly_one_correct_option():
    checkpoint = TutorCheckpoint(
        question="平方项最小是多少？",
        tested_point="平方项非负",
        options=[
            TutorCheckpointOption(id="A", text="0", is_correct=True),
            TutorCheckpointOption(id="B", text="1", is_correct=True),
            TutorCheckpointOption(id="C", text="-1", is_correct=False, misconception="以为平方可为负"),
        ],
    )

    with pytest.raises(ValueError):
        validate_checkpoint(checkpoint)


def test_checkpoint_rejects_meta_question():
    checkpoint = TutorCheckpoint(
        question="你听懂了吗？",
        tested_point="元认知问题不合格",
        options=[
            TutorCheckpointOption(id="A", text="懂了", is_correct=True),
            TutorCheckpointOption(id="B", text="没懂", is_correct=False, misconception="不是数学误区"),
            TutorCheckpointOption(id="C", text="不知道", is_correct=False, misconception="不是数学误区"),
        ],
    )

    with pytest.raises(ValueError):
        validate_checkpoint(checkpoint)


def test_backend_policy_derives_wait_for_blocking_actions():
    turn = teaching.TutorTurn(state_hint="scaffolding", action="ASK_OPEN_QUESTION", message="下一步你想怎么做？")

    apply_backend_action_policy(turn)

    assert turn.wait_for_student is True


def test_backend_policy_corrects_checkpoint_action():
    checkpoint = TutorCheckpoint(
        question="平方项最小是多少？",
        tested_point="平方项非负",
        options=[
            TutorCheckpointOption(id="A", text="0", is_correct=True),
            TutorCheckpointOption(id="B", text="1", is_correct=False, misconception="误以为最小是 1"),
            TutorCheckpointOption(id="C", text="-1", is_correct=False, misconception="误以为平方可为负"),
        ],
    )
    turn = teaching.TutorTurn(
        state_hint="checking",
        action="EXPLAIN_LOCAL",
        message="测一下这个点。",
        checkpoint=checkpoint,
    )

    apply_backend_action_policy(turn)

    assert turn.action == "ASK_MULTIPLE_CHOICE"
    assert turn.wait_for_student is True


def test_backend_policy_forces_blocking_after_nonblocking_streak():
    turn = teaching.TutorTurn(state_hint="explaining", action="EXPLAIN_LOCAL", message="先看这一小步")

    apply_backend_action_policy(turn, force_blocking=True)

    assert turn.action == "ASK_OPEN_QUESTION"
    assert turn.wait_for_student is True
    assert "你先说说" in turn.message


def test_action_protocol_keeps_teaching_responsibilities_distinct():
    definitions = {item["name"]: item for item in teaching.TEACHING_ACTION_DEFINITIONS}

    assert "ASK_MULTIPLE_CHOICE" in definitions
    assert "SHOW_CHECKPOINT_MC" not in teaching.VALID_ACTIONS
    assert "整道题的全局视角" in definitions["DECOMPOSE_STEP"]["description"]
    assert any("不是只拆当前的下一小步" in item for item in definitions["DECOMPOSE_STEP"]["boundaries"])
    assert "系统" in definitions["EXPLAIN_PRINCIPLE"]["description"]
    assert "当前断点" in definitions["EXPLAIN_LOCAL"]["description"]
    assert "只对最近一次" in definitions["RESPOND_TO_CHECKPOINT"]["description"]
    assert "后续教学交给下一个 action" in definitions["RESPOND_TO_CHECKPOINT"]["boundaries"]
    assert "学生缺少整题方向" in teaching.SYSTEM_PROMPT
    assert "三个分别代表正确理解和不同误区的选项" in teaching.SYSTEM_PROMPT
    assert "默认优先选择 ASK_MULTIPLE_CHOICE" in teaching.SYSTEM_PROMPT
    assert "只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以向学生提问" in teaching.SYSTEM_PROMPT
    assert "其余 action 的 message 必须为纯陈述句" in teaching.JSON_CONTRACT


def test_build_messages_attaches_original_problem_image_to_tutoring_request():
    image_data_url = "data:image/png;base64,b3JpZ2luYWw="
    session = {
        "problem_text": "根据图中的立体几何关系求角度。",
        "student_initial_thought": "我找到了一个直角。",
        "phase": "diagnosing",
        "problem_image_data_url": image_data_url,
    }

    messages = build_messages(session, [])

    user_content = messages[-1]["content"]
    assert isinstance(user_content, list)
    assert user_content[0]["type"] == "text"
    assert "立体几何" in user_content[0]["text"]
    assert user_content[1] == {"type": "image_url", "image_url": {"url": image_data_url}}


def test_build_messages_uses_structured_roles_and_keeps_full_history():
    session = {
        "grade_band": "junior",
        "subject": "math",
        "problem_text": "求 x。",
        "student_initial_thought": "先移项。",
        "phase": "scaffolding",
        "problem_image_data_url": None,
    }
    history = []
    for index in range(26):
        assistant = index % 2 == 1
        history.append(
            {
                "role": "assistant" if assistant else "student",
                "content": f"message-{index}",
                "action_id": f"act_{index}",
                "action": "EXPLAIN_LOCAL" if assistant else "STUDENT_RESPONSE",
                "in_reply_to_action_id": f"act_{index - 1}" if not assistant and index else None,
                "metadata_json": json.dumps({"state_hint": "scaffolding"}),
            }
        )

    messages = build_messages(session, history)

    assert len(messages) == 28  # system + SESSION_START + all 26 rows; no 20-message cutoff
    assert [item["role"] for item in messages[2:6]] == ["user", "assistant", "user", "assistant"]
    first = json.loads(messages[2]["content"])
    second = json.loads(messages[3]["content"])
    assert first["message_action"]["type"] == "STUDENT_RESPONSE"
    assert second["action"] == "EXPLAIN_LOCAL"
    assert second["message"] == "message-1"
    assert "message_action" not in second
    parsed_history_turn = teaching.parse_and_validate_tutor_turn(messages[3]["content"])
    assert parsed_history_turn.action == "EXPLAIN_LOCAL"
    assert "action 不是外部工具调用" in messages[0]["content"]
    assert "checkpoint_result" in messages[0]["content"]


def test_build_messages_ends_nonblocking_continuation_with_user_control_message():
    session = {
        "grade_band": "senior",
        "subject": "math",
        "problem_text": "求 a3。",
        "student_initial_thought": "我算到正负一。",
        "phase": "recovering",
        "problem_image_data_url": None,
    }
    history = [
        {
            "role": "assistant",
            "content": "先解释符号关系。",
            "action_id": "act_explain",
            "action": "EXPLAIN_PRINCIPLE",
            "in_reply_to_action_id": None,
            "metadata_json": json.dumps({"state_hint": "recovering"}),
        }
    ]

    messages = build_messages(session, history, nonblocking_streak=1)

    assert messages[-2]["role"] == "assistant"
    assert messages[-1]["role"] == "user"
    previous_turn = teaching.parse_and_validate_tutor_turn(messages[-2]["content"])
    assert previous_turn.action == "EXPLAIN_PRINCIPLE"
    assert previous_turn.message == "先解释符号关系。"
    control = json.loads(messages[-1]["content"])
    assert control["kind"] == "workflow_continue"
    assert control["nonblocking_streak"] == 1
    assert "上一 action 已经展示" in control["instruction"]
    assert "不要复述、改写或回显" in control["instruction"]


def test_build_messages_deduplicates_legacy_initial_thought():
    session = {
        "grade_band": "junior",
        "subject": "math",
        "problem_text": "求 x。",
        "student_initial_thought": "先移项。",
        "phase": "diagnosing",
        "problem_image_data_url": None,
    }
    history = [
        {
            "role": "student",
            "content": "先移项。",
            "action_id": None,
            "action": "LEGACY_MESSAGE",
            "in_reply_to_action_id": None,
            "metadata_json": "{}",
        },
        {
            "role": "assistant",
            "content": "移项后得到什么？",
            "action_id": None,
            "action": "LEGACY_MESSAGE",
            "in_reply_to_action_id": None,
            "metadata_json": "{}",
        },
    ]

    messages = build_messages(session, history)

    assert len(messages) == 3
    assert json.loads(messages[1]["content"])["student_initial_thought"] == "先移项。"
    assert json.loads(messages[2]["content"])["message"] == "移项后得到什么？"


def test_recover_message_from_truncated_markdown_json():
    raw = """```json
{
  "phase": "scaffolding",
  "action": "ASK_MULTIPLE_CHOICE",
  "message": "还没结束！你已经知道 $a_3^2 = a_1 \\cdot a_5$，现在需要求出 $a_1 \\cdot a_5$ 的值。题目说两个数是方程的两个根，下一步用韦达定理。",
  "checkpoint": {
    "question": "若 $a_1$、$a"""

    turn = recover_tutor_turn_from_raw(raw)

    assert turn.phase == "scaffolding"
    assert turn.action == "EXPLAIN_LOCAL"
    assert "还没结束" in turn.message
    assert "韦达定理" in turn.message
    assert turn.checkpoint is None


def test_extract_json_repairs_unescaped_quotes_inside_message():
    raw = """```json
{
  "phase": "diagnosing",
  "action": "ASK_MULTIPLE_CHOICE",
  "message": "这道题需要把"二次函数零点"和"等比数列性质"结合起来。我们先确认一下等比中项关系。",
  "breakpoint_description": "学生尚未提供思路，需先检测是否知道等比数列中项关系",
  "breakpoint_confidence": 0.6,
  "checkpoint": {
    "type": "checkpoint_mc",
    "question": "在等比数列中，a1、a3、a5 之间满足什么关系？",
    "options": [
      {"id": "A", "text": "a3² = a1 · a5", "is_correct": true, "misconception": null},
      {"id": "B", "text": "a3 = (a1 + a5) / 2", "is_correct": false, "misconception": "混淆等比和等差"},
      {"id": "C", "text": "a3 = a1 + a5", "is_correct": false, "misconception": "误以为项之间相加"}
    ],
    "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
    "tested_point": "等比中项性质",
    "difficulty": "easy"
  },
  "debug": {}
}
```"""

    payload = extract_json_object(raw)

    assert payload["message"] == "这道题需要把\"二次函数零点\"和\"等比数列性质\"结合起来。我们先确认一下等比中项关系。"
    assert payload["checkpoint"]["options"][0]["is_correct"] is True


def test_stream_backfills_message_when_incremental_extractor_stops_early(monkeypatch):
    raw = """```json
{
  "phase": "diagnosing",
  "action": "ASK_MULTIPLE_CHOICE",
  "message": "这道题需要把"二次函数零点"和"等比数列性质"结合起来。我们先确认一下等比中项关系。",
  "breakpoint_description": "学生尚未提供思路，需先检测是否知道等比数列中项关系",
  "breakpoint_confidence": 0.6,
  "checkpoint": {
    "type": "checkpoint_mc",
    "question": "在等比数列中，a1、a3、a5 之间满足什么关系？",
    "options": [
      {"id": "A", "text": "a3² = a1 · a5", "is_correct": true, "misconception": null},
      {"id": "B", "text": "a3 = (a1 + a5) / 2", "is_correct": false, "misconception": "混淆等比和等差"},
      {"id": "C", "text": "a3 = a1 + a5", "is_correct": false, "misconception": "误以为项之间相加"}
    ],
    "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
    "tested_point": "等比中项性质",
    "difficulty": "easy"
  },
  "debug": {}
}
```"""

    async def fake_chat_stream_completion(*args, **kwargs):
        yield {"delta": raw, "finish_reason": None}
        yield {"delta": "", "finish_reason": "stop"}

    monkeypatch.setattr(teaching, "chat_stream_completion", fake_chat_stream_completion)
    profile = LlmProfile(
        id="prof_test",
        provider="openai_compatible",
        base_url="https://example.test/v1",
        api_key="test-key",
        model="test-model",
        timeout_ms=30000,
        temperature=0.2,
        max_output_tokens=1200,
    )
    session = {
        "id": "sess_test",
        "problem_text": "已知等比数列，求 a3。",
        "student_initial_thought": "",
        "phase": "diagnosing",
    }

    async def collect_events():
        events = []
        async for event in teaching.generate_tutor_turn_stream(profile, session, []):
            events.append(event)
        return events

    events = asyncio.run(collect_events())
    visible = "".join(value for kind, value in events if kind == "message_delta")
    turn = next(value for kind, value in events if kind == "turn")

    assert visible == turn.message
    assert "二次函数零点" in visible
    assert turn.checkpoint is not None


def test_stream_retries_invalid_json_and_resets_partial_message(monkeypatch):
    responses = [
        '{"state_hint":"diagnosing","action":"ASK_OPEN_QUESTION","message":"残缺内容',
        json.dumps(
            {
                "state_hint": "diagnosing",
                "action": "ASK_OPEN_QUESTION",
                "message": "请重新说说你目前想到哪一步？",
                "checkpoint": None,
                "debug": {},
            },
            ensure_ascii=False,
        ),
    ]
    requests = []

    async def fake_chat_stream_completion(profile, messages, **kwargs):
        requests.append(messages)
        raw = responses[len(requests) - 1]
        yield {"delta": raw, "finish_reason": None}
        yield {"delta": "", "finish_reason": "stop"}

    monkeypatch.setattr(teaching, "chat_stream_completion", fake_chat_stream_completion)
    profile = LlmProfile(
        id="prof_test",
        provider="openai_compatible",
        base_url="https://example.test/v1",
        api_key="test-key",
        model="test-model",
        timeout_ms=30000,
        temperature=0.2,
        max_output_tokens=1200,
    )
    session = {
        "id": "sess_test",
        "problem_text": "求函数最大值。",
        "student_initial_thought": "",
        "phase": "diagnosing",
    }

    async def collect_events():
        return [event async for event in teaching.generate_tutor_turn_stream(profile, session, [])]

    events = asyncio.run(collect_events())
    assert len(requests) == 2
    assert any(kind == "message_reset" for kind, _ in events)
    turn = next(value for kind, value in events if kind == "turn")
    assert turn.message == "请重新说说你目前想到哪一步？"
    assert turn.debug["format_retry_count"] == 1
    assert "完整、合法" in requests[1][-1]["content"]


def test_stream_retries_missing_action_with_action_specific_instruction(monkeypatch):
    responses = [
        json.dumps(
            {
                "kind": "teaching_action",
                "message_action": {
                    "id": "act_previous",
                    "type": "EXPLAIN_PRINCIPLE",
                    "blocking": False,
                },
                "message": "这是被错误回显的上一条消息。",
                "state_hint": "recovering",
            },
            ensure_ascii=False,
        ),
        json.dumps(
            {
                "state_hint": "recovering",
                "action": "ASK_OPEN_QUESTION",
                "message": "现在请你说说，为什么 $a_3$ 与 $a_1$ 同号？",
                "breakpoint_description": "需要学生说明符号关系",
                "breakpoint_confidence": 0.8,
                "checkpoint": None,
                "debug": {},
            },
            ensure_ascii=False,
        ),
    ]
    requests = []

    async def fake_chat_stream_completion(profile, messages, **kwargs):
        requests.append(messages)
        raw = responses[len(requests) - 1]
        yield {"delta": raw, "finish_reason": None}
        yield {"delta": "", "finish_reason": "stop"}

    monkeypatch.setattr(teaching, "chat_stream_completion", fake_chat_stream_completion)
    profile = LlmProfile(
        id="prof_test",
        provider="openai_compatible",
        base_url="https://example.test/v1",
        api_key="test-key",
        model="test-model",
        timeout_ms=30000,
        temperature=0.2,
        max_output_tokens=1200,
    )
    session = {
        "id": "sess_test",
        "problem_text": "已知等比数列，求 a3。",
        "student_initial_thought": "我算到正负一。",
        "phase": "recovering",
    }

    async def collect_events():
        return [event async for event in teaching.generate_tutor_turn_stream(profile, session, [])]

    events = asyncio.run(collect_events())

    assert len(requests) == 2
    assert any(kind == "message_reset" for kind, _ in events)
    assert "action 不对" in requests[1][-1]["content"]
    assert "ASK_OPEN_QUESTION" in requests[1][-1]["content"]
    turn = next(value for kind, value in events if kind == "turn")
    assert turn.action == "ASK_OPEN_QUESTION"
    assert turn.debug["format_retry_count"] == 1


@pytest.mark.parametrize("action", [None, "NOT_A_REAL_ACTION", "SHOW_CHECKPOINT_MC"])
def test_tutor_turn_requires_present_and_valid_action(action):
    payload = {
        "state_hint": "explaining",
        "message": "测试 action 合同。",
        "checkpoint": None,
        "debug": {},
    }
    if action is not None:
        payload["action"] = action

    with pytest.raises(teaching.TutorTurnActionError):
        teaching.parse_and_validate_tutor_turn(json.dumps(payload, ensure_ascii=False))


def test_tutor_turn_rejects_history_envelope_extra_fields():
    raw = json.dumps(
        {
            "kind": "teaching_action",
            "message_action": {
                "id": "act_previous",
                "type": "EXPLAIN_LOCAL",
                "blocking": False,
            },
            "state_hint": "explaining",
            "action": "EXPLAIN_LOCAL",
            "message": "不能把历史 envelope 当成新的 TutorTurn。",
            "checkpoint": None,
            "debug": {},
        },
        ensure_ascii=False,
    )

    with pytest.raises(teaching.ValidationError):
        teaching.parse_and_validate_tutor_turn(raw)
