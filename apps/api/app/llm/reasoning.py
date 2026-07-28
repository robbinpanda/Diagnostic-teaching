from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

ReasoningEffort = Literal["minimal", "low", "medium", "high"]
ReasoningPromptTask = Literal["tutor_turn", "vision_json", "vision_probe"]
REASONING_EFFORTS: tuple[ReasoningEffort, ...] = ("minimal", "low", "medium", "high")


@dataclass(frozen=True)
class ReasoningCapability:
    control: str
    efforts: tuple[ReasoningEffort, ...]
    description: str


def reasoning_capability(
    provider: str,
    base_url: str,
    model: str,
) -> ReasoningCapability:
    """Return the conservative reasoning controls exposed for one model profile.

    The UI uses one portable effort selector, while this function keeps provider
    request fields explicit. Unknown models use prompt guidance instead of
    receiving an unverified provider request field.
    """

    provider_name = provider.lower()
    model_id = model.lower()
    host = (urlparse(base_url).hostname or "").lower()
    all_efforts = REASONING_EFFORTS

    if provider_name == "local_demo":
        return ReasoningCapability("none", ("medium",), "本地演示模型不使用推理预算。")

    if provider_name == "anthropic":
        if _supports_anthropic_adaptive_effort(model_id):
            return ReasoningCapability(
                "anthropic_adaptive",
                all_efforts,
                "使用 Anthropic adaptive thinking 与 output_config.effort。",
            )
        return ReasoningCapability(
            "prompt_effort",
            all_efforts,
            "该 Anthropic 模型未确认支持协议级 effort，改用提示词控制推理强度。",
        )

    if provider_name == "openai":
        if _looks_like_openai_reasoning_model(model_id):
            return ReasoningCapability(
                "openai_effort",
                all_efforts,
                "使用 OpenAI reasoning_effort。",
            )
        return ReasoningCapability(
            "prompt_effort",
            all_efforts,
            "该 OpenAI 模型不是已识别的协议级推理模型，改用提示词控制推理强度。",
        )

    if provider_name != "openai_compatible":
        return ReasoningCapability(
            "prompt_effort",
            all_efforts,
            "该协议没有明确的推理参数映射，改用提示词控制推理强度。",
        )

    if "openrouter.ai" in host:
        return ReasoningCapability(
            "openrouter_effort",
            all_efforts,
            "使用 OpenRouter reasoning.effort。",
        )

    if _looks_like_dashscope(host):
        if _supports_dashscope_reasoning_effort(model_id):
            return ReasoningCapability(
                "openai_effort",
                all_efforts,
                "使用 DashScope OpenAI-compatible reasoning_effort。",
            )
        if _looks_like_toggle_reasoning_model(model_id):
            return ReasoningCapability(
                "thinking_toggle",
                all_efforts,
                "快速档关闭深度思考，深入档开启深度思考。",
            )

    if _looks_like_openai_reasoning_model(model_id):
        return ReasoningCapability(
            "openai_effort",
            all_efforts,
            "使用 OpenAI-compatible reasoning_effort。",
        )

    return ReasoningCapability(
        "prompt_effort",
        all_efforts,
        "未确认该 OpenAI-compatible 模型的推理参数，改用提示词控制推理强度。",
    )


def reasoning_request_options(
    provider: str,
    base_url: str,
    model: str,
    effort: str,
) -> tuple[dict[str, Any], ReasoningCapability]:
    capability = reasoning_capability(provider, base_url, model)
    normalized = normalize_reasoning_effort(effort)
    if normalized not in capability.efforts:
        return {}, capability

    if capability.control == "openai_effort":
        return {"reasoning_effort": normalized}, capability
    if capability.control == "openrouter_effort":
        return {"reasoning": {"effort": normalized}}, capability
    if capability.control == "anthropic_adaptive":
        return {
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "low" if normalized == "minimal" else normalized},
        }, capability
    if capability.control == "thinking_toggle":
        if normalized == "medium":
            return {}, capability
        return {"enable_thinking": normalized == "high"}, capability
    return {}, capability


def normalize_reasoning_effort(effort: str) -> ReasoningEffort:
    """Map the removed legacy `auto` value to the new default `medium` tier."""

    if effort == "auto":
        return "medium"
    return effort if effort in REASONING_EFFORTS else "medium"


def reasoning_prompt_instruction(
    provider: str,
    base_url: str,
    model: str,
    effort: str,
    *,
    task: ReasoningPromptTask = "tutor_turn",
) -> str | None:
    """Return safe prompt-level effort guidance when no request mapping exists."""

    capability = reasoning_capability(provider, base_url, model)
    if capability.control != "prompt_effort":
        return None
    normalized = normalize_reasoning_effort(effort)
    if normalized == "medium":
        return None

    if task == "vision_json":
        if normalized == "minimal":
            return (
                "推理强度要求（超低）：能不推理就不要推理，立即检查图片并输出当前图片任务合同要求的最终 JSON。"
                "只做完成图片识别和满足 JSON 合同所必需的最少判断，不要输出原始思考过程。"
            )
        if normalized == "low":
            return (
                "推理强度要求（低）：尽量减少内部 reasoning、反复检查和额外推断，"
                "优先快速识别图片中的可见内容并输出合法的最终 JSON；不要输出原始思考过程。"
            )
        return (
            "推理强度要求（高）：输出前仔细检查图片中的题目区域、印刷文字、手写过程、答案与批改痕迹，"
            "核对识别结果和当前 JSON 合同后再输出；不要展示原始思考过程，只输出最终 JSON。"
        )

    if task == "vision_probe":
        if normalized == "minimal":
            return (
                "推理强度要求（超低）：能不推理就不要推理，直接识别图片并按用户要求给出最短最终答案；"
                "不要解释或输出思考过程。"
            )
        if normalized == "low":
            return (
                "推理强度要求（低）：尽量减少内部 reasoning 和反复检查，"
                "快速识别图片并按用户要求给出简短最终答案；不要输出思考过程。"
            )
        return (
            "推理强度要求（高）：仔细核对图片中各对象的颜色、形状与顺序后再给出最终答案；"
            "仍须遵守用户要求的简短格式，不要输出思考过程。"
        )

    if normalized == "minimal":
        return (
            "推理强度要求（超低）：能不推理就不要推理，不要展开分析过程。"
            "立即生成最终 TutorTurn JSON，直接从第一个字段 message 开始输出；"
            "只做满足合同所必需的最少判断，不要输出原始思考过程。"
        )
    if normalized == "low":
        return (
            "推理强度要求（低）：尽量减少内部 reasoning 和反复检查，优先快速生成最终结果。"
            "尽快从第一个字段 message 开始输出合法 TutorTurn JSON，不要输出原始思考过程。"
        )
    return (
        "推理强度要求（高）：在输出前充分、仔细地检查题目、学生证据、教学 action 与 JSON 合同，"
        "想清楚后再回答；仍不得展示原始思考过程，只输出最终 TutorTurn JSON，并保持 message 为第一个字段。"
    )


def _looks_like_openai_reasoning_model(model_id: str) -> bool:
    return bool(
        re.search(r"(?:^|[/_-])gpt-5(?:[._/-]|$)", model_id)
        or re.search(r"(?:^|[/_-])o[1-9](?:[._/-]|$)", model_id)
        or "codex" in model_id
    )


def _supports_anthropic_adaptive_effort(model_id: str) -> bool:
    compact = model_id.replace("_", "-")
    if any(marker in compact for marker in ("opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6")):
        return True
    match = re.search(r"(?:opus|sonnet)-(\d+)[.-](\d+)", compact)
    if match:
        major, minor = int(match.group(1)), int(match.group(2))
        return major > 4 or (major == 4 and minor >= 6)
    inverse = re.search(r"claude-(\d+)[.-](\d+)-(?:opus|sonnet)", compact)
    if inverse:
        major, minor = int(inverse.group(1)), int(inverse.group(2))
        return major > 4 or (major == 4 and minor >= 6)
    return False


def _looks_like_dashscope(host: str) -> bool:
    return "dashscope" in host or "aliyuncs.com" in host or "alibabacloud.com" in host


def _supports_dashscope_reasoning_effort(model_id: str) -> bool:
    return any(
        marker in model_id
        for marker in ("qwen3.8", "deepseek-v4", "glm-5", "glm5")
    )


def _looks_like_toggle_reasoning_model(model_id: str) -> bool:
    return any(
        marker in model_id
        for marker in ("kimi", "qwen", "qwq", "deepseek", "glm", "minimax")
    ) and "thinking" not in model_id and "reasoner" not in model_id and "-r1" not in model_id
