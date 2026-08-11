"""Operation-scoped model routing for Agent-bound model roles.

Provider ``wire_api`` remains a compatibility default.  Runtime operations use
this module so one Provider/model can expose Responses, Chat, Gemini and Audio
routes without pretending that those protocols are interchangeable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping

from .model_catalog import AgentModelPolicy, AgentModelSelection, ModelOperation, ModelRef
from .resolver import resolve_model_ref
from .schema import DrSaiConfig, ResolvedModelConfig


OperationProtocol = Literal[
    "openai_responses",
    "openai_chat_completions",
    "gemini_generate_content",
    "openai_images_generation",
    "openai_images_edits",
    "openai_audio_speech",
    "openai_audio_transcriptions",
]
AgentModelRole = Literal[
    "primary_model",
    "image_understanding_model",
    "image_generation_model",
    "text_to_speech_model",
    "speech_to_text_model",
]
RouteSupport = Literal["declared", "verified", "unsupported", "unknown"]


class ModelOperationRoutingError(ValueError):
    """Stable, user-actionable failure raised before an upstream request."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ModelOperationRoute:
    protocol: OperationProtocol
    priority: int
    support: RouteSupport = "unknown"
    source: str = "builtin"

    def __post_init__(self) -> None:
        if self.priority <= 0:
            raise ValueError("route priority must be positive")
        if not self.source or len(self.source) > 80:
            raise ValueError("route source is invalid")

    def public_dict(self) -> dict[str, object]:
        return {
            "protocol": self.protocol,
            "priority": self.priority,
            "support": self.support,
            "source": self.source,
        }


@dataclass(frozen=True)
class ModelOperationRoutePlan:
    ref: ModelRef
    operation: ModelOperation
    routes: tuple[ModelOperationRoute, ...]

    def __post_init__(self) -> None:
        if not self.routes:
            raise ValueError("route plan must contain at least one route")
        protocols = [route.protocol for route in self.routes]
        priorities = [route.priority for route in self.routes]
        if len(protocols) != len(set(protocols)):
            raise ValueError("route plan protocols must be unique")
        if len(priorities) != len(set(priorities)) or priorities != sorted(priorities):
            raise ValueError("route priorities must be unique and ordered")

    def public_dict(self) -> dict[str, object]:
        return {
            "ref": self.ref.public_dict(include_revision=False),
            "operation": self.operation,
            "routes": [route.public_dict() for route in self.routes],
        }


@dataclass(frozen=True)
class ResolvedAgentOperation:
    role: AgentModelRole
    ref: ModelRef
    model: ResolvedModelConfig
    route_plan: ModelOperationRoutePlan

    def public_dict(self) -> dict[str, object]:
        return {
            "role": self.role,
            "ref": self.ref.public_dict(include_revision=False),
            "upstream_model_id": self.model.model,
            "provider_id": self.model.provider.name,
            "has_api_key": self.model.provider.has_api_key,
            "route_plan": self.route_plan.public_dict(),
        }


_ROLE_OPERATION: Mapping[AgentModelRole, frozenset[ModelOperation]] = {
    "primary_model": frozenset({"chat", "tool_calling", "reasoning"}),
    "image_understanding_model": frozenset({"chat", "tool_calling"}),
    "image_generation_model": frozenset({"image_generation", "image_edit"}),
    "text_to_speech_model": frozenset({"text_to_speech"}),
    "speech_to_text_model": frozenset({"speech_to_text"}),
}


def default_operation_routes(ref: ModelRef, operation: ModelOperation) -> ModelOperationRoutePlan:
    """Return probe candidates, not claims that an upstream supports them."""

    if operation in {"chat", "tool_calling", "reasoning"}:
        routes = (
            ModelOperationRoute("openai_responses", 10),
            ModelOperationRoute("openai_chat_completions", 20),
        )
    elif operation == "image_generation":
        routes = (ModelOperationRoute("openai_images_generation", 10),)
    elif operation == "image_edit":
        routes = (ModelOperationRoute("openai_images_edits", 10),)
    elif operation == "text_to_speech":
        routes = (ModelOperationRoute("openai_audio_speech", 10),)
    elif operation == "speech_to_text":
        routes = (ModelOperationRoute("openai_audio_transcriptions", 10),)
    else:  # pragma: no cover - ModelOperation is closed, defensive for runtime input.
        raise ModelOperationRoutingError("operation_unsupported", f"Unsupported model operation: {operation}")
    return ModelOperationRoutePlan(ref=ref, operation=operation, routes=routes)


def resolve_agent_operation(
    config: DrSaiConfig,
    policy: AgentModelPolicy,
    *,
    role: AgentModelRole,
    operation: ModelOperation,
    require_credentials: bool = True,
    allow_undeclared_operation: bool = False,
) -> ResolvedAgentOperation:
    """Resolve one exact Agent-bound model; never fall back to a global model."""

    allowed = _ROLE_OPERATION[role]
    if operation not in allowed:
        raise ModelOperationRoutingError(
            "model_role_operation_mismatch",
            f"Agent model role '{role}' cannot execute '{operation}'.",
        )
    selection = _selection_for_role(policy, role)
    if selection is None or selection.mode != "explicit" or selection.ref is None:
        raise ModelOperationRoutingError(
            "agent_model_unbound",
            f"Agent model role '{role}' must use an explicit model reference.",
        )
    configured_provider = config.providers.get(selection.ref.provider_id)
    configured_model = (
        configured_provider.model_configs.get(selection.ref.model_id)
        if configured_provider is not None else None
    )
    if configured_model is None:
        raise ModelOperationRoutingError(
            "configuration_invalid",
            f"Agent model '{selection.ref.provider_id}/{selection.ref.model_id}' has no structured model definition.",
        )
    declared = set(configured_model.capabilities)
    if operation not in declared and not allow_undeclared_operation:
        raise ModelOperationRoutingError(
            "operation_unsupported",
            f"Agent model '{selection.ref.model_id}' does not declare '{operation}'.",
        )
    try:
        resolved = resolve_model_ref(
            config,
            provider_id=selection.ref.provider_id,
            model_id=selection.ref.model_id,
            require_credentials=require_credentials,
        )
    except ValueError as exc:
        raise ModelOperationRoutingError("configuration_invalid", str(exc)) from exc
    route_plan = default_operation_routes(selection.ref, operation)
    is_gemini_family = selection.ref.model_id.casefold().startswith("gemini-")
    if role == "image_understanding_model" and operation == "chat" and is_gemini_family:
        route_plan = ModelOperationRoutePlan(selection.ref, operation, (
            *route_plan.routes,
            ModelOperationRoute("gemini_generate_content", 30),
        ))
    elif role == "image_understanding_model" and operation == "tool_calling" and is_gemini_family:
        route_plan = ModelOperationRoutePlan(selection.ref, operation, (
            ModelOperationRoute("gemini_generate_content", 10),
        ))
    elif role == "image_generation_model" and resolved.provider.wire_api == "gemini":
        route_plan = ModelOperationRoutePlan(selection.ref, operation, (
            ModelOperationRoute("gemini_generate_content", 10),
        ))
    return ResolvedAgentOperation(
        role=role,
        ref=selection.ref,
        model=resolved,
        route_plan=route_plan,
    )


def _selection_for_role(
    policy: AgentModelPolicy, role: AgentModelRole,
) -> AgentModelSelection | None:
    if role == "primary_model":
        return policy.primary_model
    if role == "image_understanding_model":
        return policy.image_understanding_model
    if role == "image_generation_model":
        return policy.image_generation_model or policy.image_model
    if role == "text_to_speech_model":
        return policy.text_to_speech_model
    return policy.speech_to_text_model
