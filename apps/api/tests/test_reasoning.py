from app.llm.reasoning import (
    reasoning_capability,
    reasoning_prompt_instruction,
    reasoning_request_options,
)


def test_openai_reasoning_effort_maps_to_standard_field():
    options, capability = reasoning_request_options(
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.2",
        "low",
    )

    assert capability.control == "openai_effort"
    assert options == {"reasoning_effort": "low"}


def test_openai_minimal_effort_maps_to_standard_field():
    options, _ = reasoning_request_options(
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.2",
        "minimal",
    )

    assert options == {"reasoning_effort": "minimal"}


def test_openrouter_uses_nested_reasoning_effort():
    options, capability = reasoning_request_options(
        "openai_compatible",
        "https://openrouter.ai/api/v1",
        "openai/gpt-5.2",
        "medium",
    )

    assert capability.control == "openrouter_effort"
    assert options == {"reasoning": {"effort": "medium"}}


def test_generic_kimi_uses_prompt_effort_without_unverified_request_field():
    options, capability = reasoning_request_options(
        "openai_compatible",
        "https://opencode.ai/zen/v1",
        "kimi-k2.7-code",
        "low",
    )

    assert capability.control == "prompt_effort"
    assert capability.efforts == ("minimal", "low", "medium", "high")
    assert options == {}
    instruction = reasoning_prompt_instruction(
        "openai_compatible",
        "https://opencode.ai/zen/v1",
        "kimi-k2.7-code",
        "low",
    )
    assert instruction is not None
    assert "尽量减少内部 reasoning" in instruction
    assert "尽快从第一个字段 message 开始输出" in instruction


def test_dashscope_qwen_toggle_maps_low_to_disabled():
    options, capability = reasoning_request_options(
        "openai_compatible",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen3.5-plus",
        "low",
    )

    assert capability.control == "thinking_toggle"
    assert options == {"enable_thinking": False}

    medium_options, _ = reasoning_request_options(
        "openai_compatible",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen3.5-plus",
        "medium",
    )
    assert medium_options == {}


def test_anthropic_adaptive_effort_uses_native_payload():
    options, capability = reasoning_request_options(
        "anthropic",
        "https://api.anthropic.com/v1",
        "claude-sonnet-4-6",
        "high",
    )

    assert capability.control == "anthropic_adaptive"
    assert options == {
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }


def test_unknown_compatible_model_exposes_prompt_effort_tiers():
    capability = reasoning_capability(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
    )
    options, _ = reasoning_request_options(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "low",
    )

    assert capability.control == "prompt_effort"
    assert capability.efforts == ("minimal", "low", "medium", "high")
    assert options == {}

    minimal = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "minimal",
    )
    medium = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "medium",
    )
    high = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "high",
    )
    assert minimal is not None and "能不推理就不要推理" in minimal
    assert medium is None
    assert high is not None and "充分、仔细地检查" in high


def test_legacy_auto_normalizes_to_medium_without_prompt_guidance():
    options, _ = reasoning_request_options(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "auto",
    )
    instruction = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-chat-model",
        "auto",
    )

    assert options == {}
    assert instruction is None


def test_prompt_effort_uses_vision_specific_json_guidance():
    minimal = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-vision-model",
        "minimal",
        task="vision_json",
    )
    high = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-vision-model",
        "high",
        task="vision_json",
    )

    assert minimal is not None and "立即检查图片" in minimal
    assert high is not None and "手写过程、答案与批改痕迹" in high
    assert "TutorTurn" not in minimal
    assert "message" not in minimal
    assert "TutorTurn" not in high
    assert "message" not in high


def test_prompt_effort_uses_short_vision_probe_guidance():
    low = reasoning_prompt_instruction(
        "openai_compatible",
        "https://example.com/v1",
        "vendor-vision-model",
        "low",
        task="vision_probe",
    )

    assert low is not None
    assert "快速识别图片" in low
    assert "简短最终答案" in low
    assert "JSON" not in low
