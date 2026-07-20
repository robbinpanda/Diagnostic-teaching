from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.llm.local_demo_provider import (
    is_workflow_control_message,
    local_demo_knowledge_card,
    local_demo_problem_card,
    local_demo_response,
    local_demo_stream,
    message_text,
)

__all__ = [
    "IMAGE_ANALYSIS_PROMPT",
    "LlmProfile",
    "LlmProviderError",
    "_anthropic_response_events",
    "analyze_problem_image",
    "anthropic_messages_url",
    "anthropic_request_payload",
    "chat_completion",
    "chat_completions_url",
    "chat_stream_completion",
    "is_workflow_control_message",
    "local_demo_knowledge_card",
    "local_demo_problem_card",
    "local_demo_response",
    "local_demo_stream",
    "message_text",
    "test_connection",
    "test_multimodal_connection",
]


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


IMAGE_ANALYSIS_PROMPT = """你是数学题图片录入助手，不是解题助手或学情评估助手。请识别图片中的数学题和学生实际写下的内容，并只返回 JSON，不要 Markdown。

必须返回这些字段：
{
  "problem_text": "可直接用于前端 KaTeX 渲染的题目文字，包含题干、条件、问题；如果有图形信息，也要用文字描述关键几何/函数/统计图信息",
  "needs_diagram": true,
  "diagram_bbox": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0} 或 null,
  "student_work_summary": "按图片中可见内容和书写顺序，较完整地客观转录学生写出的每一步计算、推导、改写或涂改；没有过程则为空字符串",
  "answer_text": "学生在图片中实际写出的最终答案；没有则为空字符串",
  "correctness": "correct|incorrect|unknown|not_present",
  "mistake_summary": "客观记录图片中所有明确可见的批改痕迹，包括红笔或其他批改颜色的勾、叉、圈、划线、得分和文字批注，并说明它标在哪一步或哪个答案附近；没有则为空字符串"
}

要求：
- 严格区分印刷的题目、学生书写内容和教师批改痕迹。problem_text 只录入题目，不要把学生作答或批改内容混入题目。
- problem_text 必须使用可直接交给 KaTeX 的数学格式：所有数学变量、数字关系、公式、方程、不等式、几何符号都放在 `$...$` 中；独立成行的公式可用 `$$...$$`。使用合法 LaTeX 命令，例如 `\\frac{a}{b}`、`\\sqrt{x}`、`x^2`、`\\angle ABC`，JSON 中的反斜杠必须正确转义。不要把 `x^2`、`1/2`、`√x` 等数学表达裸写在定界符外。
- problem_text 是纯题目正文，不要使用 Markdown 标题、列表符号或代码块；中文说明和标点放在数学定界符外。
- student_work_summary 和 answer_text 中出现的数学表达也使用同样的 `$...$` / `$$...$$` KaTeX 格式。
- student_work_summary 只能描述学生确实写在图片上的式子、步骤和文字，按可见顺序尽量逐行忠实转录。不要把多行有效过程压缩成“学生进行了一些计算”之类的笼统一句，也不要省略清晰可辨的中间式、改写和划掉后重写的内容。
- 禁止根据题目、最终答案、常见解法或上下文补全中间步骤；禁止推测学生使用了什么方法、为什么这样做、理解了什么、卡在哪里或犯了什么错。
- 图片中只有最终答案、没有计算或推导过程时，student_work_summary 必须为空字符串，只把该答案原样放入 answer_text。例如只看到“x=2”，不得扩写成“学生通过解方程得到 x=2”。
- 看不清或无法确定归属的书写内容应省略，不要猜测；不要把标准答案当成学生答案。
- correctness 只依据图片中明确可见的对勾、叉号、得分或批注意义填写；不得自行计算或推理答案对错。有学生答案但没有明确批改依据时填 unknown，没有学生答案时填 not_present。
- mistake_summary 不只记录文字批注：只要看见红笔或其他明显批改颜色的勾、叉、圈、划线、得分、改错痕迹或批语，就必须记录。尽量说明标记的位置和它对应的学生步骤；不得把勾叉解释成图片中没有写出的具体数学错误原因，也不得自行诊断错误。没有任何明确批改痕迹时才返回空字符串。
- diagram_bbox 使用整张图片归一化坐标，x/y/width/height 都在 0 到 1 之间，框住题目需要保留的图形区域。
- 如果题目没有必要展示图，needs_diagram=false 且 diagram_bbox=null。
- 如果无法识别题目文字，problem_text 返回空字符串。
"""


def chat_completions_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/chat/completions"):
        return clean
    return f"{clean}/chat/completions"


def anthropic_messages_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/messages"):
        return clean
    return f"{clean}/messages"


async def test_connection(profile: LlmProfile) -> tuple[bool, int | None, str]:
    if profile.provider == "local_demo":
        return True, 1, "本地演示模型可用"
    return await _test_messages(
        profile,
        [{"role": "user", "content": "你好"}],
        success_prefix="连接成功，模型已开始回复",
        max_tokens=min(max(profile.max_output_tokens, 1024), 8192),
    )


async def test_multimodal_connection(
    profile: LlmProfile,
    image_data_url: str,
    expected_answer: str,
) -> tuple[bool, int | None, str]:
    if profile.provider == "local_demo":
        return True, 1, "本地演示模型支持图片输入"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "读取图片中从左到右的两个彩色图形，只返回两项，格式为 "
                        "COLOR_SHAPE|COLOR_SHAPE。"
                        "颜色只能使用 RED/BLUE/YELLOW/GREEN，形状只能使用 "
                        "CIRCLE/SQUARE/TRIANGLE/DIAMOND。不要解释；看不到图片就回复 UNREADABLE。"
                    ),
                },
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    ]
    started = time.perf_counter()
    latency: int | None = None
    chunks: list[str] = []
    probe_max_tokens = min(max(profile.max_output_tokens, 1024), 8192)
    stream = chat_stream_completion(
        profile,
        messages,
        max_tokens=probe_max_tokens,
        temperature=0,
    )
    try:
        async for event in stream:
            delta = event.get("delta") or ""
            if not delta:
                continue
            if latency is None and delta.strip():
                latency = int((time.perf_counter() - started) * 1000)
            chunks.append(delta)
        response_text = "".join(chunks).strip()
        if not response_text:
            raise LlmProviderError("模型没有返回可见内容")
        actual_answer = _extract_multimodal_probe_answer(response_text)
        if actual_answer != expected_answer:
            preview = response_text.replace("\n", " ")[:120]
            return False, latency, f"模型返回了文字，但未正确识别测试图片：{preview}"
        return True, latency, "图片内容识别正确"
    except Exception as exc:  # pragma: no cover - exact provider errors vary
        elapsed = int((time.perf_counter() - started) * 1000)
        return False, latency if latency is not None else elapsed, str(exc)
    finally:
        await stream.aclose()


def _extract_multimodal_probe_answer(content: str) -> str:
    pairs = re.findall(
        r"\b(RED|BLUE|YELLOW|GREEN)\s*[_-]\s*(CIRCLE|SQUARE|TRIANGLE|DIAMOND)\b",
        content.upper(),
    )
    return "|".join(f"{color}_{shape}" for color, shape in pairs)


async def _test_messages(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
    *,
    success_prefix: str,
    max_tokens: int,
) -> tuple[bool, int | None, str]:
    started = time.perf_counter()
    stream = chat_stream_completion(
        profile,
        messages,
        max_tokens=max_tokens,
        temperature=0,
    )
    try:
        async for event in stream:
            delta = event.get("delta") or ""
            if delta.strip():
                latency = int((time.perf_counter() - started) * 1000)
                preview = delta.strip().replace("\n", " ")[:40]
                return True, latency, f"{success_prefix}：{preview}"
        raise LlmProviderError("模型没有返回可见内容")
    except Exception as exc:  # pragma: no cover - exact provider errors vary
        latency = int((time.perf_counter() - started) * 1000)
        return False, latency, str(exc)
    finally:
        await stream.aclose()


async def chat_completion(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
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
    _assert_nonempty(content, finish_reason, max_tokens or profile.max_output_tokens)
    return content


async def analyze_problem_image(profile: LlmProfile, image_data_url: str) -> str:
    if profile.provider == "local_demo":
        return json.dumps(
            {
                "problem_text": "已知函数 $y=-2(x-3)^2+5$，求函数的最大值，并说明此时 $x$ 的取值。",
                "needs_diagram": False,
                "diagram_bbox": None,
                "student_work_summary": "",
                "answer_text": "",
                "correctness": "not_present",
                "mistake_summary": "",
            },
            ensure_ascii=False,
        )

    return await chat_completion(
        profile,
        [
            {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这张数学题图片，按指定 JSON 返回。"},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        max_tokens=min(max(profile.max_output_tokens, 4000), 16000),
        temperature=0,
    )


def _assert_nonempty(
    content: str, finish_reason: str | None, max_tokens: int | None = None
) -> None:
    if not content:
        if finish_reason == "length":
            token_hint = f"={max_tokens}" if max_tokens is not None else ""
            raise LlmProviderError(
                f"模型因 max_tokens{token_hint} 截断未输出任何可见内容，请调大 max_output_tokens 或精简历史"
            )
        raise LlmProviderError("模型返回了空内容，请重试或换一道题")


async def chat_stream_completion(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
):
    """按 profile 协议流式调用模型，逐 chunk yield {delta, finish_reason}。

    OpenAI-compatible 使用 chat completions，Anthropic 使用 Messages API。
    httpx 的 read 超时按两次 chunk 之间计算，避免长思考被静默截断成空响应。
    """
    if profile.provider == "local_demo":
        for event in local_demo_stream(messages):
            yield event
        return

    if profile.provider == "anthropic":
        async for event in _anthropic_stream_completion(
            profile,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            yield event
        return

    async for event in _openai_chat_stream_completion(
        profile,
        messages,
        max_tokens=max_tokens,
        temperature=temperature,
    ):
        yield event


async def _openai_chat_stream_completion(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int | None,
    temperature: float | None,
):

    headers = {
        "Authorization": f"Bearer {profile.api_key}",
        "Content-Type": "application/json",
    }
    requested_max_tokens = max_tokens or profile.max_output_tokens
    payload: dict[str, Any] = {
        "model": profile.model,
        "messages": messages,
        "temperature": profile.temperature if temperature is None else temperature,
        "max_tokens": requested_max_tokens,
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
                    raise LlmProviderError(
                        "模型流式响应中没有任何 data 事件，请确认 base_url/模型配置"
                    )
                if not saw_content:
                    _assert_nonempty("", finish_reason, requested_max_tokens)
                yield {"delta": "", "finish_reason": finish_reason}
    except httpx.TimeoutException as exc:
        raise LlmProviderError(
            "模型流式响应超时：长时间没有收到可见内容，请重试或换一个模型配置"
        ) from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"模型请求异常：{str(exc) or exc.__class__.__name__}") from exc


async def _anthropic_stream_completion(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int | None,
    temperature: float | None,
):
    headers = {
        "x-api-key": profile.api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    requested_max_tokens = max_tokens or profile.max_output_tokens
    payload = anthropic_request_payload(
        profile,
        messages,
        max_tokens=requested_max_tokens,
        temperature=profile.temperature if temperature is None else temperature,
    )
    connect_timeout = min(profile.timeout_ms / 1000, 10.0)
    read_timeout = max(profile.timeout_ms / 1000, 60.0)
    timeout = httpx.Timeout(connect_timeout, read=read_timeout, write=10.0, pool=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                anthropic_messages_url(profile.base_url),
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise LlmProviderError(
                        f"Anthropic 模型请求失败 {response.status_code}: "
                        f"{body.decode('utf-8', 'ignore')[:300]}"
                    )
                async for event in _anthropic_response_events(response, requested_max_tokens):
                    yield event
    except httpx.TimeoutException as exc:
        raise LlmProviderError(
            "Anthropic 流式响应超时：长时间没有收到可见内容，请重试或换一个模型配置"
        ) from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(
            f"Anthropic 模型请求异常：{str(exc) or exc.__class__.__name__}"
        ) from exc


def anthropic_request_payload(
    profile: LlmProfile,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []
    for message in messages:
        if message.get("role") == "system":
            text = message_text(message.get("content"))
            if text:
                system_parts.append(text)
            continue
        role = "assistant" if message.get("role") == "assistant" else "user"
        blocks = _anthropic_content_blocks(message.get("content"))
        if converted and converted[-1]["role"] == role:
            converted[-1]["content"].extend(blocks)
            continue
        converted.append({"role": role, "content": blocks})

    payload: dict[str, Any] = {
        "model": profile.model,
        "messages": converted,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    return payload


def _anthropic_content_blocks(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if not isinstance(content, list):
        return [{"type": "text", "text": str(content or "")}]

    blocks: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            blocks.append({"type": "text", "text": str(item.get("text") or "")})
            continue
        if item.get("type") != "image_url":
            continue
        image_url = item.get("image_url")
        url = image_url.get("url") if isinstance(image_url, dict) else None
        if not isinstance(url, str) or not url:
            continue
        if url.startswith("data:") and ";base64," in url:
            metadata, data = url.split(",", 1)
            media_type = metadata.removeprefix("data:").removesuffix(";base64")
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data,
                    },
                }
            )
            continue
        blocks.append({"type": "image", "source": {"type": "url", "url": url}})
    return blocks


async def _anthropic_response_events(response: Any, requested_max_tokens: int):
    saw_any_data = False
    saw_content = False
    finish_reason: str | None = None
    async for raw_line in response.aiter_lines():
        line = raw_line.strip()
        if not line or not line.startswith("data:"):
            continue
        saw_any_data = True
        data_str = line[len("data:") :].strip()
        try:
            event = json.loads(data_str)
        except json.JSONDecodeError:
            continue
        event_type = event.get("type")
        if event_type == "error":
            error = event.get("error")
            message = (
                error.get("message") if isinstance(error, dict) else str(error or "unknown error")
            )
            raise LlmProviderError(f"Anthropic 流式响应错误：{message}")
        text = ""
        if event_type == "content_block_start":
            block = event.get("content_block")
            if isinstance(block, dict) and block.get("type") == "text":
                text = str(block.get("text") or "")
        elif event_type == "content_block_delta":
            delta = event.get("delta")
            if isinstance(delta, dict) and delta.get("type") == "text_delta":
                text = str(delta.get("text") or "")
        elif event_type == "message_delta":
            delta = event.get("delta")
            if isinstance(delta, dict) and delta.get("stop_reason"):
                finish_reason = str(delta["stop_reason"])
        elif event_type == "message_stop":
            finish_reason = finish_reason or "end_turn"
        if text:
            saw_content = True
            yield {"delta": text, "finish_reason": None}

    if not saw_any_data:
        raise LlmProviderError("Anthropic 流式响应中没有任何 data 事件，请确认 base_url/模型配置")
    if not saw_content:
        _assert_nonempty(
            "", "length" if finish_reason == "max_tokens" else finish_reason, requested_max_tokens
        )
    yield {"delta": "", "finish_reason": finish_reason}
