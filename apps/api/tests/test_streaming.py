import asyncio

import pytest

from app.core.streaming import MessageStreamExtractor
from app.llm.provider import LlmProfile, LlmProviderError, chat_stream_completion


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
        '{"phase":"checking","action":"SHOW_CHECKPOINT_MC",',
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
