import asyncio

from app.core.streaming import MessageStreamExtractor
from app.llm import provider
from app.llm.provider import (
    LlmProfile,
    _anthropic_response_events,
    anthropic_messages_url,
    anthropic_request_payload,
    chat_stream_completion,
)


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
        '点：平方项要尽量小，',
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


def test_connection_probe_uses_nihao_and_profile_token_budget(monkeypatch):
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
        return await provider.test_connection(_profile("openai_compatible"))

    ok, latency, message = asyncio.run(run())

    assert ok is True
    assert latency is not None
    assert "连接成功" in message
    assert captured["messages"] == [{"role": "user", "content": "你好"}]
    assert captured["max_tokens"] == 1200
    assert captured["temperature"] == 0
    assert consumed_after_first_chunk is False


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

    assert anthropic_messages_url("https://api.anthropic.com/v1") == "https://api.anthropic.com/v1/messages"
    assert payload["system"] == "系统规则"
    assert payload["model"] == "local-demo"
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
                'event: message_start',
                'data: {"type":"message_start","message":{"stop_reason":null}}',
                'event: content_block_delta',
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
        {"delta": "你", "finish_reason": None},
        {"delta": "好", "finish_reason": None},
        {"delta": "", "finish_reason": "end_turn"},
    ]
