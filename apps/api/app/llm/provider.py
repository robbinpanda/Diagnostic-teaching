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
) -> tuple[bool, int | None, str]:
    if profile.provider == "local_demo":
        return True, 1, "本地演示模型接受图片请求"
    return await _test_messages(
        profile,
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请确认你能读取这张测试图片，只回复 OK。"},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            }
        ],
        success_prefix="图片请求成功，模型已开始回复",
        max_tokens=128,
    )


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


def _assert_nonempty(content: str, finish_reason: str | None, max_tokens: int | None = None) -> None:
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
                    raise LlmProviderError("模型流式响应中没有任何 data 事件，请确认 base_url/模型配置")
                if not saw_content:
                    _assert_nonempty("", finish_reason, requested_max_tokens)
                yield {"delta": "", "finish_reason": finish_reason}
    except httpx.TimeoutException as exc:
        raise LlmProviderError("模型流式响应超时：长时间没有收到可见内容，请重试或换一个模型配置") from exc
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
        raise LlmProviderError("Anthropic 流式响应超时：长时间没有收到可见内容，请重试或换一个模型配置") from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"Anthropic 模型请求异常：{str(exc) or exc.__class__.__name__}") from exc


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
            message = error.get("message") if isinstance(error, dict) else str(error or "unknown error")
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
        _assert_nonempty("", "length" if finish_reason == "max_tokens" else finish_reason, requested_max_tokens)
    yield {"delta": "", "finish_reason": finish_reason}


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


def is_workflow_control_message(content: Any) -> bool:
    text = message_text(content)
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return False
    return isinstance(payload, dict) and payload.get("kind") == "workflow_continue"


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
                message = "你选择了“我不知道”，这很有价值：它说明目前还不能确定负号会怎样改变平方项对整体大小的影响。我们先把这个关系讲清楚。"
            elif answer.startswith("A") or "尽量小" in answer or "为 0" in answer:
                state_hint = "scaffolding"
                message = "你选对了：要让带负号的平方项对整体的减小作用最弱，平方项应尽量小，并在能取到时取 $0$。这说明你已经抓住了负系数与平方项的关系。"
            else:
                state_hint = "recovering"
                message = "这个选择暴露了一个具体误区：平方项本身虽然非负，但它前面有负号；平方项越大，整体反而越小。因此求最大值时应让平方项尽量小。"
            payload = {
                "state_hint": state_hint,
                **context_fields,
                "action": "RESPOND_TO_CHECKPOINT",
                "message": message,
                "breakpoint_description": "已根据最近一次选择题结果完成针对性反馈",
                "breakpoint_confidence": 0.85,
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
