"""Factory module for building a local DrSaiAssistant for drsai-cli.

Ported from the project-root ``run_drsai_agent.py`` example so the CLI can
spin up a ``DrSaiAssistant`` without relying on files outside the package.

Secrets and endpoints follow the env-first, config-fallback pattern:
    env var  >  cli_config.json value  >  built-in default
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

from drsai.backend.cli.config import load_config, save_config
from drsai.configs.constant import CONFIG_DIR, FS_DIR, WORKSPACE_DIR, WORKSPACE_RUNS_DIR
from drsai.modules.agents.skills_agent import DrSaiAssistant, DrSaiCLIAssistant
from drsai.modules.components.model_client import (
    HepAIChatCompletionClient,
    ModelFamily,
)
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO,
)
from drsai.modules.managers.database import DatabaseManager

load_dotenv()


# ── Plan Mode Prompt ─────────────────────────────────────────────────────────
PLAN_MODE_SYSTEM_PROMPT = """Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead."""


# ── Workspace ────────────────────────────────────────────────────────────────

WORKSPACE = Path(WORKSPACE_DIR)
DATASET = WORKSPACE / "drsai"
DATASET.mkdir(parents=True, exist_ok=True)
WORKDIR = Path(WORKSPACE_RUNS_DIR)

# Default path for llm_mode_config YAML (seed file)
DEFAULT_LLM_CONFIG_FILE = str(Path(CONFIG_DIR) / "llm_mode_config.yaml")


# ── ReasoningConfig dataclass ─────────────────────────────────────────────────

@dataclass
class ReasoningConfig:
    """Configuration for extended thinking/reasoning features."""

    supported: bool = False
    effort_levels: list[str] = field(default_factory=lambda: [])
    param_type: str = "none"  # adaptive | enabled | is_r1_model | reasoning_effort | minimax_format | zhipu_format | none

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
    """A single entry in the LLM mode config."""

    model: str                           # Full model ID (e.g. "anthropic/claude-sonnet-4-6")
    token_limit: int                     # Total context window size (input + output tokens combined)
    max_tokens: int = 0                  # Maximum output tokens per request (0 = use token_limit * 0.25)
    client_type: str = "auto"            # anthropic | openai | auto
    reasoning: ReasoningConfig = field(default_factory=ReasoningConfig)
    vision: bool = True                  # Whether the model supports image input (vision capability)

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

            # Auto-detect vision when not explicitly set:
            # Default True (most modern models support vision), but common
            # non-vision model families (deepseek, gpt-3.5, etc.) default False.
            vision_raw = data.get("vision")
            if vision_raw is not None:
                vision = bool(vision_raw)
            else:
                # Heuristic auto-detect from model name
                model_lower = str(data.get("model", alias)).lower()
                vision = not any(tag in model_lower for tag in ["deepseek", "gpt-3.5", "gpt-35", "o1-preview", "o1-mini"])

            return ModelEntry(
                model=str(data.get("model", alias)),
                token_limit=int(data.get("token_limit", 128000)),
                max_tokens=int(data.get("max_tokens", 0)),
                client_type=str(data.get("client_type", "auto")),
                reasoning=reasoning,
                vision=vision,
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

        # Auto-detect vision for v1 format
        model_lower = model.lower()
        vision = not any(tag in model_lower for tag in ["deepseek", "gpt-3.5", "gpt-35", "o1-preview", "o1-mini"])

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
        model="deepseek-ai/deepseek-v4-pro",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,      # max output per request (DeepSeek supports extended output)
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="is_r1_model"),
        vision=False,           # DeepSeek V4 text models do not support image input
    ),
    
    "hepai/deepseek-v4-flash": ModelEntry(
        model="hepai/deepseek-v4-flash",
        token_limit=10000000,      # context window: 163,840 (shared input+output)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=False, effort_levels=[], param_type="none"),
        vision=False,           # DeepSeek V4 text models do not support image input
    ),
    "deepseek-v4-pro": ModelEntry(
        model="deepseek-ai/deepseek-v4-pro",
        token_limit=1048576,     # context window: 1M (input+output shared, per DeepSeek docs)
        max_tokens=64000,      # max output per request (DeepSeek supports extended output)
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="is_r1_model"),
        vision=False,
    ),
    "deepseek-v4-flash": ModelEntry(
        model="deepseek-ai/deepseek-v4-flash",
        token_limit=10000000,      # context window: 163,840 (shared input+output)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=False, effort_levels=[], param_type="none"),
        vision=False,
    ),
    # ── OpenAI GPT ───────────────────────────────────────────────────
    "gpt-5.4": ModelEntry(
        model="openai/gpt-5.4",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
    ),
    "gpt-5.5": ModelEntry(
        model="openai/gpt-5.5",
        token_limit=1050000,     # max input tokens (output comes from this pool)
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["none", "low", "medium", "high", "xhigh"], param_type="reasoning_effort"),
        vision=True,            # GPT-5.x supports image input
    ),
    # ── GIMINI ────────────────────────────────────────────────────
    "gemini-3.1-pro-preview": ModelEntry(
        model="google/gemini-3.1-pro-preview",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive"),
        vision=True,            # Claude Sonnet 4.6 supports image input
    ),
    "gemini-3-flash-preview": ModelEntry(
        model="google/gemini-3-flash-preview",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,       # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive"),
        vision=True,            # Claude Sonnet 4.6 supports image input
    ),
    # ── Zhipu GLM ────────────────────────────────────────────────────
    # Sources: litellm (zai/glm-5), OpenRouter
    "glm-5.1": ModelEntry(
        model="zhipu/glm-5.1",
        token_limit=200000,      # context window: 200K
        max_tokens=64000,      # max output per request
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="zhipu_format"),
        vision=True,            # GLM-5.1 supports image input
    ),
    "glm-5.2": ModelEntry(
        model="zhipu/glm-5.2",
        token_limit=200000,
        max_tokens=64000,
        client_type="openai",
        reasoning=ReasoningConfig(supported=True, effort_levels=["low", "medium", "high"], param_type="zhipu_format"),
        vision=True,
    ),
    # ── MiniMax ──────────────────────────────────────────────────────
    "minimax-m2.7-highspeed": ModelEntry(
        model="minimax/minimax-m2.7-highspeed",
        token_limit=196608,
        max_tokens=64000,
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=False, effort_levels=[], param_type="none"),
        vision=False,           # MiniMax M2.7 does not support image input
    ),
    "hepai/minimax-m2.7-highspeed": ModelEntry(
        model="hepai/minimax-m2.7-highspeed",
        token_limit=196608,
        max_tokens=64000,
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=False, effort_levels=[], param_type="none"),
        vision=False,
    ),
    # ── Anthropic Claude ──────────────────────────────────────────────
    # token_limit = total context window (input + output share the same window)
    # max_tokens  = maximum output tokens per request (Anthropic API requires this)
    # Sources: litellm model_prices_and_context_window.json, Anthropic docs
    "claude-sonnet-4-6": ModelEntry(
        model="anthropic/claude-sonnet-4-6",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,       # max output per request
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive"),
        vision=True,            # Claude Sonnet 4.6 supports image input
    ),
    "claude-opus-4-7": ModelEntry(
        model="anthropic/claude-opus-4-7",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,      # max output per request
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive"),
        vision=True,            # Claude Opus 4.7 supports image input
    ),
    "claude-opus-4-8": ModelEntry(
        model="anthropic/claude-opus-4-8",
        token_limit=1000000,     # context window: 1M (input+output shared)
        max_tokens=64000,      # max output per request
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive"),
        vision=True,            # Claude Opus 4.7 supports image input
    ),
    "claude-haiku-4-5": ModelEntry(
        model="anthropic/claude-haiku-4-5",
        token_limit=200000,      # context window: 200K (input+output shared)
        max_tokens=64000,       # max output per request
        client_type="anthropic",
        reasoning=ReasoningConfig(supported=False, effort_levels=[], param_type="none"),
        vision=True,            # Claude Haiku 4.5 supports image input
    ),
}

DEFAULT_CONFIG_NAME = "deepseek-v4-pro"


# Endpoint defaults — match run_drsai_agent.py
_DEFAULT_ANTHROPIC_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2/anthropic"
_DEFAULT_OPENAI_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"
_DEFAULT_RAGFLOW_URL = "https://ragflow.ihep.ac.cn"


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
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-haiku-4-5": "Claude Haiku 4.5",
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


def build_model_catalog(
    llm_config: Optional[dict[str, ModelEntry]] = None,
    default_alias: Optional[str] = None,
) -> dict[str, Any]:
    config = llm_config or DEFAULT_LLM_MODE_CONFIG
    models: list[dict[str, Any]] = []
    for alias, entry in config.items():
        client_type = entry.client_type if entry.client_type != "auto" else (
            "anthropic" if any(tag in entry.model.lower() for tag in ["claude", "anthropic", "minimax"]) else "openai"
        )
        models.append({
            "alias": alias,
            "display_name": _display_name_from_alias(alias),
            "client_type": client_type,
            "model": entry.model,
            "token_limit": entry.token_limit,
            "max_tokens": entry.max_tokens,
            "vision": entry.vision,
        })
    models.sort(key=lambda item: (item["client_type"], item["display_name"], item["alias"]))
    return {
        "default_alias": default_alias or DEFAULT_CONFIG_NAME,
        "models": models,
    }


def load_llm_mode_config(path: Optional[str]) -> dict[str, ModelEntry]:
    """Load an external model catalog from YAML or JSON.

    Supports both v1 format (simple [model_id, token_limit] pairs) and
    v2 format (structured dict with reasoning config).

    V1 format::

        alias: [model_id, token_limit]

    V2 format::

        alias: {
            "model": "model_id",
            "token_limit": 200000,
            "client_type": "anthropic",  # optional
            "reasoning": {
                "supported": true,
                "effort_levels": ["low", "medium", "high"],
                "param_type": "adaptive"
            }
        }

    If ``path`` is falsy or missing, returns ``DEFAULT_LLM_MODE_CONFIG``.
    """
    if not path:
        return DEFAULT_LLM_MODE_CONFIG.copy()

    p = Path(os.path.expanduser(os.path.expandvars(path)))
    if not p.exists():
        raise FileNotFoundError(f"llm_config_file not found: {p}")

    suffix = p.suffix.lower()
    text = p.read_text(encoding="utf-8")
    if suffix in {".yaml", ".yml"}:
        import yaml
        raw = yaml.safe_load(text) or {}
    elif suffix == ".json":
        raw = json.loads(text)
    else:
        raise ValueError(f"Unsupported llm_config_file suffix {suffix!r}; use .yaml/.yml/.json")

    if not isinstance(raw, dict):
        raise ValueError(f"llm_config_file must contain a mapping, got {type(raw).__name__}")

    # Filter out metadata keys (those starting with underscore)
    out: dict[str, ModelEntry] = {}
    for alias, val in raw.items():
        if alias.startswith("_"):
            continue
        out[str(alias)] = ModelEntry.from_dict(alias, val)
    return out


def get_llm_config_file_path() -> Optional[str]:
    """Return the current llm_config_file path from cli_config.json, or None."""
    try:
        cfg = load_config()
        return cfg.get("llm_config_file") or None
    except Exception:
        return None


def ensure_llm_config_file() -> str:
    """Ensure llm_mode_config.yaml exists, seeding from defaults if needed.
    Returns the path to the config file.
    """
    existing = get_llm_config_file_path()
    if existing and Path(existing).exists():
        return existing

    path = Path(DEFAULT_LLM_CONFIG_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)

    if not path.exists():
        _write_llm_config(path, DEFAULT_LLM_MODE_CONFIG, DEFAULT_CONFIG_NAME)

    # Update cli_config.json (best-effort)
    try:
        cfg = load_config()
        cfg["llm_config_file"] = str(path)
        save_config(cfg)
    except Exception:
        pass

    return str(path)


def _write_llm_config(path: Path, config: dict[str, ModelEntry], default_alias: str) -> None:
    """Write llm_mode_config to YAML file."""
    import yaml

    data: dict[str, Any] = {"_default_alias": default_alias}
    for alias, entry in config.items():
        data[alias] = entry.to_dict()

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def save_llm_mode_config(config: dict[str, ModelEntry], default_alias: str) -> None:
    """Persist llm_mode_config to the configured YAML file."""
    file_path = ensure_llm_config_file()
    _write_llm_config(Path(file_path), config, default_alias)


def _resolve(cli_cfg: dict[str, Any], cfg_key: str, *env_keys: str, default: str = "") -> str:
    """Resolve a config value. Env wins, then cli_cfg, then default."""
    for env_key in env_keys:
        v = os.environ.get(env_key)
        if v:
            return v
    if cfg_key in cli_cfg:
        v = cli_cfg.get(cfg_key)
        if v is not None and v != "":
            return str(v)
    return default


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on", "enable", "enabled"}:
        return True
    if text in {"0", "false", "no", "n", "off", "disable", "disabled"}:
        return False
    return default


def _build_cwd_prompt(cli_cfg: dict[str, Any], work_dir: str = "") -> str:
    """Compose a small system-prompt prefix that tells the agent the user's
    current working directory.

    The CLI injects this each time a session starts so the agent can
    resolve relative paths and skill searches against the user's project.
    An explicit ``cli_cfg['system_message']`` or env ``DRSAI_SYSTEM_MESSAGE``
    is appended on top for user-supplied context.

    If ``cli_cfg['plan_mode']`` is True, the plan mode prompt is prepended
    to guide the agent to interview the user about their plan.
    """
    if work_dir:
        cwd = work_dir
    else:
        try:
            cwd = os.getcwd()
        except Exception:
            cwd = ""
    lines: list[str] = []

    # Plan mode: prepend the plan mode prompt
    if cli_cfg.get("plan_mode"):
        lines.append(PLAN_MODE_SYSTEM_PROMPT)
        lines.append("")  # Empty line separator

    if cwd:
        lines.append(
            "## Environment\n"
            f"The user launched drsai-cli from this working directory:\n"
            f"  {cwd}\n"
            "Resolve relative file paths against this directory unless the "
            "user specifies otherwise. Treat it as the project root when "
            "searching for code or config."
        )
    extra = os.environ.get("DRSAI_SYSTEM_MESSAGE") or cli_cfg.get("system_message") or ""
    extra = str(extra).strip()
    if extra:
        lines.append(extra)
    return "\n\n".join(lines) if lines else ""


def create_agent(
    api_key: Optional[str] = None,
    thread_id: Optional[str] = None,
    user_id: Optional[str] = None,
    db_manager: Optional[DatabaseManager] = None,
    defult_config_name: Optional[str] = None,
    cli_cfg: Optional[dict[str, Any]] = None,
    assistant_cls: type[DrSaiAssistant] = DrSaiCLIAssistant,
    work_dir: Optional[str] = None,
    # ── New params (design-20260623 §6.2) ──
    sub_agent_config: Optional[dict] = None,
    extra_tools: Optional[list] = None,
    enable_security: bool = False,
) -> DrSaiAssistant:
    """Build a local DrSai assistant from CLI config.

    Args:
        api_key: legacy HEPAI key (backward-compatible). Used only as a
            last-resort fallback for either provider branch.
        thread_id, user_id, db_manager: wired through to the assistant.
        defult_config_name: model alias within the loaded llm_mode_config.
        cli_cfg: merged CLI config dict (see cli/config.DEFAULT_CONFIG).
            Supports plan_mode key: if True, the plan mode prompt is
            prepended to the system message to guide the agent to interview
            the user about their plan.
        assistant_cls: class to instantiate. Defaults to
            :class:`DrSaiCLIAssistant`; production callers (e.g. the worker)
            should pass the plain :class:`DrSaiAssistant`.

    Plan-C workspace strategy (CLI mode):
        - work_dir = cwd  (user's project directory is the primary workspace for tools)
        - storage_dir = WORKDIR / user_id  (internal configs/memories stored separately)
        - only_in_workspace = True  (tools restricted to cwd + storage_dir)
        - extra_work_dirs = [storage_dir]  (agent can access its own internal files)
    """
    cli_cfg = cli_cfg or load_config()

    # LLM catalog: env > cli_cfg > built-in default.
    llm_config_path = _resolve(cli_cfg, "llm_config_file", "LLM_CONFIG_FILE") or None
    llm_mode_config = load_llm_mode_config(llm_config_path)

    # Default alias: explicit arg > env var > cli_cfg > module default.
    env_alias = os.environ.get("LLM_DEFAULT_ALIAS")
    resolved_config_name = (
        defult_config_name
        or env_alias
        or cli_cfg.get("defult_config_name")
        or DEFAULT_CONFIG_NAME
    )
    if resolved_config_name not in llm_mode_config:
        resolved_config_name = next(iter(llm_mode_config))

    anthropic_base_url = _resolve(
        cli_cfg, "anthropic_base_url", "ANTHROPIC_BASE_URL",
        default=_DEFAULT_ANTHROPIC_BASE_URL,
    )
    anthropic_api_key = _resolve(
        cli_cfg, "anthropic_api_key", "ANTHROPIC_API_KEY", "HEPAI_API_KEY",
    ) or api_key

    openai_base_url = _resolve(
        cli_cfg, "openai_base_url", "OPENAI_BASE_URL",
        default=_DEFAULT_OPENAI_BASE_URL,
    )
    openai_api_key = _resolve(
        cli_cfg, "openai_api_key", "OPENAI_API_KEY", "HEPAI_API_KEY",
    ) or api_key

    anthropic_cache_enabled = _as_bool(
        _resolve(
            cli_cfg,
            "anthropic_cache_enabled",
            "DRSAI_ANTHROPIC_CACHE_ENABLED",
            default=True,
        ),
        default=True,
    )
    anthropic_cache_ttl = str(
        _resolve(
            cli_cfg,
            "anthropic_cache_ttl",
            "DRSAI_ANTHROPIC_CACHE_TTL",
            default="1h",
        )
    )
    if anthropic_cache_ttl not in {"5m", "1h"}:
        anthropic_cache_ttl = "1h"
    anthropic_cache_control = (
        {"type": "ephemeral", "ttl": anthropic_cache_ttl}
        if anthropic_cache_enabled
        else None
    )

    skills_dir = _resolve(cli_cfg, "skills_dir", "SYSTEM_SKILLS_DIR") or None
    rag_flow_url = _resolve(
        cli_cfg, "ragflow_url", "RAGFLOW_URL", default=_DEFAULT_RAGFLOW_URL,
    )
    rag_flow_token = _resolve(cli_cfg, "ragflow_token", "RAGFLOW_TOKEN") or None
    memory_dataset_id = _resolve(
        cli_cfg, "memory_dataset_id", "MEMORY_DATASET_ID",
    ) or None
    context_type = _resolve(
        cli_cfg, "context_type", "DRSAI_CONTEXT_TYPE", default="sqlite",
    ) or "sqlite"

    # ── Plan-C: workspace strategy ──────────────────────────────────────
    # Resolve effective user_id for storage_dir computation.
    effective_user_id = user_id or os.environ.get("DRSAI_USER_ID") or "anonymous"
    # cwd is the primary tool workspace; internal configs go to WORKDIR/<user_id>
    # When work_dir is explicitly provided (e.g. by Tray GUI), use it instead of os.getcwd()
    if work_dir:
        cwd = work_dir
    else:
        try:
            cwd = os.getcwd()
        except Exception:
            cwd = str(WORKDIR)
    user_storage_dir = str(WORKDIR / effective_user_id)

    # OpenAI new-series models (gpt-5.x, gpt-4.1, o1/o3/o4) reject 'max_tokens',
    # they require 'max_completion_tokens' instead.  Third-party OpenAI-compatible
    # APIs (DeepSeek, GLM, etc.) only accept 'max_tokens'.
    _OPENAI_NEW_MODEL_PREFIXES = ("gpt-5", "gpt-4.1", "o1", "o3", "o4")

    def set_model_client(
        name: Optional[str] = resolved_config_name,
    ) -> HepAIAnthropicChatCompletionClient | HepAIChatCompletionClient:
        alias = name or resolved_config_name
        entry = llm_mode_config.get(alias)
        if entry is None:
            entry = llm_mode_config[resolved_config_name]
        llm_model = entry.model
        token_limit = entry.token_limit
        max_tokens = entry.max_tokens if entry.max_tokens > 0 else int(token_limit * 0.25)
        client_type = entry.client_type
        reasoning_config = entry.reasoning

        # Determine client type
        if client_type == "auto":
            if "claude" in llm_model or "anthropic" in llm_model or "minimax" in llm_model:
                client_type = "anthropic"
            else:
                client_type = "openai"

        # Handle "minimax" specially - use anthropic client with HepAI endpoint
        if "minimax" in llm_model:
            client_type = "anthropic"

        if client_type == "anthropic":
            model_info = dict(_MODEL_INFO.get("claude-sonnet-4-5", {}))
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            # Override vision from the config entry (rather than relying on
            # the autogen built-in _MODEL_INFO which only covers well-known
            # OpenAI/Anthropic model names).
            model_info["vision"] = entry.vision
            # Add reasoning config to model_info for client to use
            model_info["reasoning_config"] = reasoning_config
            if anthropic_cache_control is not None:
                model_info["anthropic_cache_control"] = anthropic_cache_control
            return HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url=anthropic_base_url,
                api_key=anthropic_api_key,
                model_info=model_info,
                max_tokens=max_tokens,
            )

        # OpenAI-compatible client: use vision from the config entry
        # (previously was hardcoded as "deepseek" not in llm_model).
        model_info = {
            "vision": entry.vision,
            "function_calling": True,
            "json_output": True,
            "structured_output": False,
            "family": ModelFamily.GPT_41,
            "multiple_system_messages": True,
            "token_model": "gpt-4o-2024-11-20",
            "reasoning_config": reasoning_config,
        }

        # Decide which token-limit parameter to use:
        #   - OpenAI new-series (gpt-5.x, gpt-4.1, o1/o3/o4) → max_completion_tokens
        #   - All other OpenAI-compatible models (DeepSeek, GLM, etc.) → max_tokens
        if llm_model.startswith("openai/"):
            model_suffix = llm_model.split("/", 1)[1]
            needs_max_completion = any(
                model_suffix.startswith(p) for p in _OPENAI_NEW_MODEL_PREFIXES
            )
        else:
            needs_max_completion = False

        if needs_max_completion:
            return HepAIChatCompletionClient(
                model=llm_model,
                api_key=openai_api_key,
                base_url=openai_base_url,
                model_info=model_info,
                max_completion_tokens=max_tokens,
            )
        else:
            return HepAIChatCompletionClient(
                model=llm_model,
                api_key=openai_api_key,
                base_url=openai_base_url,
                model_info=model_info,
                max_tokens=max_tokens,
            )

    entry = llm_mode_config.get(resolved_config_name)
    if entry is None:
        entry = next(iter(llm_mode_config.values()))
    token_limit = entry.token_limit

    cwd_prompt = _build_cwd_prompt(cli_cfg, work_dir=cwd)

    # ── Security mode (design-20260623 §6.2) ──
    # enable_security=False: CLI mode (personal use, all tools open)
    # enable_security=True:  server mode (permission tiers + Skill elevation)
    if enable_security:
        allow_basic_tools = ["run_read"]  # user: read-only (Skill elevation adds more)
        only_in_workspace_sec = True
        allow_dangerous = False
    else:
        allow_basic_tools = None           # CLI: full access
        only_in_workspace_sec = cli_cfg.get("workspace_enabled", True)
        allow_dangerous = cli_cfg.get("dangerous_allowed", False)

    # ── Merge extra_tools with existing tools ──
    final_tools = list(extra_tools) if extra_tools else None

    # ── Sub-agent config ──
    final_sub_agent_config = sub_agent_config or {}

    return assistant_cls(
        name="Assistant",
        model_client=set_model_client(resolved_config_name),
        system_message=cwd_prompt,
        reflect_on_tool_use=False,
        model_client_stream=True,
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=set_model_client,
        llm_mode_config=llm_mode_config,
        defult_config_name=resolved_config_name,
        # is_powershell=False,
        skills_dir=skills_dir,
        # ── Plan-C workspace strategy ──
        work_dir=cwd,                    # Primary tool workspace = user's cwd
        storage_dir=user_storage_dir,     # Internal configs/memories stored separately
        only_in_workspace=only_in_workspace_sec,  # CLI: from config; server: True
        extra_work_dirs=[user_storage_dir],  # Allow access to internal storage
        only_system_message=False,
        allolow_dangrous_cmd=allow_dangerous,  # CLI: from config; server: False
        allolow_basic_tools=allow_basic_tools,  # CLI: None (full); server: ["run_read"]
        tools=final_tools,                # Extra tools (MCP, knowledge, GFS, etc.)
        sub_agent_config=final_sub_agent_config,
        max_agent_concurrent=cli_cfg.get("max_agent_concurrent", 5),
        token_limit=int(token_limit * 0.7),
        rag_flow_url=rag_flow_url,
        rag_flow_token=rag_flow_token,
        memory_dataset_id=memory_dataset_id,
        context_type=context_type,  # "ragflow" or "sqlite", from env DRSAI_CONTEXT_TYPE
    )
