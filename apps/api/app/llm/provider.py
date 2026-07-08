from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class LlmProfile:
    id: str
    provider: str
    base_url: str
    api_key: str
    model: str
    timeout_ms: int
    temperature: float
    max_output_tokens: int


class LlmProviderError(RuntimeError):
    pass


def chat_completions_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    return f"{clean}/chat/completions"


async def test_connection(profile: LlmProfile) -> tuple[bool, int | None, str]:
    started = time.perf_counter()
    if profile.provider == "local_demo":
        return True, 1, "本地演示模型可用"
    try:
        await chat_completion(
            profile,
            [
                {"role": "system", "content": "Return exactly: ok"},
                {"role": "user", "content": "ping"},
            ],
            max_tokens=8,
            temperature=0,
        )
        latency = int((time.perf_counter() - started) * 1000)
        return True, latency, "连接成功"
    except Exception as exc:  # pragma: no cover - exact provider errors vary
        latency = int((time.perf_counter() - started) * 1000)
        return False, latency, str(exc)


async def chat_completion(
    profile: LlmProfile,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """非流式：accumulate 整个流后返回完整字符串。

    保留供测试/降级使用；主答疑链路用 chat_stream_completion。
    """
    chunks: list[str] = []
    finish_reason: str | None = None
    async for event in chat_stream_completion(
        profile, messages, max_tokens=max_tokens, temperature=temperature
    ):
        if event["delta"]:
            chunks.append(event["delta"])
        if event.get("finish_reason"):
            finish_reason = event["finish_reason"]
    content = "".join(chunks)
    _assert_nonempty(content, finish_reason)
    return content


def _assert_nonempty(content: str, finish_reason: str | None) -> None:
    if not content:
        if finish_reason == "length":
            raise LlmProviderError(
                "模型因 max_tokens 截断未输出任何可见内容，请调大 max_output_tokens 或精简历史"
            )
        raise LlmProviderError("模型返回了空内容，请重试或换一道题")


async def chat_stream_completion(
    profile: LlmProfile,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
):
    """流式 chat completions，逐 chunk yield {delta, finish_reason}。

    用 stream=true 让模型一边生成一边吐 token，httpx 的 read 超时按"两次 chunk
    之间"计算而非整体 30s，避免长思考被静默截断成空响应。
    """
    if profile.provider == "local_demo":
        for event in local_demo_stream(messages):
            yield event
        return

    headers = {
        "Authorization": f"Bearer {profile.api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": profile.model,
        "messages": messages,
        "temperature": profile.temperature if temperature is None else temperature,
        "max_tokens": max_tokens or profile.max_output_tokens,
        "stream": True,
    }
    # connect 慢点不要紧，但读阶段一旦长时间没新 chunk 就要尽快报错；
    # 把 read 设短到比总 timeout 更激进，整体 timeout 仍兜底
    connect_timeout = min(profile.timeout_ms / 1000, 10.0)
    read_timeout = max(profile.timeout_ms / 1000, 60.0)
    timeout = httpx.Timeout(connect_timeout, read=read_timeout, write=10.0, pool=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", chat_completions_url(profile.base_url), headers=headers, json=payload
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise LlmProviderError(
                        f"模型请求失败 {response.status_code}: {body.decode('utf-8', 'ignore')[:300]}"
                    )
                finish_reason: str | None = None
                saw_any_data = False
                saw_content = False
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    saw_any_data = True
                    data_str = line[len("data:") :].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    try:
                        choice = chunk["choices"][0]
                    except (KeyError, IndexError, TypeError):
                        continue
                    delta = choice.get("delta", {}).get("content") or ""
                    if delta:
                        saw_content = True
                        yield {"delta": delta, "finish_reason": None}
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                if not saw_any_data:
                    raise LlmProviderError("模型流式响应中没有任何 data 事件，请确认 base_url/模型配置")
                if not saw_content:
                    _assert_nonempty("", finish_reason)
                yield {"delta": "", "finish_reason": finish_reason}
    except httpx.TimeoutException as exc:
        raise LlmProviderError("模型流式响应超时：长时间没有收到可见内容，请重试或换一个模型配置") from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"模型请求异常：{str(exc) or exc.__class__.__name__}") from exc


def local_demo_stream(messages: list[dict[str, str]]) -> list[dict]:
    """local_demo 的等价流式：把 local_demo_response 拆成小 chunk 发出。"""
    full = local_demo_response(messages)
    # 按 ~4 个字符一组模拟流式打字
    step = 4
    for i in range(0, len(full), step):
        yield {"delta": full[i : i + step], "finish_reason": None}
    yield {"delta": "", "finish_reason": "stop"}


def local_demo_response(messages: list[dict[str, str]]) -> str:
    joined = "\n".join(message["content"] for message in messages[-3:])
    last_user = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"),
        "",
    )
    # 学生刚回答检查点的标志是 prompt 末尾出现"选了：..."字样（前端 handleCheckpoint 把
    # "我在检查点「...」选了：X 文本"作为 student 消息送进来）。注意历史里可能也含"我不知道"
    # 这类词（如学生初始思路），所以只取最后一次"选了：..."之后的内容判断，避免误判。
    answer_match = None
    for m in re.finditer(r"选了：\s*([^\n]+)", last_user):
        answer_match = m.group(1)
    if "选了：" in last_user and answer_match is not None:
        answer = answer_match.strip()
        if answer.startswith("UNKNOWN") or "我不知道" in answer:
            message = "没关系，我们从原理开始：平方项永远不小于 0，所以当它前面带负号时，平方项越大，整体反而越小。要拿到最大值，应该让平方项取到 0。再想想这道题里 x 取多少时 (x-3)^2 会等于 0？"
            phase = "recovering"
        elif answer.startswith("A") or "尽量小" in answer or "为 0" in answer:
            message = "对了。平方项 (x-3)^2 当 x=3 时为 0，这时整体 -2(x-3)^2+5 取到最大值 5。可以继续：如果题目改成求最小值呢？"
            phase = "scaffolding"
        else:
            message = "这里有个误区：平方项本身不会小于 0，但前面有负号，所以平方项越大整体越小，最大值出现在平方项最小（为 0）的时候。我们先把这一点钉死，再往下走。"
            phase = "recovering"
        payload = {
            "phase": phase,
            "action": "EXPLAIN_LOCAL",
            "message": message,
            "breakpoint_description": "已根据检查点选择推进",
            "breakpoint_confidence": 0.8,
            "checkpoint": None,
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
        "phase": "checking",
        "action": "SHOW_CHECKPOINT_MC",
        "message": "我先不从头讲完整题，先抓你现在最可能卡住的一点：带负号的平方项会怎样影响最大值。",
        "breakpoint_description": "不确定平方项和负系数怎样共同影响函数最大值",
        "breakpoint_confidence": 0.68,
        "checkpoint": checkpoint,
        "debug": {"source": "local_demo", "recent": joined[-120:]},
    }
    return json.dumps(payload, ensure_ascii=False)
