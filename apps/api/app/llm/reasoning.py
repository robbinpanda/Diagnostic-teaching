from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ReasoningEffort = Literal["none", "low", "high"]
REASONING_EFFORTS: tuple[ReasoningEffort, ...] = ("none", "low", "high")
DEFAULT_REASONING_EFFORT: ReasoningEffort = "low"


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
    """Describe the protocol-level reasoning field used by one profile.

    Capability is intentionally protocol-based. Whether a concrete provider
    endpoint accepts each effort value is discovered by probing the complete
    profile (protocol + base URL + model), then stored with that profile.
    """

    del base_url, model
    provider_name = provider.lower()
    if provider_name == "openai":
        return ReasoningCapability(
            "openai_responses_reasoning",
            REASONING_EFFORTS,
            "按 OpenAI Responses 协议发送 reasoning.effort；具体可用档位以该配置的实测结果为准。",
        )
    if provider_name == "openai_compatible":
        return ReasoningCapability(
            "openai_compatible_reasoning_effort",
            REASONING_EFFORTS,
            "按 OpenAI-compatible 协议发送 reasoning_effort；具体可用档位以该配置的实测结果为准。",
        )
    if provider_name == "anthropic":
        return ReasoningCapability(
            "anthropic_output_effort",
            REASONING_EFFORTS,
            "按 Anthropic Messages 协议发送 output_config.effort；具体可用档位以该配置的实测结果为准。",
        )
    return ReasoningCapability(
        "none",
        REASONING_EFFORTS,
        "本地演示模型不向上游发送推理强度参数。",
    )


def reasoning_request_options(
    provider: str,
    base_url: str,
    model: str,
    effort: str,
) -> tuple[dict[str, Any], ReasoningCapability]:
    capability = reasoning_capability(provider, base_url, model)
    normalized = normalize_reasoning_effort(effort)
    if capability.control == "openai_responses_reasoning":
        return {"reasoning": {"effort": normalized}}, capability
    if capability.control == "openai_compatible_reasoning_effort":
        return {"reasoning_effort": normalized}, capability
    if capability.control == "anthropic_output_effort":
        return {"output_config": {"effort": normalized}}, capability
    return {}, capability


def normalize_reasoning_effort(effort: str) -> ReasoningEffort:
    """Normalize removed tiers while preserving their closest product intent."""

    if effort == "minimal":
        return "none"
    if effort in {"auto", "medium"}:
        return DEFAULT_REASONING_EFFORT
    return effort if effort in REASONING_EFFORTS else DEFAULT_REASONING_EFFORT


def normalize_reasoning_effort_options(
    efforts: list[str] | tuple[str, ...] | None,
) -> tuple[ReasoningEffort, ...]:
    """Return supported efforts in stable UI order.

    Missing capability data means the profile was not probed, so all three
    portable options remain available as requested.
    """

    if efforts is None:
        return REASONING_EFFORTS
    normalized = {normalize_reasoning_effort(effort) for effort in efforts}
    return tuple(effort for effort in REASONING_EFFORTS if effort in normalized)


def preferred_reasoning_effort(
    selected: str,
    supported: tuple[ReasoningEffort, ...],
) -> ReasoningEffort:
    normalized = normalize_reasoning_effort(selected)
    if normalized in supported:
        return normalized
    if DEFAULT_REASONING_EFFORT in supported:
        return DEFAULT_REASONING_EFFORT
    if supported:
        return supported[0]
    return DEFAULT_REASONING_EFFORT
