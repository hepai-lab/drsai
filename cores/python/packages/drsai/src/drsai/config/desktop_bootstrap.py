"""Idempotent first-run configuration for the packaged desktop Runtime."""

from __future__ import annotations

import os
import tempfile
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path

from .agent_model_policy import commit_agent_model_policy, load_agent_model_policy
from .defaults import (
    DEFAULT_AGENT,
    DEFAULT_AGENT_CONFIG_FILE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    PRODUCT_PROVIDER_IDS,
    hepai_anthropic_base_url,
    hepai_openai_base_url,
    provider_models_file,
    provider_user_models_file,
)
from .loader import ConfigError, default_config_path, load_user_config
from .model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from .model_defaults import (
    DEFAULT_IMAGE_GENERATION_MODEL,
    DEFAULT_LLM_MODE_CONFIG,
    DEFAULT_SPECIALIZED_PRODUCT_MODELS,
    RETIRED_PRODUCT_MODELS,
)
from .model_registry import find_model_capabilities
from .writer import (
    render_models_file,
    replace_models_file_text,
    update_current_agent,
    update_model_selection,
    upsert_provider,
)


def _build_product_models() -> dict[str, dict[str, object]]:
    """Build the HepAI product model catalog from ``model_defaults``.

    Chat-capable models come from ``DEFAULT_LLM_MODE_CONFIG``. Specialised
    role models (image generation candidates, TTS, STT, image-understanding
    overrides) come from ``DEFAULT_SPECIALIZED_PRODUCT_MODELS`` in the same
    module — one backend source of truth, no scattered Desktop-only catalogs.
    """
    product_models: dict[str, dict[str, object]] = {}

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

    if not product_models:  # pragma: no cover — defensive empty catalog
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

    # Specialised models take precedence on key conflicts (role-specific caps).
    product_models.update(DEFAULT_SPECIALIZED_PRODUCT_MODELS)
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
    if DEFAULT_PROVIDER not in PRODUCT_PROVIDER_IDS:  # pragma: no cover — configuration invariant
        # The whole file split below assumes the bootstrap's Provider owns a
        # *product* catalog: it regenerates that file as a whole and would
        # otherwise destroy a user's own catalog.
        raise ConfigError(f"{DEFAULT_PROVIDER} must stay a product-owned Provider")
    original_config = target.read_bytes() if target.exists() else None
    original_agent: bytes | None = None
    agent_path: Path | None = None
    # Catalog files this run is about to write, so a failure anywhere below
    # leaves the product file and the user overlay exactly as they were.
    catalog_snapshots: dict[Path, bytes | None] = {}
    actions: list[str] = []
    openai_base_url = hepai_openai_base_url()
    anthropic_base_url = hepai_anthropic_base_url()
    product_models = _build_product_models()
    product_models_file = provider_models_file(DEFAULT_PROVIDER)
    overlay_models_file = provider_user_models_file(DEFAULT_PROVIDER)
    product_path = _catalog_path(target, product_models_file)
    overlay_path = _catalog_path(target, overlay_models_file)
    product_catalog = render_models_file(product_models)
    current_catalog = _read_catalog(product_path)
    catalog_mismatch = current_catalog != product_catalog
    try:
        # The packaged config intentionally points at a product catalog that is
        # generated on first launch. Seed that product-owned dependency before
        # the first strict load, otherwise a fresh install cannot get far
        # enough to create the file it already references.
        if catalog_mismatch:
            catalog_snapshots[product_path] = (
                product_path.read_bytes() if product_path.is_file() else None
            )
            replace_models_file_text(
                product_models_file,
                product_catalog,
                path=target,
                provider_name=DEFAULT_PROVIDER,
            )

        config = load_user_config(target)
        provider = config.model_provider or DEFAULT_PROVIDER
        model = config.model or DEFAULT_MODEL

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

        # Every desktop user receives the product-owned HepAI catalog, but the
        # catalog is split over two files from here on:
        #
        #   provider_hepai.toml        product-owned, regenerated as a whole
        #                              from model_defaults, never merged
        #   provider_hepai.local.toml  user-owned, never regenerated
        #
        # Regenerating the product file whole is what makes ownership a fact of
        # the file layout instead of a guess: a model the product removes is
        # gone, one it adds appears, and a hand-edited product file is repaired.
        existing_hepai = config.providers.get(DEFAULT_PROVIDER)
        endpoint_mismatch = existing_hepai is None or (
            existing_hepai.base_url.rstrip("/") != openai_base_url.rstrip("/")
            or (existing_hepai.anthropic_base_url or "").rstrip("/") != anthropic_base_url.rstrip("/")
            or (existing_hepai.google_base_url or "").rstrip("/") != openai_base_url.rstrip("/")
            or bool(existing_hepai.requires_api_key)
        )
        pointer_mismatch = existing_hepai is not None and (
            existing_hepai.models_file != product_models_file
            or existing_hepai.user_models_file != overlay_models_file
        )
        if endpoint_mismatch or pointer_mismatch or catalog_mismatch:
            provider_values: dict[str, object] = {
                "base_url": openai_base_url,
                "anthropic_base_url": anthropic_base_url,
                "google_base_url": openai_base_url,
                "requires_api_key": False,
                "models_file": product_models_file,
                "user_models_file": overlay_models_file,
            }
            if (
                existing_hepai is not None
                # Only a Provider that is not file-backed yet can hold a pre-split
                # inline catalog. Once the pointer exists the catalog file is
                # product-owned, so a mismatch means it was hand-edited (or the
                # product changed): it is regenerated whole and nothing found in
                # it may be adopted as one of the user's own models.
                and existing_hepai.models_file is None
                and not overlay_path.is_file()
            ):
                # One-time adoption of the pre-split single catalog. Entries the
                # product does not define move into the user's overlay so they
                # survive the switch to whole-file regeneration, and entries the
                # user had switched off become the overlay's kill switches,
                # because the regenerated product file always enables its models.
                adopted, disabled = _split_legacy_catalog(existing_hepai, product_models)
                if adopted or disabled:
                    provider_values["user_models"] = adopted
                    provider_values["disabled_models"] = disabled
                    actions.append("adopt_legacy_hepai_models_into_user_overlay")
            # The product catalog may already have been staged above. Preserve
            # the original pre-bootstrap snapshot instead of replacing it with
            # the newly generated bytes.
            if product_path not in catalog_snapshots:
                catalog_snapshots[product_path] = (
                    product_path.read_bytes() if product_path.is_file() else None
                )
            if overlay_path not in catalog_snapshots:
                catalog_snapshots[overlay_path] = (
                    overlay_path.read_bytes() if overlay_path.is_file() else None
                )
            upsert_provider(DEFAULT_PROVIDER, provider_values, path=target)
            actions.append("sync_hepai_product_models")
            if any(
                model_id in RETIRED_PRODUCT_MODELS for model_id in _catalog_model_ids(current_catalog)
            ):
                actions.append("purge_retired_product_models")
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
            # Snapshot the Agent file first: ``_restore`` reads ``None`` as
            # "the file did not exist", so a failure after a migration would
            # otherwise delete a file this run merely rewrote.
            original_agent = agent_path.read_bytes() if agent_path.is_file() else None
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
            elif _migrate_retired_agent_bindings(agent_path, product_models):
                # A retired product model is gone from the catalog, so a slot
                # still bound to it would break every model-state read.
                actions.append("migrate_retired_agent_bindings")

        final = load_user_config(target)
        if final.current_agent == DEFAULT_AGENT and not (
            target.parent / DEFAULT_AGENT_CONFIG_FILE
        ).is_file():
            raise ConfigError("Default OpenDrSai Agent configuration was not created")
        return DesktopBootstrapResult(bool(actions), tuple(actions), str(target))
    except Exception:
        _restore(target, original_config)
        for catalog_path, catalog_content in catalog_snapshots.items():
            _restore(catalog_path, catalog_content)
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
        "https://ddf.ihep.ac.cn/apiv2/anthropic",
    }
    is_non_anthropic_model = not model.startswith(("claude-", "claude/", "anthropic/"))
    return is_hepai_url and is_non_anthropic_model and api_key_env in {"", "ANTHROPIC_API_KEY"}


# Product default that replaces a retired binding, per built-in Agent model
# slot. ``None`` means "clear the slot": the product ships no default for that
# role, so guessing one would be worse than leaving the choice to the user.
# Slots are only touched when they still name an id in
# :data:`RETIRED_PRODUCT_MODELS`; the catalog entries themselves disappear
# through the whole-file regeneration of the product catalog.
_RETIRED_AGENT_BINDING_REPLACEMENTS: dict[str, str | None] = {
    "primary": DEFAULT_MODEL,
    "image_understanding": "gpt-5.6-luna",
    "image_generation": DEFAULT_IMAGE_GENERATION_MODEL,
    "text_to_speech": "tts-1",
    "speech_to_text": "whisper-1",
    "realtime_voice": None,
}


def _migrate_retired_agent_bindings(
    agent_path: Path,
    product_models: Mapping[str, dict[str, object]],
) -> bool:
    """Rebind built-in Agent slots that still name a retired product model.

    Retiring a model removes it from the product catalog, so a binding that
    still refers to it can never resolve: ``/v1/config/model-state`` answers
    400 on every read and the Desktop keeps showing the model as unconfigured.
    Repointing each slot at the product default for its role heals that.

    Only the built-in Agent is self-healed. A user-authored Agent keeps its
    invalid binding, so the mistake stays visible instead of being silently
    rewritten — ``/v1/config/agents/<id>/model-capability-status`` reports
    ``valid=false`` for it and points at what to fix.
    """
    if not agent_path.is_file():
        return False
    snapshot = load_agent_model_policy(DEFAULT_AGENT, path=agent_path)
    policy = snapshot.policy
    if policy.agent_id != DEFAULT_AGENT:
        return False
    updates: dict[str, AgentModelSelection | None] = {}
    for role, replacement in _RETIRED_AGENT_BINDING_REPLACEMENTS.items():
        current = getattr(policy, f"{role}_model")
        if current is None or current.ref is None:
            continue
        if current.ref.model_id not in RETIRED_PRODUCT_MODELS:
            continue
        if replacement is not None and replacement not in product_models:
            # Never write a binding the product catalog cannot resolve.
            continue
        updates[f"{role}_model"] = (
            None
            if replacement is None
            else AgentModelSelection("explicit", ModelRef(DEFAULT_PROVIDER, replacement))
        )
    # ``image_model`` is the pre-rename field: it is only ever read, and any
    # write migrates it to ``image_generation_model``, so a retired value there
    # is cleared rather than repointed.
    legacy_image = policy.image_model
    if legacy_image is not None and legacy_image.ref is not None:
        if legacy_image.ref.model_id in RETIRED_PRODUCT_MODELS:
            updates["image_model"] = None
    if not updates:
        return False
    updated = replace(policy, **updates)
    commit_agent_model_policy(updated, expected_revision=snapshot.revision, path=agent_path)
    return True


def _default_agent_model_policy(
    provider: str,
    primary_model: str,
    product_models: dict[str, dict[str, object]] | None = None,
) -> AgentModelPolicy:
    def explicit(model: str) -> AgentModelSelection:
        return AgentModelSelection("explicit", ModelRef(provider, model))

    product_models = product_models if product_models is not None else _build_product_models()
    if provider != DEFAULT_PROVIDER or primary_model not in product_models:
        return AgentModelPolicy(agent_id=DEFAULT_AGENT, primary_model=explicit(primary_model))
    image_generation = (
        explicit(DEFAULT_IMAGE_GENERATION_MODEL)
        if DEFAULT_IMAGE_GENERATION_MODEL
        else None
    )
    return AgentModelPolicy(
        agent_id=DEFAULT_AGENT,
        primary_model=explicit(DEFAULT_MODEL),
        image_understanding_model=explicit("gpt-5.6-luna"),
        image_generation_model=image_generation,
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
        **({"token_limit": value.token_limit} if getattr(value, "token_limit", None) is not None else {}),
        **({"max_tokens": value.max_tokens} if getattr(value, "max_tokens", None) is not None else {}),
        **({"reasoning_efforts": list(value.reasoning_efforts)} if getattr(value, "reasoning_efforts", None) else {}),
    }


def _builtin_model_definition(model_id: str) -> dict[str, object]:
    """Describe a built-in model the way ``_build_product_models`` would.

    Used when adopting a legacy catalog that listed bare model IDs: the list
    carried no per-entry declaration, so the registry is the best available
    description of what that model can do.
    """
    capabilities, known = find_model_capabilities(model_id)
    input_modalities: list[str] = ["text"]
    if known and capabilities.vision:
        input_modalities.append("image")
    declared = ["chat", "tool_calling"]
    if known and capabilities.reasoning.supported:
        declared.append("reasoning")
    return {
        "input_modalities": input_modalities,
        "output_modalities": ["text"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": declared,
    }


def _split_legacy_catalog(
    provider: object,
    product_models: Mapping[str, object],
) -> tuple[dict[str, dict[str, object]], list[str]]:
    """Split a pre-split Provider catalog into user models and kill switches.

    The return value is ``(adopted, disabled)``: ``adopted`` are the entries
    the product does not define, which become the user's own overlay entries,
    and ``disabled`` are product entries the user had switched off, which the
    overlay has to remember because the regenerated product file always enables
    its models. Retired product models are dropped rather than adopted, so a
    catalog the user never touched does not resurrect them.
    """
    product_ids = set(product_models)
    configs = getattr(provider, "model_configs", {})
    disabled: list[str] = [
        model_id
        for model_id in getattr(provider, "disabled_models", ())
        if model_id in product_ids
    ]
    adopted: dict[str, dict[str, object]] = {}
    for model_id in getattr(provider, "models", ()):
        if model_id in RETIRED_PRODUCT_MODELS:
            continue
        config = configs.get(model_id)
        if model_id in product_ids:
            if config is not None and getattr(config, "enabled", True) is False and model_id not in disabled:
                disabled.append(model_id)
            continue
        adopted[model_id] = (
            _model_config_values(config) if config is not None else _builtin_model_definition(model_id)
        )
    return adopted, disabled


def _catalog_path(config_path: Path, models_file: str) -> Path:
    return (config_path.resolve().parent / Path(models_file)).resolve()


def _read_catalog(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _catalog_model_ids(text: str | None) -> tuple[str, ...]:
    """Best-effort model IDs in a catalog file, for reporting what was purged."""
    if not text:
        return ()
    try:
        document = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return ()
    models = document.get("models")
    return tuple(models) if isinstance(models, Mapping) else ()


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
