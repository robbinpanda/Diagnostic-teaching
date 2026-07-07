from __future__ import annotations

import json
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
    if profile.provider == "local_demo":
        return local_demo_response(messages)

    headers = {
        "Authorization": f"Bearer {profile.api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": profile.model,
        "messages": messages,
        "temperature": profile.temperature if temperature is None else temperature,
        "max_tokens": max_tokens or profile.max_output_tokens,
    }
    timeout = httpx.Timeout(profile.timeout_ms / 1000)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(chat_completions_url(profile.base_url), headers=headers, json=payload)
    if response.status_code >= 400:
        raise LlmProviderError(f"模型请求失败 {response.status_code}: {response.text[:300]}")
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmProviderError("模型响应格式不是 OpenAI-compatible chat completions") from exc


def local_demo_response(messages: list[dict[str, str]]) -> str:
    joined = "\n".join(message["content"] for message in messages[-3:])
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
