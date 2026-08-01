from app.llm.reasoning import (
    normalize_reasoning_effort,
    normalize_reasoning_effort_options,
    preferred_reasoning_effort,
    reasoning_request_options,
)


def test_openai_reasoning_effort_maps_to_standard_field():
    options, capability = reasoning_request_options(
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.2",
        "low",
    )

    assert capability.control == "openai_compatible_reasoning_effort"
    assert capability.efforts == ("none", "low", "high")
    assert options == {"reasoning_effort": "low"}


def test_generic_openai_compatible_model_always_receives_protocol_field():
    options, capability = reasoning_request_options(
        "openai_compatible",
        "https://opencode.ai/zen/v1",
        "kimi-k2.7-code",
        "none",
    )

    assert capability.control == "openai_compatible_reasoning_effort"
    assert options == {"reasoning_effort": "none"}


def test_openrouter_uses_same_openai_compatible_field():
    options, capability = reasoning_request_options(
        "openai_compatible",
        "https://openrouter.ai/api/v1",
        "openai/gpt-5.2",
        "high",
    )

    assert capability.control == "openai_compatible_reasoning_effort"
    assert options == {"reasoning_effort": "high"}


def test_anthropic_messages_uses_output_config_effort_without_model_guessing():
    options, capability = reasoning_request_options(
        "anthropic",
        "https://api.anthropic.com/v1",
        "claude-sonnet-4-6",
        "low",
    )

    assert capability.control == "anthropic_output_effort"
    assert capability.efforts == ("none", "low", "high")
    assert options == {"output_config": {"effort": "low"}}


def test_unprobed_options_default_to_all_three_tiers():
    assert normalize_reasoning_effort_options(None) == ("none", "low", "high")


def test_probed_options_are_normalized_deduplicated_and_ordered():
    assert normalize_reasoning_effort_options(["high", "minimal", "high"]) == (
        "none",
        "high",
    )


def test_removed_legacy_tiers_map_to_the_nearest_retained_tier():
    assert normalize_reasoning_effort("minimal") == "none"
    assert normalize_reasoning_effort("medium") == "low"
    assert normalize_reasoning_effort("auto") == "low"


def test_selected_effort_falls_back_to_low_then_first_supported():
    assert preferred_reasoning_effort("high", ("none", "low")) == "low"
    assert preferred_reasoning_effort("high", ("none",)) == "none"


def test_local_demo_does_not_send_an_upstream_reasoning_field():
    options, capability = reasoning_request_options(
        "local_demo",
        "http://local.demo/v1",
        "demo",
        "high",
    )

    assert capability.control == "none"
    assert options == {}
