from __future__ import annotations

import pytest

from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_routing import (
    ModelOperationRoute,
    ModelOperationRoutePlan,
    ModelOperationRoutingError,
    default_operation_routes,
    resolve_agent_operation,
)


def _config():
    return parse_user_config({
        "model_providers": {
            "zhizengzeng": {
                "base_url": "https://api.zhizengzeng.com/v1",
                "google_base_url": "https://api.zhizengzeng.com/google",
                "requires_api_key": False,
                "models": {
                    "deepseek-v4-flash": {
                        "input_modalities": ["text"], "output_modalities": ["text"],
                        "capabilities": ["chat", "tool_calling", "reasoning"],
                    },
                    "gemini-3.6-flash": {
                        "input_modalities": ["text", "image"], "output_modalities": ["text"],
                        "capabilities": ["chat", "tool_calling"],
                    },
                    "gemini-3.1-flash-lite-image": {
                        "input_modalities": ["text", "image"], "output_modalities": ["text", "image"],
                        "api_protocol": "gemini", "capabilities": ["chat", "image_generation", "image_edit"],
                    },
                    "tts-1": {
                        "input_modalities": ["text"], "output_modalities": ["audio"],
                        "capabilities": ["text_to_speech"],
                    },
                    "whisper-1": {
                        "input_modalities": ["audio"], "output_modalities": ["text"],
                        "capabilities": ["speech_to_text"],
                    },
                },
            },
        },
    })


def _policy() -> AgentModelPolicy:
    explicit = lambda model: AgentModelSelection("explicit", ModelRef("zhizengzeng", model))
    return AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=explicit("deepseek-v4-flash"),
        image_understanding_model=explicit("gemini-3.6-flash"),
        image_generation_model=explicit("gemini-3.1-flash-lite-image"),
        text_to_speech_model=explicit("tts-1"),
        speech_to_text_model=explicit("whisper-1"),
    )


@pytest.mark.parametrize(("operation", "protocols"), [
    ("chat", ["openai_responses", "openai_chat_completions"]),
    ("tool_calling", ["openai_responses", "openai_chat_completions"]),
    ("reasoning", ["openai_responses", "openai_chat_completions"]),
    ("image_generation", ["gemini_generate_content"]),
    ("text_to_speech", ["openai_audio_speech"]),
    ("speech_to_text", ["openai_audio_transcriptions"]),
])
def test_default_operation_routes_are_operation_scoped(operation, protocols) -> None:
    plan = default_operation_routes(ModelRef("zhizengzeng", "model"), operation)
    assert [route.protocol for route in plan.routes] == protocols
    assert all(route.support == "unknown" for route in plan.routes)


def test_route_plan_rejects_duplicate_protocols_and_unordered_priorities() -> None:
    ref = ModelRef("provider", "model")
    with pytest.raises(ValueError, match="protocols must be unique"):
        ModelOperationRoutePlan(ref, "chat", (
            ModelOperationRoute("openai_responses", 10),
            ModelOperationRoute("openai_responses", 20),
        ))
    with pytest.raises(ValueError, match="priorities must be unique and ordered"):
        ModelOperationRoutePlan(ref, "chat", (
            ModelOperationRoute("openai_responses", 20),
            ModelOperationRoute("openai_chat_completions", 10),
        ))


def test_resolve_agent_operation_uses_exact_role_model_without_global_default() -> None:
    resolved = resolve_agent_operation(
        _config(), _policy(), role="image_generation_model", operation="image_generation",
        require_credentials=False,
    )
    assert resolved.ref == ModelRef("zhizengzeng", "gemini-3.1-flash-lite-image")
    assert resolved.model.provider.wire_api == "gemini"
    assert resolved.route_plan.routes[0].protocol == "gemini_generate_content"
    assert "api_key" not in resolved.public_dict()


def test_image_understanding_includes_gemini_native_candidate() -> None:
    resolved = resolve_agent_operation(
        _config(), _policy(), role="image_understanding_model", operation="chat",
        require_credentials=False,
    )
    assert [route.protocol for route in resolved.route_plan.routes] == [
        "openai_responses", "openai_chat_completions", "gemini_generate_content",
    ]


def test_image_understanding_tool_calling_uses_gemini_native_route() -> None:
    resolved = resolve_agent_operation(
        _config(), _policy(), role="image_understanding_model", operation="tool_calling",
        require_credentials=False,
    )
    assert [route.protocol for route in resolved.route_plan.routes] == ["gemini_generate_content"]


def test_openai_image_understanding_uses_responses_for_chat_and_tools() -> None:
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {"gpt-5.6-luna": {
            "input_modalities": ["text", "image"], "output_modalities": ["text"],
            "capabilities": ["chat", "tool_calling"], "api_protocol": "openai",
        }},
    }}})
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        image_understanding_model=AgentModelSelection(
            "explicit", ModelRef("zhizengzeng", "gpt-5.6-luna"),
        ),
    )
    for operation in ("chat", "tool_calling"):
        resolved = resolve_agent_operation(
            config, policy, role="image_understanding_model", operation=operation,
            require_credentials=False,
        )
        assert [route.protocol for route in resolved.route_plan.routes] == [
            "openai_responses", "openai_chat_completions",
        ]


def test_inherited_primary_and_role_operation_mismatch_fail_closed() -> None:
    with pytest.raises(ModelOperationRoutingError) as unbound:
        resolve_agent_operation(
            _config(), AgentModelPolicy(agent_id="my-drsai"),
            role="primary_model", operation="chat", require_credentials=False,
        )
    assert unbound.value.code == "agent_model_unbound"

    with pytest.raises(ModelOperationRoutingError) as mismatch:
        resolve_agent_operation(
            _config(), _policy(), role="text_to_speech_model", operation="chat",
            require_credentials=False,
        )
    assert mismatch.value.code == "model_role_operation_mismatch"


def test_undeclared_operation_fails_before_upstream_request() -> None:
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "requires_api_key": False,
        "models": {"plain": {"capabilities": ["chat"]}},
    }}})
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        primary_model=AgentModelSelection("explicit", ModelRef("zhizengzeng", "plain")),
    )
    with pytest.raises(ModelOperationRoutingError) as unsupported:
        resolve_agent_operation(
            config, policy, role="primary_model", operation="tool_calling", require_credentials=False,
        )
    assert unsupported.value.code == "operation_unsupported"


def test_capability_probe_can_explore_undeclared_operation_without_weakening_runtime() -> None:
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example", "requires_api_key": False,
        "models": {"gemini-3.6-flash": {
            "input_modalities": ["text", "image"], "output_modalities": ["text"],
            "capabilities": ["chat"],
        }},
    }}})
    explored = resolve_agent_operation(
        config, _policy(), role="image_understanding_model", operation="tool_calling",
        require_credentials=False, allow_undeclared_operation=True,
    )
    assert explored.ref.model_id == "gemini-3.6-flash"
    assert [route.protocol for route in explored.route_plan.routes] == ["gemini_generate_content"]
