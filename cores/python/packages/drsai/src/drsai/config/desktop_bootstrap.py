"""Idempotent first-run configuration for the packaged desktop Runtime."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile

from .agent_model_policy import commit_agent_model_policy, load_agent_model_policy
from .defaults import (
    DEFAULT_AGENT,
    DEFAULT_AGENT_CONFIG_FILE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    hepai_anthropic_base_url,
    hepai_openai_base_url,
)
from .loader import ConfigError, default_config_path, load_user_config
from .model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from .writer import update_current_agent, update_model_selection, upsert_provider


# ── Specialised product models (not in DEFAULT_LLM_MODE_CONFIG) ─────────────
# These models serve non-chat roles (image generation, TTS, STT, and the
# image-understanding model gpt-5.6-luna).  They are merged into the product
# catalog alongside the chat models that are dynamically discovered from
# ``run_drsai_agent_factory.DEFAULT_LLM_MODE_CONFIG``.
_SPECIALIZED_PRODUCT_MODELS: dict[str, dict[str, object]] = {
    "gpt-5.6-luna": {
        "input_modalities": ["text", "image"], "output_modalities": ["text"],
        "api_protocol": "openai", "enabled": True,
        "capabilities": ["chat", "tool_calling"],
    },
    "gemini-3.1-flash-lite-image": {
        "alias": "Nano Banana 2 Lite",
        "input_modalities": ["text", "image"], "output_modalities": ["text", "image"],
        "api_protocol": "openai", "enabled": True,
        "capabilities": ["chat", "image_generation", "image_edit"],
    },
    "tts-1": {
        "input_modalities": ["text"], "output_modalities": ["audio"],
        "api_protocol": "openai", "enabled": True,
        "capabilities": ["text_to_speech"],
    },
    "whisper-1": {
        "input_modalities": ["audio"], "output_modalities": ["text"],
        "api_protocol": "openai", "enabled": True,
        "capabilities": ["speech_to_text"],
    },
}


def _build_product_models() -> dict[str, dict[str, object]]:
    """Build the HepAI product model catalog from ``DEFAULT_LLM_MODE_CONFIG``.

    Chat-capable models are dynamically discovered from the agent factory's
    LLM catalog (``run_drsai_agent_factory.DEFAULT_LLM_MODE_CONFIG``) so the
    desktop model picker stays in sync with the backend's source of truth.

    Specialised models (TTS, STT, image generation, gpt-5.6-luna) are merged in
    from ``_SPECIALIZED_PRODUCT_MODELS`` because they serve non-chat roles
    and are not part of the LLM catalog.

    The import is deferred to avoid a circular import:
    ``drsai.config`` → ``drsai.backend.run_drsai_agent_factory`` → ``drsai.config``.
    By the time this function runs (called from ``ensure_desktop_runtime_config``
    during gateway lifespan), all modules are fully loaded.
    """
    product_models: dict[str, dict[str, object]] = {}

    try:
        from drsai.backend.run_drsai_agent_factory import DEFAULT_LLM_MODE_CONFIG  # noqa: WPS433

        for alias, entry in DEFAULT_LLM_MODE_CONFIG.items():
            input_modalities: list[str] = ["text"]
            if getattr(entry, "vision", False):
                input_modalities.append("image")

            capabilities = ["chat", "tool_calling"]
            reasoning = getattr(entry, "reasoning", None)
            if reasoning is not None and getattr(reasoning, "supported", False):
                capabilities.append("reasoning")

            client_type = getattr(entry, "client_type", "auto")
            api_protocol = client_type if client_type != "auto" else "openai"

            product_models[alias] = {
                "input_modalities": input_modalities,
                "output_modalities": ["text"],
                "api_protocol": api_protocol,
                "enabled": True,
                "capabilities": capabilities,
            }
    except Exception:  # pragma: no cover — fallback if factory import fails
        # Minimal fallback so the desktop still boots with a basic catalog.
        product_models = {
            "deepseek-v4-flash": {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True,
                "capabilities": ["chat", "tool_calling", "reasoning"],
            },
            "deepseek-v4-pro": {
                "input_modalities": ["text"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True,
                "capabilities": ["chat", "tool_calling", "reasoning"],
            },
        }

    # Merge specialised models (non-chat roles) — they take precedence on key
    # conflicts because they carry domain-specific capabilities.
    product_models.update(_SPECIALIZED_PRODUCT_MODELS)
    return product_models


@dataclass(frozen=True)
class DesktopBootstrapResult:
    changed: bool
    actions: tuple[str, ...]
    config_path: str


def ensure_desktop_runtime_config(
    config_path: str | Path | None = None,
) -> DesktopBootstrapResult:
    """Create or repair only the packaged desktop's safe built-in defaults.

    Existing custom Providers and Agents are preserved. The only legacy
    Provider rewritten is the old IHEP Anthropic template shipped by OpenDrSai
    itself, which incorrectly converted OIDC users into API-Key users.
    """

    target = Path(config_path) if config_path is not None else default_config_path()
    target = target.expanduser()
    original_config = target.read_bytes() if target.exists() else None
    original_agent: bytes | None = None
    agent_path: Path | None = None
    actions: list[str] = []
    openai_base_url = hepai_openai_base_url()
    anthropic_base_url = hepai_anthropic_base_url()
    try:
        config = load_user_config(target)
        provider = config.model_provider or DEFAULT_PROVIDER
        model = config.model or DEFAULT_MODEL

        # Build the product model catalog from the agent factory's
        # DEFAULT_LLM_MODE_CONFIG (chat models) plus specialised non-chat
        # models (TTS, STT, image generation).
        product_models = _build_product_models()

        if _is_packaged_legacy_hepai(config):
            provider = DEFAULT_PROVIDER
            upsert_provider(
                DEFAULT_PROVIDER,
                {
                    "base_url": openai_base_url,
                    "anthropic_base_url": anthropic_base_url,
                    "requires_api_key": False,
                },
                path=target,
            )
            update_model_selection(model=model, model_provider=provider, path=target)
            actions.append("repair_packaged_legacy_hepai_provider")
            config = load_user_config(target)
        elif not config.model and not config.model_provider and not config.providers:
            upsert_provider(
                DEFAULT_PROVIDER,
                {
                    "base_url": openai_base_url,
                    "anthropic_base_url": anthropic_base_url,
                    "requires_api_key": False,
                },
                path=target,
            )
            update_model_selection(model=DEFAULT_MODEL, model_provider=DEFAULT_PROVIDER, path=target)
            provider, model = DEFAULT_PROVIDER, DEFAULT_MODEL
            actions.append("seed_hepai_oidc_provider")
            config = load_user_config(target)

        # Every desktop user receives the product-owned HepAI catalog. Merge it
        # with local additions, while keeping the product models authoritative
        # and free of static credentials.
        existing_hepai = config.providers.get(DEFAULT_PROVIDER)
        existing_models = dict(existing_hepai.model_configs) if existing_hepai else {}
        merged_models = {
            **{model_id: _model_config_values(value) for model_id, value in existing_models.items()},
            **product_models,
        }
        needs_catalog = (
            existing_hepai is None
            or existing_hepai.requires_api_key
            or existing_hepai.base_url.rstrip("/") != openai_base_url.rstrip("/")
            or (existing_hepai.anthropic_base_url or "").rstrip("/") != anthropic_base_url.rstrip("/")
            or any(model_id not in existing_models for model_id in product_models)
            or any(
                _model_config_values(existing_models[model_id]) != definition
                for model_id, definition in product_models.items()
                if model_id in existing_models
            )
        )
        if needs_catalog:
            upsert_provider(
                DEFAULT_PROVIDER,
                {
                    "base_url": openai_base_url,
                    "anthropic_base_url": anthropic_base_url,
                    "google_base_url": openai_base_url,
                    "requires_api_key": False,
                    "models": merged_models,
                },
                path=target,
            )
            actions.append("sync_hepai_product_models")
            config = load_user_config(target)

        if config.current_agent is None:
            update_current_agent(
                agent_name=DEFAULT_AGENT,
                agent_config_file=DEFAULT_AGENT_CONFIG_FILE,
                path=target,
            )
            actions.append("bind_default_agent")
            config = load_user_config(target)

        # A missing custom Agent is a user configuration error and must never
        # be silently replaced. Only the built-in Agent is self-healed.
        if config.current_agent == DEFAULT_AGENT:
            agent_path = target.parent / DEFAULT_AGENT_CONFIG_FILE
            if not agent_path.exists():
                effective_provider = config.model_provider or provider or DEFAULT_PROVIDER
                effective_model = config.model or model or DEFAULT_MODEL
                commit_agent_model_policy(
                    _default_agent_model_policy(
                        effective_provider,
                        effective_model,
                        product_models,
                    ),
                    expected_revision=None,
                    path=agent_path,
                )
                actions.append("create_default_agent")
            # An existing Agent file is authoritative user configuration.
            # Desktop bootstrap may synchronize the Provider catalog, but must
            # never rewrite explicit per-Agent model bindings on startup.

        final = load_user_config(target)
        if final.current_agent == DEFAULT_AGENT and not (
            target.parent / DEFAULT_AGENT_CONFIG_FILE
        ).is_file():
            raise ConfigError("Default OpenDrSai Agent configuration was not created")
        return DesktopBootstrapResult(bool(actions), tuple(actions), str(target))
    except Exception:
        _restore(target, original_config)
        if agent_path is not None:
            _restore(agent_path, original_agent)
        raise


def _is_packaged_legacy_hepai(config: object) -> bool:
    provider_name = getattr(config, "model_provider", None)
    model = str(getattr(config, "model", None) or "").strip().lower()
    providers = getattr(config, "providers", {})
    legacy = providers.get("legacy-anthropic") if hasattr(providers, "get") else None
    if provider_name != "legacy-anthropic" or legacy is None:
        return False
    base_url = str(getattr(legacy, "base_url", None) or "").rstrip("/").lower()
    api_key_env = str(getattr(legacy, "api_key_env", None) or "").upper()
    is_hepai_url = base_url in {
        hepai_anthropic_base_url().rstrip("/").lower(),
        "https://aiapi.ihep.ac.cn/apiv2/anthropic",
    }
    is_non_anthropic_model = not model.startswith(("claude-", "claude/", "anthropic/"))
    return is_hepai_url and is_non_anthropic_model and api_key_env in {"", "ANTHROPIC_API_KEY"}


def _default_agent_model_policy(
    provider: str,
    primary_model: str,
    product_models: dict[str, dict[str, object]] | None = None,
) -> AgentModelPolicy:
    explicit = lambda model: AgentModelSelection("explicit", ModelRef(provider, model))
    product_models = product_models if product_models is not None else _build_product_models()
    if provider != DEFAULT_PROVIDER or primary_model not in product_models:
        return AgentModelPolicy(agent_id=DEFAULT_AGENT, primary_model=explicit(primary_model))
    return AgentModelPolicy(
        agent_id=DEFAULT_AGENT,
        primary_model=explicit(DEFAULT_MODEL),
        image_understanding_model=explicit("gpt-5.6-luna"),
        image_generation_model=explicit("gemini-3.1-flash-lite-image"),
        text_to_speech_model=explicit("tts-1"),
        speech_to_text_model=explicit("whisper-1"),
    )


def _model_config_values(value: object) -> dict[str, object]:
    return {
        **({"alias": value.alias} if getattr(value, "alias", None) else {}),
        "input_modalities": list(value.input_modalities),
        "output_modalities": list(value.output_modalities),
        "api_protocol": value.api_protocol,
        "enabled": value.enabled,
        "capabilities": list(value.capabilities),
        **({"upstream_id": value.upstream_id} if getattr(value, "upstream_id", None) else {}),
    }


def _restore(path: Path, content: bytes | None) -> None:
    if content is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".rollback", dir=path.parent,
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
