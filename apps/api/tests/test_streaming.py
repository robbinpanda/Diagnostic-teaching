import asyncio
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app.core.streaming import MessageStreamExtractor
from app.llm import provider
from app.llm.provider import (
    LlmEmptyResponseError,
    LlmProfile,
    LlmProviderError,
    _anthropic_response_events,
    _openai_responses_events,
    anthropic_messages_url,
    anthropic_request_payload,
    chat_stream_completion,
    openai_responses_request_payload,
    provider_retry_delay_seconds,
    responses_url,
)


def test_provider_retry_delay_honors_headers_and_exponential_jitter():
    assert provider_retry_delay_seconds(
        LlmProviderError(
            "busy",
            response_headers={"retry-after-ms": "1500"},
            retryable=True,
        ),
        1,
    ) == 1.5
    assert provider_retry_delay_seconds(
        LlmProviderError(
            "busy",
            response_headers={"retry-after": "7"},
            retryable=True,
        ),
        1,
    ) == 7.0
    assert provider_retry_delay_seconds(
        LlmProviderError(
            "busy",
            response_headers={"retry-after": "Wed, 05 Aug 2026 08:00:09 GMT"},
            retryable=True,
        ),
        1,
        now=datetime(2026, 8, 5, 8, 0, 0, tzinfo=timezone.utc),
    ) == 9.0
    error = LlmProviderError("busy", retryable=True)
    assert provider_retry_delay_seconds(error, 1, jitter=1.0) == 2.0
    assert provider_retry_delay_seconds(error, 2, jitter=1.0) == 4.0
    assert provider_retry_delay_seconds(error, 5, jitter=1.0) == 30.0


def test_provider_error_diagnostic_keeps_transport_context():
    error = LlmProviderError(
        "server overloaded",
        status_code=503,
        response_headers={"retry-after": "4", "x-request-id": "req_1"},
        phase="response_headers",
        saw_content=False,
        retryable=True,
        code="provider_http_error",
    )

    assert error.diagnostic() == {
        "code": "provider_http_error",
        "message": "server overloaded",
        "status_code": 503,
        "response_headers": {"retry-after": "4", "x-request-id": "req_1"},
        "phase": "response_headers",
        "saw_content": False,
        "retryable": True,
    }


def _profile(provider="local_demo"):
    return LlmProfile(
        id="prof_test",
        provider=provider,
        base_url="https://local.demo/v1",
        api_key="demo-key",
        model="local-demo",
        timeout_ms=30000,
        temperature=0.2,
        max_output_tokens=1200,
    )


def test_extractor_yields_message_segments_incrementally():
    ex = MessageStreamExtractor()
    # 把一个标准 JSON 分多次喂进去，验证每次只拿到已确定的可见字符
    raw_chunks = [
        '{"phase":"checking","action":"ASK_MULTIPLE_CHOICE",',
        '"message":"抓一个',
        "点：平方项要尽量小，",
        '最好为 0。","checkpoint":null}',
    ]
    seen = ""
    for chunk in raw_chunks:
        inc = ex.feed(chunk)
        seen += inc
    # message 字段提取出来的内容（含中文逗号）应当是这段
    assert "抓一个点：平方项要尽量小，最好为 0。" in seen
    assert ex.finished


def test_extractor_handles_escaped_quotes_and_unicode():
    ex = MessageStreamExtractor()
    # message 内容里含转义引号和 \u 转义的中文字符
    raw = '{"message":"a\\"b\\u4e2d\\u6587\\\\c","checkpoint":null}'
    # 按单字符增量喂，模拟流式
    seen = ""
    for i in range(len(raw)):
        seen += ex.feed(raw[i])
    assert seen == 'a"b中文\\c'
    assert ex.finished


def test_extractor_handles_truncated_escape_across_chunk_boundary():
    ex = MessageStreamExtractor()
    # 切在 \u 之中：第一段只到 "\u4e2"，下一段补 "d}" 才构成 \u4e2d = "中"
    raw_part1 = '{"message":"\\u4e2'
    raw_part2 = 'd"}'
    inc1 = ex.feed(raw_part1)
    inc2 = ex.feed(raw_part2)
    # 第一段不应误吐（\uXXXX 未完整）
    assert inc1 == ""
    assert inc2 == "中"  # 补全后吐出 "中"


def test_local_demo_stream_emits_deltas_then_finish():
    """local_demo 走 chat_stream_completion 时应拿到逐 chunk delta + 最终 finish_reason"""

    async def run():
        profile = _profile()
        deltas = ""
        finish = None
        async for event in chat_stream_completion(
            profile,
            [{"role": "system", "content": "S"}, {"role": "user", "content": "U"}],
            max_tokens=2000,
        ):
            if event["delta"]:
                deltas += event["delta"]
            if event.get("finish_reason"):
                finish = event["finish_reason"]
        return deltas, finish

    deltas, finish = asyncio.run(run())
    assert deltas.strip() != ""
    assert "state_hint" in deltas  # local_demo 输出的 JSON
    assert finish == "stop"


def test_profile_factory_local_demo_works():
    """确保 LlmProfile 仍可被构造（流式调用前置条件）"""
    p = _profile()
    assert p.provider == "local_demo"
    assert p.model == "local-demo"


def test_connection_probe_uses_profile_temperature_and_token_budget(monkeypatch):
    captured = {}
    consumed_after_first_chunk = False

    async def fake_chat_stream_completion(profile, messages, *, max_tokens=None, temperature=None):
        nonlocal consumed_after_first_chunk
        captured["messages"] = messages
        captured["max_tokens"] = max_tokens
        captured["temperature"] = temperature
        yield {"delta": "你", "finish_reason": None}
        consumed_after_first_chunk = True
        yield {"delta": "好，我可以正常回复。", "finish_reason": None}

    monkeypatch.setattr(provider, "chat_stream_completion", fake_chat_stream_completion)

    async def run():
        return await provider.test_connection(
            replace(_profile("openai_compatible"), temperature=0.6)
        )

    ok, latency, message = asyncio.run(run())

    assert ok is True
    assert latency is not None
    assert "连接成功" in message
    assert captured["messages"] == [{"role": "user", "content": "你好"}]
    assert captured["max_tokens"] == 1200
    assert captured["temperature"] == 0.6
    assert consumed_after_first_chunk is False


def test_multimodal_probe_requires_correct_visual_answer_and_uses_profile_budget(monkeypatch):
    captured = {}

    async def fake_chat_stream_completion(profile, messages, *, max_tokens=None, temperature=None):
        captured["messages"] = messages
        captured["max_tokens"] = max_tokens
        captured["temperature"] = temperature
        yield {"delta": "RED_CIRCLE|BLUE_", "finish_reason": None}
        yield {"delta": "SQUARE", "finish_reason": None}
        yield {"delta": "", "finish_reason": "stop"}

    monkeypatch.setattr(provider, "chat_stream_completion", fake_chat_stream_completion)

    async def run():
        return await provider.test_multimodal_connection(
            replace(
                _profile("openai_compatible"),
                max_output_tokens=8000,
                temperature=0.6,
            ),
            "data:image/png;base64,dGVzdA==",
            "RED_CIRCLE|BLUE_SQUARE",
        )

    ok, latency, message = asyncio.run(run())

    assert ok is True
    assert latency is not None
    assert message == "图片内容识别正确"
    assert captured["max_tokens"] == 8000
    assert captured["temperature"] == 0.6
    content = captured["messages"][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_multimodal_probe_rejects_generic_text_reply(monkeypatch):
    async def fake_chat_stream_completion(profile, messages, *, max_tokens=None, temperature=None):
        yield {"delta": "OK，我可以读取图片。", "finish_reason": None}
        yield {"delta": "", "finish_reason": "stop"}

    monkeypatch.setattr(provider, "chat_stream_completion", fake_chat_stream_completion)

    async def run():
        return await provider.test_multimodal_connection(
            _profile("openai_compatible"),
            "data:image/png;base64,dGVzdA==",
            "RED_CIRCLE|BLUE_SQUARE",
        )

    ok, latency, message = asyncio.run(run())

    assert ok is False
    assert latency is not None
    assert "未正确识别测试图片" in message


def test_multimodal_probe_does_not_inject_prompt_level_effort_guidance(monkeypatch):
    captured = {}

    async def fake_chat_stream_completion(profile, messages, *, max_tokens=None, temperature=None):
        captured["messages"] = messages
        yield {"delta": "RED_CIRCLE|BLUE_SQUARE", "finish_reason": "stop"}

    monkeypatch.setattr(provider, "chat_stream_completion", fake_chat_stream_completion)

    async def run():
        return await provider.test_multimodal_connection(
            replace(_profile("openai_compatible"), reasoning_effort="low"),
            "data:image/png;base64,dGVzdA==",
            "RED_CIRCLE|BLUE_SQUARE",
        )

    ok, _, _ = asyncio.run(run())

    assert ok is True
    assert captured["messages"][0]["role"] == "user"
    assert captured["messages"][0]["content"][1]["type"] == "image_url"


def test_structured_intake_calls_keep_task_prompts_and_profile_temperature(monkeypatch):
    captured = []

    async def fake_chat_completion(profile, messages, *, max_tokens=None, temperature=None):
        captured.append((messages, temperature))
        return "{}"

    monkeypatch.setattr(provider, "chat_completion", fake_chat_completion)
    profile = replace(
        _profile("openai_compatible"),
        reasoning_effort="high",
        temperature=0.6,
    )

    async def run():
        await provider.analyze_problem_image(profile, "data:image/png;base64,dGVzdA==")
        await provider.detect_problem_regions(profile, "data:image/png;base64,dGVzdA==")
        await provider.analyze_problem_text(profile, "计算 $1+1$。")

    asyncio.run(run())

    assert len(captured) == 3
    assert [temperature for _, temperature in captured] == [0.6, 0.6, 0.6]
    for messages, _ in captured[:2]:
        system_prompt = messages[0]["content"]
        assert "数学题图片录入助手" in system_prompt or "数学试题与学生作答区域检测助手" in system_prompt
        assert "TutorTurn" not in system_prompt
        assert "message 为第一个字段" not in system_prompt
    assert "数学题目拆分助手" in captured[2][0][0]["content"]


def test_provider_types_route_to_their_bound_protocols(monkeypatch):
    called = []

    async def fake_responses(*args, **kwargs):
        called.append("responses")
        yield {"delta": "R", "finish_reason": "stop"}

    async def fake_chat_completions(*args, **kwargs):
        called.append("chat_completions")
        yield {"delta": "C", "finish_reason": "stop"}

    async def fake_anthropic(*args, **kwargs):
        called.append("anthropic_messages")
        yield {"delta": "A", "finish_reason": "end_turn"}

    monkeypatch.setattr(provider, "_openai_responses_stream_completion", fake_responses)
    monkeypatch.setattr(provider, "_openai_chat_stream_completion", fake_chat_completions)
    monkeypatch.setattr(provider, "_anthropic_stream_completion", fake_anthropic)

    async def run():
        for provider_name in ("openai", "openai_compatible", "anthropic"):
            async for _ in chat_stream_completion(
                _profile(provider_name), [{"role": "user", "content": "你好"}]
            ):
                pass

    asyncio.run(run())

    assert called == ["responses", "chat_completions", "anthropic_messages"]


def test_openai_responses_payload_maps_system_image_and_reasoning_fields():
    profile = replace(_profile("openai"), reasoning_effort="high")
    payload = openai_responses_request_payload(
        profile,
        [
            {"role": "system", "content": "系统规则"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "看图"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,aW1hZ2U=",
                            "detail": "original",
                        },
                    },
                ],
            },
            {"role": "assistant", "content": "收到"},
        ],
        max_output_tokens=8000,
        temperature=0.2,
    )

    assert responses_url("https://api.openai.com/v1") == "https://api.openai.com/v1/responses"
    assert payload == {
        "model": "local-demo",
        "instructions": "系统规则",
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "看图"},
                    {
                        "type": "input_image",
                        "image_url": "data:image/png;base64,aW1hZ2U=",
                        "detail": "original",
                    },
                ],
            },
            {"role": "assistant", "content": "收到"},
        ],
        "temperature": 0.2,
        "max_output_tokens": 8000,
        "stream": True,
        "reasoning": {"effort": "high"},
    }
    assert "messages" not in payload
    assert "max_tokens" not in payload
    assert "reasoning_effort" not in payload


def test_openai_responses_payload_continues_from_last_persisted_response():
    profile = _profile("openai")
    payload = openai_responses_request_payload(
        profile,
        [
            {"role": "system", "content": "系统规则"},
            {"role": "user", "content": "第一问"},
            {
                "role": "assistant",
                "content": "第一答",
                "_provider_response": {
                    "provider": "openai",
                    "model_profile_id": profile.id,
                    "model": profile.model,
                    "id": "resp_previous",
                },
            },
            {"role": "user", "content": "第二问"},
        ],
        max_output_tokens=8000,
        temperature=0.2,
    )

    assert payload["previous_response_id"] == "resp_previous"
    assert payload["instructions"] == "系统规则"
    assert payload["input"] == [{"role": "user", "content": "第二问"}]

    replay_payload = openai_responses_request_payload(
        profile,
        [
            {"role": "system", "content": "系统规则"},
            {"role": "user", "content": "第一问"},
            {
                "role": "assistant",
                "content": "第一答",
                "_provider_response": {
                    "provider": "openai",
                    "model_profile_id": profile.id,
                    "model": profile.model,
                    "id": "resp_previous",
                },
            },
            {"role": "user", "content": "第二问"},
        ],
        max_output_tokens=8000,
        temperature=0.2,
        use_previous_response_id=False,
    )

    assert "previous_response_id" not in replay_payload
    assert [item["role"] for item in replay_payload["input"]] == [
        "user",
        "assistant",
        "user",
    ]


def test_openai_responses_sse_yields_reasoning_text_and_stop_reason():
    class FakeResponse:
        async def aiter_lines(self):
            for line in [
                "event: response.created",
                'data: {"type":"response.created","response":{"status":"in_progress"}}',
                "event: response.output_item.added",
                'data: {"type":"response.output_item.added","item":{"type":"reasoning"}}',
                "event: response.output_text.delta",
                'data: {"type":"response.output_text.delta","delta":"你"}',
                'data: {"type":"response.output_text.delta","delta":"好"}',
                "event: response.completed",
                'data: {"type":"response.completed","response":{"id":"resp_123","status":"completed"}}',
            ]:
                yield line

    async def run():
        return [event async for event in _openai_responses_events(FakeResponse(), 8000)]

    events = asyncio.run(run())

    assert events == [
        {"event": "reasoning_delta", "delta": "", "finish_reason": None},
        {"event": "content_delta", "delta": "你", "finish_reason": None},
        {"event": "content_delta", "delta": "好", "finish_reason": None},
        {
            "event": "provider_response",
            "response_id": "resp_123",
            "delta": "",
            "finish_reason": None,
        },
        {"delta": "", "finish_reason": "stop"},
    ]


def test_openai_responses_incomplete_without_text_reports_token_limit():
    class FakeResponse:
        async def aiter_lines(self):
            yield (
                'data: {"type":"response.incomplete","response":{"status":"incomplete",'
                '"incomplete_details":{"reason":"max_output_tokens"}}}'
            )

    async def run():
        return [event async for event in _openai_responses_events(FakeResponse(), 1200)]

    with pytest.raises(LlmEmptyResponseError, match="max_tokens=1200"):
        asyncio.run(run())


def test_anthropic_payload_moves_system_and_converts_image_data_url():
    profile = _profile("anthropic")
    payload = anthropic_request_payload(
        profile,
        [
            {"role": "system", "content": "系统规则"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "看图"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,aW1hZ2U="}},
                ],
            },
            {"role": "user", "content": "补充说明"},
            {"role": "assistant", "content": "收到"},
        ],
        max_tokens=8000,
        temperature=0.2,
    )

    assert (
        anthropic_messages_url("https://api.anthropic.com/v1")
        == "https://api.anthropic.com/v1/messages"
    )
    assert payload["system"] == "系统规则"
    assert payload["model"] == "local-demo"
    assert payload["output_config"] == {"effort": "low"}
    assert [message["role"] for message in payload["messages"]] == ["user", "assistant"]
    user_blocks = payload["messages"][0]["content"]
    assert user_blocks[0] == {"type": "text", "text": "看图"}
    assert user_blocks[1] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "aW1hZ2U="},
    }
    assert user_blocks[2] == {"type": "text", "text": "补充说明"}


def test_anthropic_sse_yields_text_deltas_and_stop_reason():
    class FakeResponse:
        async def aiter_lines(self):
            for line in [
                "event: message_start",
                'data: {"type":"message_start","message":{"stop_reason":null}}',
                "event: content_block_delta",
                'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}',
                'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}',
                'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
                'data: {"type":"message_stop"}',
            ]:
                yield line

    async def run():
        return [event async for event in _anthropic_response_events(FakeResponse(), 8000)]

    events = asyncio.run(run())

    assert events == [
        {"event": "content_delta", "delta": "你", "finish_reason": None},
        {"event": "content_delta", "delta": "好", "finish_reason": None},
        {"delta": "", "finish_reason": "end_turn"},
    ]
