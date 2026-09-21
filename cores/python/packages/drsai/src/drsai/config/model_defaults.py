"""Pure-data model catalog definitions — the single source of truth for model
capabilities and connection settings.

This module is a **leaf** in the import graph: it imports nothing from
``drsai.config`` or ``drsai.backend``, so it can be safely imported from
anywhere (including ``model_registry.py`` inside ``drsai.config``) without
triggering circular imports.

Symbols moved here from ``run_drsai_agent_factory.py``:
  - Endpoint defaults: _DEFAULT_ANTHROPIC_BASE_URL, _DEFAULT_OPENAI_BASE_URL, _DEFAULT_RAGFLOW_URL
  - ReasoningConfig dataclass
  - ModelEntry dataclass
  - DEFAULT_LLM_MODE_CONFIG dict
  - DEFAULT_CONFIG_NAME constant
  - DISPLAY_NAME_OVERRIDES dict
  - _display_name_from_alias() helper
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# ── Endpoint defaults ─────────────────────────────────────────────────────────
# Defined before DEFAULT_LLM_MODE_CONFIG because catalog entries reference them.

_DEFAULT_ANTHROPIC_BASE_URL = ""  # Empty: fall through to dynamically-resolved URL from defaults.py
_DEFAULT_OPENAI_BASE_URL = ""  # Empty: fall through to dynamically-resolved URL from defaults.py
_DEFAULT_RAGFLOW_URL = "https://ragflow.ihep.ac.cn"


# ── ReasoningConfig dataclass ─────────────────────────────────────────────────


@dataclass
class ReasoningConfig:
    """Configuration for extended thinking/reasoning features."""

    supported: bool = False
    effort_levels: list[str] = field(default_factory=lambda: [])
    param_type: str = "none"  # adaptive | enabled | is_r1_model | reasoning_effort | deepseek_reasoning_effort | minimax_format | zhipu_format | none

    def supports_effort(self, effort: str) -> bool:
        """Check if the given effort level is supported.
        
        For is_r1_model type: effort_levels=[] means "unlimited" (any effort works)
        For other types: effort must be in effort_levels list
        """

        if not self.supported:
            return False
        if effort == "off" or effort == "hide":
            return True
        # is_r1_model supports all effort levels
        if self.param_type == "is_r1_model":
            return True
        # For other types, effort must be in the supported levels list
        # Empty list means no specific levels supported (but still enabled)
        if not self.effort_levels:
            return True
        return effort in self.effort_levels

    def to_dict(self) -> dict:
        return {
            "supported": self.supported,
            "effort_levels": self.effort_levels,
            "param_type": self.param_type,
        }


# ── ModelEntry dataclass ──────────────────────────────────────────────────────


@dataclass
class ModelEntry:
    """A single entry in the LLM mode config.

    Expanded to carry full connection info so the YAML catalog is the single
    source of truth for set_model_client.  Missing connection fields fall back
    to cli_config.json defaults (openai_base_url / anthropic_base_url etc.).
    """

    model: str                           # Full model ID (e.g. "anthropic/claude-sonnet-4-6")
    token_limit: int                     # Total context window size (input + output tokens combined)
    max_tokens: int = 0                  # Maximum output tokens per request (0 = use token_limit * 0.25)
    client_type: str = "auto"            # anthropic | openai | auto
    reasoning: ReasoningConfig = field(default_factory=ReasoningConfig)
    vision: bool = False                 # Unknown models are never assumed to accept images.
    # ── Connection info (yaml-only mode) ──
    base_url: str = _DEFAULT_OPENAI_BASE_URL   # API endpoint; "" → fall back to cli_config.json default
    api_key: str = ""                    # Plaintext API key; "" → try api_key_env or fallback
    api_key_env: str = ""                # Environment variable name for API key
    requires_api_key: bool = True        # False → endpoint needs no authentication
    # ── Wire protocol ──
    # None → infer in set_model_client (OpenAI new-series gpt-5.x/o* → True, else
    # False). True/False → force, overrides inference. Lets users opt out of the
    # Responses API for third-party OpenAI-compatible endpoints that only
    # implement Chat Completions (e.g. HEPAI gateway for kimi/glm/deepseek).
    use_responses_api: Optional[bool] = None

    @staticmethod
    def from_dict(alias: str, data: Any) -> "ModelEntry":
        """Parse a model entry from config dict.

        Supports both old format (v1) and new format (v2).
        """
        # New format (v2): dict with explicit fields
        if isinstance(data, dict):
            reasoning_raw = data.get("reasoning", {})
            if isinstance(reasoning_raw, dict):
                reasoning = ReasoningConfig(
                    supported=reasoning_raw.get("supported", False),
                    effort_levels=reasoning_raw.get("effort_levels", []),
                    param_type=reasoning_raw.get("param_type", "none"),
                )
            else:
                reasoning = ReasoningConfig()

            # Legacy overrides may declare vision explicitly. Missing metadata
            # stays fail-closed; model-name heuristics are not capability proof.
            vision_raw = data.get("vision")
            if vision_raw is not None:
                vision = bool(vision_raw)
            else:
                vision = False

            return ModelEntry(
                model=str(data.get("model", alias)),
                token_limit=int(data.get("token_limit", 128000)),
                max_tokens=int(data.get("max_tokens", 0)),
                client_type=str(data.get("client_type", "auto")),
                reasoning=reasoning,
                vision=vision,
                base_url=str(data.get("base_url", "")),
                api_key=str(data.get("api_key", "")),
                api_key_env=str(data.get("api_key_env", "")),
                requires_api_key=bool(data.get("requires_api_key", True)),
                use_responses_api=(
                    None if data.get("use_responses_api") is None
                    else bool(data.get("use_responses_api"))
                ),
            )

        # Old format (v1): [model, token_limit] list/tuple
        if isinstance(data, (list, tuple)) and len(data) >= 2:
            model = str(data[0])
            token_limit = int(data[1])
        else:
            # Fallback: treat as model name
            model = str(data)
            token_limit = 128000

        # Auto-detect client_type from model name
        client_type = "auto"
        if "claude" in model.lower() or "anthropic" in model.lower():
            client_type = "anthropic"
        else:
            client_type = "openai"

        # V1 contains no trustworthy capability metadata.
        vision = False

        return ModelEntry(
            model=model,
            token_limit=token_limit,
            client_type=client_type,
            reasoning=ReasoningConfig(),
            vision=vision,
        )

    def to_dict(self) -> dict:
        d = {
            "model": self.model,
            "token_limit": self.token_limit,
            "max_tokens": self.max_tokens,
            "client_type": self.client_type,
            "vision": self.vision,
        }
        if self.base_url:
            d["base_url"] = self.base_url
        if self.api_key:
            d["api_key"] = self.api_key
        if self.api_key_env:
            d["api_key_env"] = self.api_key_env
        if not self.requires_api_key:
            d["requires_api_key"] = self.requires_api_key
        if self.use_responses_api is not None:
            d["use_responses_api"] = self.use_responses_api
        if self.reasoning.supported:
            d["reasoning"] = self.reasoning.to_dict()
        return d


# ── Default LLM catalog (v2 format) ─────────────────────────────────────────
# Synced with /home/xiongdb/drsai_test/llm_mode_config.example.json

DEFAULT_LLM_MODE_CONFIG: dict[str, ModelEntry] = {
    # ── DeepSeek ─────────────────────────────────────────────────────
    # DeepSeek V4 Pro: context=1M, output up to 384K (input/output are separate pools)
    # DeepSeek V3.2: context=163,840 (shared input+output)
    # Sources: DeepSeek API docs (api-docs.deepseek.com), litellm, OpenRouter
    "hepai/deepseek-v4-pro": ModelEntry(
        model="hepai/deepseek-v4-pro",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,      # max output per request (DeepSeek supports extended output)
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
        vision=False,           # DeepSeek V4 text models do not support image input
    ),
    "hepai/deepseek-v4-flash": ModelEntry(
        model="hepai/deepseek-v4-flash",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
        vision=False,           # DeepSeek V4 text models do not support image input
    ),
    "hepai/deepseek-flash": ModelEntry(
            model="hepai/deepseek-flash",
            token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
            max_tokens=64000,       # max output per request
            client_type="openai",
            reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
            vision=True,           # DeepSeek V4 text models do not support image input
    ),
    "deepseek-v4.1-flash": ModelEntry(
            model="deepseek-ai/deepseek-v4.1-flash",
            token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
            max_tokens=64000,       # max output per request
            client_type="openai",
            reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
            vision=True,           # DeepSeek V4 text models do not support image input
        ),
    "deepseek-v4-pro": ModelEntry(
        model="deepseek-ai/deepseek-v4-pro",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,      # max output per request (DeepSeek supports extended output)
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
        vision=False,
    ),
    "deepseek-v4-flash": ModelEntry(
        model="deepseek-ai/deepseek-v4-flash",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "high", "max"], param_type="deepseek_reasoning_effort"),
        vision=False,
    ),
    # ── OpenAI GPT ───────────────────────────────────────────────────
    "gpt-5.6-luna": ModelEntry(
        model="openai/gpt-5.6-luna",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
        ),
    "gpt-5.6-terra": ModelEntry(
        model="openai/gpt-5.6-terra",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
            ),
    "gpt-5.6-sol": ModelEntry(
        model="openai/gpt-5.6-sol",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
    ),
    "gpt-6-astra": ModelEntry(
        model="openai/gpt-6-astra",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
    ),
    # ── GIMINI ────────────────────────────────────────────────────────────
    "kimi-k3": ModelEntry(
        model="moonshot/kimi-k3",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["max", "low", "high"], param_type="reasoning_effort"),
        vision=True,            # Gemini supports image input
    ),
    # ── Zhipu GLM ────────────────────────────────────────────────────
    # Sources: litellm (zai/glm-5), OpenRouter
    "glm-5.3-flash": ModelEntry(
        model="zhipu/glm-5.3-flash",
        token_limit=1000000,      # context window: 200K
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="zhipu_format"),
        vision=True,            # GLM-5.1 supports image input
    ),
    "glm-5.3": ModelEntry(
        model="zhipu/glm-5.3",
        token_limit=1000000,
        max_tokens=64000,
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="zhipu_format"),
        vision=True,
    ),
    # ── Anthropic Claude ──────────────────────────────────────────────
    # token_limit = total context window (input + output share the same window)
    # max_tokens  = maximum output tokens per request (Anthropic API requires this)
    # Sources: litellm model_prices_and_context_window.json, Anthropic docs
    # "claude-sonnet-5": ModelEntry(
    #     model="anthropic/claude-sonnet-5",
    #     token_limit=1000000,     # context window: 1M (input+output shared)
    #     max_tokens=64000,       # max output per request
    #     client_type="anthropic",
    #     reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="adaptive"),
    #     vision=True,            # Claude Sonnet 5 supports image input
    #     base_url=_DEFAULT_ANTHROPIC_BASE_URL,
    # ),
    # "claude-opus-5": ModelEntry(
    #         model="anthropic/claude-opus-5",
    #         token_limit=1000000,     # context window: 1M (input+output shared)
    #         max_tokens=64000,      # max output per request
    #         client_type="anthropic",
    #         reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="adaptive"),
    #         vision=True,            # Claude Opus 4.8 supports image input
    #         base_url=_DEFAULT_ANTHROPIC_BASE_URL,
    # ),
    # "claude-fable-5-1": ModelEntry(
    #             model="anthropic/claude-fable-5-1",
    #             token_limit=1000000,     # context window: 1M (input+output shared)
    #             max_tokens=64000,      # max output per request
    #             client_type="anthropic",
    #             reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="adaptive"),
    #             vision=True,            # Claude Opus 4.8 supports image input
    #             base_url=_DEFAULT_ANTHROPIC_BASE_URL,
    # ),
}

DEFAULT_CONFIG_NAME = "hepai/deepseek-v4-flash"
PRIVATE_MODEL_NAME = "hepai/deepseek-flash"

# Optional product default for Agent ``image_generation_model``.
# ``None`` = do not auto-bind; user must pick from IMAGE_GENERATION_MODEL_ALIASES.
DEFAULT_IMAGE_GENERATION_MODEL: str | None = "gpt-image-2.5-sunburst"

# Catalog aliases the Desktop image-generation picker and Agent policy may bind.
# Keep in sync with DEFAULT_SPECIALIZED_PRODUCT_MODELS entries that declare
# ``image_generation`` capability. First entry is the product primary/default.
IMAGE_GENERATION_MODEL_ALIASES: tuple[str, ...] = (
    "gpt-image-2.5-sunburst",
    "gpt-image-2",
    "gpt-image-2.5-flare",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
)


# ── Specialised product models (non-chat / role-bound) ───────────────────────
# Single source of truth for Desktop Provider catalog extras that are not
# ordinary chat entries in DEFAULT_LLM_MODE_CONFIG (or that override a chat
# entry with role-specific modalities/capabilities).
#
# Shape matches desktop_bootstrap / Provider ``models`` entries:
# alias?, input_modalities, output_modalities, api_protocol, enabled,
# capabilities, upstream_id?
DEFAULT_SPECIALIZED_PRODUCT_MODELS: dict[str, dict[str, object]] = {
    # Image understanding override for the chat alias already in DEFAULT_LLM_MODE_CONFIG.
    "gpt-5.6-luna": {
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["chat", "tool_calling"],
        "upstream_id": "openai/gpt-5.6-luna",
    },
    # ── Image generation candidates (AIAPI / HepAI model square) ──
    # Access notes (RuntimeImageOperationAdapter):
    # - Product HepAI Provider keeps api_protocol=openai → POST /v1/images/*
    #   with ``upstream_id`` as the square model id. Request body/size rules
    #   still differ by family (gpt-image-* vs gemini-*).
    # - Native Gemini Providers (wire_api=gemini) use generateContent instead.
    # - Product default / primary: gpt-image-2.5-sunburst.
    "gpt-image-2.5-sunburst": {
        "alias": "GPT Image 2.5 Sunburst",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text", "image"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["image_generation", "image_edit"],
        "upstream_id": "openai/gpt-image-2.5-sunburst",
    },
    "gpt-image-2": {
        "alias": "GPT Image 2",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text", "image"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["image_generation", "image_edit"],
        "upstream_id": "openai/gpt-image-2",
    },
    "gpt-image-2.5-flare": {
        "alias": "GPT Image 2.5 Flare",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text", "image"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["image_generation", "image_edit"],
        "upstream_id": "openai/gpt-image-2.5-flare",
    },
    "gemini-3.1-flash-image-preview": {
        "alias": "Gemini 3.1 Flash Image Preview",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text", "image"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["image_generation", "image_edit"],
        "upstream_id": "google/gemini-3.1-flash-image-preview",
    },
    "gemini-3-pro-image-preview": {
        "alias": "Gemini 3 Pro Image Preview",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text", "image"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["image_generation", "image_edit"],
        "upstream_id": "google/gemini-3-pro-image-preview",
    },
    # ── Audio ──
    "tts-1": {
        "input_modalities": ["text"],
        "output_modalities": ["audio"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["text_to_speech"],
    },
    "whisper-1": {
        "input_modalities": ["audio"],
        "output_modalities": ["text"],
        "api_protocol": "openai",
        "enabled": True,
        "capabilities": ["speech_to_text"],
    },
}


DISPLAY_NAME_OVERRIDES: dict[str, str] = {
    "hepai/deepseek-v4-pro": "HEPAI DeepSeek V4 PRO",
    "hepai/deepseek-v4-flash": "HEPAI DeepSeek V4 Flash",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek-v4-flash": "DeepSeek V4 Flash",
    "glm-5.1": "GLM-5.1",
    "glm-5.2": "GLM-5.2",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.5": "GPT-5.5",
    "minimax-m2.7-highspeed": "MiniMax M2.7 Highspeed",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "gpt-image-2": "GPT Image 2",
    "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
    "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
    "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image Preview",
    "gemini-3-pro-image-preview": "Gemini 3 Pro Image Preview",
}


def _display_name_from_alias(alias: str) -> str:
    if alias in DISPLAY_NAME_OVERRIDES:
        return DISPLAY_NAME_OVERRIDES[alias]
    raw = alias.split("/", 1)[-1]
    normalized = raw.replace("-", " ").replace("_", " ").strip()
    words = []
    for word in normalized.split():
        if word.lower() in {"gpt", "glm", "hepai", "claude", "deepseek", "minimax"}:
            words.append(word.upper() if word.lower() in {"gpt", "glm", "hepai"} else word.capitalize())
        elif len(word) <= 3 and any(ch.isdigit() for ch in word):
            words.append(word.upper())
        else:
            words.append(word.capitalize())
    return " ".join(words)


# ── Product-owned model ownership ─────────────────────────────────────────
#
# Ownership is decided by *which file* a catalog entry was read from
# (``configs/models/provider_<id>.toml`` = product, ``.local.toml`` = user),
# never by guessing from the model id.  See
# ``artifacts/DEFAULT_LLM_MODE_CONFIG-前端同步方案.md`` §8.3 candidate 2.
#
# Because bootstrap now regenerates the product file *as a whole* instead of
# merging, a model deleted from the dicts above disappears from every install
# on the next start — delete propagation needs no name list at all.


def product_model_ids() -> frozenset[str]:
    """Every model id the product catalog owns, derived from one source of truth."""

    return frozenset(DEFAULT_LLM_MODE_CONFIG) | frozenset(DEFAULT_SPECIALIZED_PRODUCT_MODELS)


# Ids that used to be product-owned and were later dropped from the dicts
# above.
#
# ONLY the one-time ``provider_<id>.toml`` -> ``.local.toml`` split migration
# consults this list, to decide which legacy residue must not survive as a
# user model.  It is append-only and must never be used to purge a user file
# during normal startup: candidate 2 keeps "product removed + user has the same
# id" as a live user model, and a routine purge would silently delete user data.
RETIRED_PRODUCT_MODELS: frozenset[str] = frozenset({
    # Image models retired before the file split existed.
    "gemini-3.1-flash-lite-image",
    "qwen-image-2.0",
    # Chat residue that lingered in shipped catalogs after leaving the dicts.
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
})
