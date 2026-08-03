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
from app.llm.reasoning import (
    reasoning_request_options,
)

__all__ = [
    "IMAGE_ANALYSIS_PROMPT",
    "IMAGE_PROBLEM_DETECTION_PROMPT",
    "LlmProfile",
    "LlmEmptyResponseError",
    "LlmProviderError",
    "TEXT_PROBLEM_SPLIT_PROMPT",
    "_anthropic_response_events",
    "analyze_problem_text",
    "analyze_problem_image",
    "anthropic_messages_url",
    "anthropic_request_payload",
    "chat_completion",
    "chat_completions_url",
    "chat_stream_completion",
    "detect_problem_regions",
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
    reasoning_effort: str = "low"


class LlmProviderError(RuntimeError):
    pass


class LlmEmptyResponseError(LlmProviderError):
    """Provider completed a request without emitting any visible model content."""

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


IMAGE_PROBLEM_DETECTION_PROMPT = """你是数学试题与学生作答区域检测助手。请找出图片中每一道独立题目，以及明确或可能属于该题的完整学生作答和批改区域；只返回 JSON，不要 Markdown，也不要解题或转录答案。

严格返回：
{
  "problems": [
    {
      "label": "题目 1",
      "bbox": {"x": 0.05, "y": 0.10, "width": 0.90, "height": 0.20}
    }
  ]
}

要求：
- bbox 使用整张原图的归一化坐标，x/y/width/height 都在 0 到 1 之间。
- 一道独立编号题只给一个框；同一大题的共享题干、多个小问、配图和表格必须与该题的作答区域放在同一个框内，不要把小问或解题过程拆成不同题目。
- 不同题号、不同题干或明显独立作答目标应分别框选。按从上到下、从左到右排序，最多返回 20 道题。
- 学生过程是框选内容的必要组成部分，不是可选内容。只要图片里能看到属于该题的手写或打印作答，包括草稿、每一步计算、推导、改写、划掉后重写、最终答案，都必须完整放进该题 bbox；红笔或其他颜色的勾、叉、圈、划线、得分和文字批注也必须包含。
- 学生过程可能写在题干下方、右侧、空白处或跨越预留答题区域。不要只紧贴印刷题干，也不要因为过程离题干稍远就截掉；应结合题号、答题空白、连贯书写顺序和空间邻近关系判断归属。
- 每个框要完整覆盖题号、题干、选项、必要图表、全部学生过程与批改痕迹，并在内容外侧保留少量安全边距。无法确定某一行过程是否属于该题时，优先适度扩大该题框保留它，而不是裁掉可能有用的学生过程；允许为此与相邻框轻微重叠，但不要完整吞入另一道独立题目。
- 禁止在该题存在可见作答时仅框题干。返回前逐框检查：题目是否完整、学生过程是否从第一步到最后一步完整、批改痕迹是否完整；任一项被截断都必须扩大 bbox。
- 图片中只有一道题也必须返回一个框。无法识别任何数学题时返回 {"problems": []}。
"""


TEXT_PROBLEM_SPLIT_PROMPT = """你是数学题目拆分助手，不是解题助手。判断用户文字包含一道还是多道彼此独立的数学题，并只返回严格 JSON，不要 Markdown。

严格返回：
{
  "problems": [
    {
      "problem_text": "可独立交给答疑老师的完整题目",
      "student_initial_thought": "用户明确表达且只属于这道题的思路、作答或卡点；没有则为空字符串"
    }
  ]
}

要求：
- 单题也必须返回长度为 1 的 problems；最多 20 道题。
- 以独立题号、独立题干和独立作答目标判断多题。同一大题的共享题干与多个小问保留为一道题，不要拆散必要上下文。
- 每个 problem_text 必须自包含；共享条件应复制到需要它的题目中，但不得补写用户没有提供的信息。
- 只拆分和整理，不得求解、纠错、推断答案或编造学生思路。
- 保留原始数学含义。数学表达尽量整理为可直接交给 KaTeX 的 $...$ 或 $$...$$ 格式，JSON 反斜杠正确转义。
- 寒暄、上传说明等非题目内容不要写入 problem_text；用户明确说“没思路”属于有效 student_initial_thought。
- 无法找到数学题时返回 {"problems": []}。
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
        temperature=profile.temperature,
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
        temperature=profile.temperature,
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

    messages = [
        {"role": "system", "content": IMAGE_ANALYSIS_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析这张数学题图片，按指定 JSON 返回。"},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        },
    ]
    return await chat_completion(
        profile,
        messages,
        max_tokens=min(max(profile.max_output_tokens, 4000), 16000),
        temperature=profile.temperature,
    )


async def detect_problem_regions(profile: LlmProfile, image_data_url: str) -> str:
    if profile.provider == "local_demo":
        return json.dumps(
            {
                "problems": [
                    {
                        "label": "题目 1",
                        "bbox": {"x": 0.03, "y": 0.03, "width": 0.94, "height": 0.94},
                    }
                ]
            },
            ensure_ascii=False,
        )

    messages = [
        {"role": "system", "content": IMAGE_PROBLEM_DETECTION_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "请检测全部独立数学题，并让每个框完整包含该题的学生过程、答案和批改痕迹。",
                },
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        },
    ]
    return await chat_completion(
        profile,
        messages,
        max_tokens=min(max(profile.max_output_tokens, 2000), 8000),
        temperature=profile.temperature,
    )


def _local_demo_text_problems(text: str) -> list[str]:
    starts = list(
        re.finditer(r"(?m)^\s*(?=(?:第\s*\d+\s*题|\d+\s*[.、．]))", text)
    )
    if len(starts) < 2:
        return [text.strip()]
    problems: list[str] = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        problem = text[match.start() : end].strip()
        if problem:
            problems.append(problem)
    return problems or [text.strip()]


async def analyze_problem_text(profile: LlmProfile, text: str) -> str:
    if profile.provider == "local_demo":
        return json.dumps(
            {
                "problems": [
                    {"problem_text": problem, "student_initial_thought": ""}
                    for problem in _local_demo_text_problems(text)
                ]
            },
            ensure_ascii=False,
        )

    return await chat_completion(
        profile,
        [
            {"role": "system", "content": TEXT_PROBLEM_SPLIT_PROMPT},
            {"role": "user", "content": text},
        ],
        max_tokens=min(max(profile.max_output_tokens, 3000), 12000),
        temperature=profile.temperature,
    )


def _assert_nonempty(
    content: str, finish_reason: str | None, max_tokens: int | None = None
) -> None:
    if not content:
        if finish_reason == "length":
            token_hint = f"={max_tokens}" if max_tokens is not None else ""
            raise LlmEmptyResponseError(
                f"模型因 max_tokens{token_hint} 截断未输出任何可见内容，请调大 max_output_tokens 或精简历史"
            )
        raise LlmEmptyResponseError("模型返回了空内容，请重试或换一道题")


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
    reasoning_options, _ = reasoning_request_options(
        profile.provider,
        profile.base_url,
        profile.model,
        profile.reasoning_effort,
    )
    payload.update(reasoning_options)
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
                yield {"event": "response_headers", "delta": "", "finish_reason": None}
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
                    delta_payload = choice.get("delta")
                    delta_payload = delta_payload if isinstance(delta_payload, dict) else {}
                    reasoning = (
                        delta_payload.get("reasoning_content")
                        or delta_payload.get("reasoning")
                        or delta_payload.get("thinking")
                    )
                    reasoning_details = delta_payload.get("reasoning_details")
                    if reasoning or (
                        isinstance(reasoning_details, list) and reasoning_details
                    ):
                        # Never forward raw chain-of-thought. The controller only
                        # needs to know that the provider entered a reasoning phase.
                        yield {
                            "event": "reasoning_delta",
                            "delta": "",
                            "finish_reason": None,
                        }
                    delta = delta_payload.get("content") or ""
                    if delta:
                        saw_content = True
                        yield {
                            "event": "content_delta",
                            "delta": delta,
                            "finish_reason": None,
                        }
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
                yield {"event": "response_headers", "delta": "", "finish_reason": None}
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
    reasoning_options, _ = reasoning_request_options(
        profile.provider,
        profile.base_url,
        profile.model,
        profile.reasoning_effort,
    )
    payload.update(reasoning_options)
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
        if event_type == "content_block_delta":
            delta = event.get("delta")
            if isinstance(delta, dict) and delta.get("type") in {
                "thinking_delta",
                "input_json_delta",
            }:
                yield {
                    "event": "reasoning_delta",
                    "delta": "",
                    "finish_reason": None,
                }
                continue
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
            yield {
                "event": "content_delta",
                "delta": text,
                "finish_reason": None,
            }

    if not saw_any_data:
        raise LlmProviderError("Anthropic 流式响应中没有任何 data 事件，请确认 base_url/模型配置")
    if not saw_content:
        _assert_nonempty(
            "", "length" if finish_reason == "max_tokens" else finish_reason, requested_max_tokens
        )
    yield {"delta": "", "finish_reason": finish_reason}
