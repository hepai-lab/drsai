"""Factory module for building a local DrSaiAssistant for drsai-cli.

Ported from the project-root ``run_drsai_agent.py`` example so the CLI can
spin up a ``DrSaiAssistant`` without relying on files outside the package.

Secrets and endpoints follow the env-first, config-fallback pattern:
    env var  >  cli_config.json value  >  built-in default
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import replace
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv

from drsai.backend.cli.config import load_config, save_config
from drsai.backend.prompt_registry import (
    PLAN_MODE_SYSTEM_PROMPT,
    SURFACE_CLI,
    build_base_system_message,
)
from drsai.backend.runtime.agent_kernel import (
    AgentRunConfig,
    DEFAULT_MAX_MESSAGES,
    DEFAULT_SYSTEM_PROMPT,
    agent_kernel_identity,
    desktop_production_parity_manifest,
    normalize_kernel_host_port,
)
from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.config import load_user_config, migrate_legacy_model_config, resolve_model_config, resolve_model_ref
from drsai.config.defaults import DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_OPENAI_BASE_URL
from drsai.config.model_defaults import (
    DEFAULT_CONFIG_NAME,
    DEFAULT_LLM_MODE_CONFIG,
    DISPLAY_NAME_OVERRIDES,
    ModelEntry,
    ReasoningConfig,
    _DEFAULT_RAGFLOW_URL,
    _display_name_from_alias,
)
from drsai.config.schema import ResolvedModelConfig
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
from drsai.modules.components.model_client.gemini_client import GeminiNativeChatCompletionClient
from drsai.modules.components.skills import resolve_builtin_skills_dir
from drsai.modules.managers.database import DatabaseManager
from drsai.platform_auth import get_platform_auth

load_dotenv()

logger = logging.getLogger(__name__)


# ── Plan Mode Prompt ─────────────────────────────────────────────────────────
# Moved to drsai.backend.prompt_registry (single source of truth for prompt
# fragments) and re-imported above so existing callers keep working:
#     from drsai.backend.run_drsai_agent_factory import PLAN_MODE_SYSTEM_PROMPT

OPENDRSAI_ASSISTANT_NAME = "OpenDrSai"
OPENDRSAI_IDENTITY_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

# Endpoint defaults — imported from model_defaults.py (single source of truth).
# Kept as module-level aliases for backward compatibility within this file.

# ── Workspace ────────────────────────────────────────────────────────────────

WORKSPACE = Path(WORKSPACE_DIR)
DATASET = WORKSPACE / "drsai"
DATASET.mkdir(parents=True, exist_ok=True)
WORKDIR = Path(WORKSPACE_RUNS_DIR)

# Default path for llm_mode_config YAML (seed file)
DEFAULT_LLM_CONFIG_FILE = str(Path(CONFIG_DIR) / "llm_mode_config.yaml")


def normalize_provider_model_name(model: str, base_url: str) -> str:
    """Translate catalog model IDs to the format expected by the endpoint.

    IHEP AI 平台只识别纯模型名（不带 provider 前缀），例如 ``deepseek-v4-flash``
    而非 ``hepai/deepseek-v4-flash``。因此对于 ``ihep.ac.cn`` hostname，需要
    剥离所有已知 provider 前缀（hepai/, deepseek-ai/, openai/, ark/, aliyun/,
    zhipu/, google/）。对于 OpenAI 官方 gpt/o* 系列模型（纯名无前缀时），
    则需要补上 ``openai/`` 前缀以路由到正确的上游。
    """
    hostname = (urlparse(base_url).hostname or "").lower()
    if hostname == "api.openai.com" and model.startswith("openai/"):
        return model.split("/", 1)[1]
    if hostname.endswith("ihep.ac.cn"):
        # 1) 剥离所有 provider 前缀 → 纯模型名
        for prefix in (
            "hepai/", "deepseek-ai/", "openai/", "ark/",
            "aliyun/", "zhipu/", "google/",
        ):
            if model.startswith(prefix):
                return model.split("/", 1)[1]
        # 2) 对无前缀的 OpenAI gpt/o* 系列，补上 openai/ 前缀以正确路由
        if "/" not in model and model.startswith(("gpt-", "o1", "o3", "o4")):
            return f"openai/{model}"
    return model


def _model_timeout_seconds(cli_cfg: dict[str, Any]) -> float:
    raw = _resolve(
        cli_cfg,
        "openai_timeout_seconds",
        "OPENDRSAI_MODEL_TIMEOUT_SECONDS",
        default=90,
    )
    try:
        return min(300.0, max(10.0, float(raw)))
    except (TypeError, ValueError):
        return 90.0


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
        # Derive operations list from ModelEntry capabilities
        operations: list[str] = ["chat", "tool_calling"]
        if entry.reasoning.supported:
            operations.append("reasoning")

        # Derive reasoning_efforts from ReasoningConfig
        reasoning_efforts: list[str] = list(entry.reasoning.effort_levels) if entry.reasoning.supported else []

        models.append({
            "alias": alias,
            "display_name": _display_name_from_alias(alias),
            "client_type": client_type,
            "model": entry.model,
            "token_limit": entry.token_limit,
            "max_tokens": entry.max_tokens,
            "vision": entry.vision,
            # ── Reasoning & operations (aligned with runtime-models endpoint) ──
            "operations": operations,
            "reasoning_efforts": reasoning_efforts,
            "input_modalities": ("text", "image") if entry.vision else ("text",),
            "output_modalities": ("text",),
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


def _live_cli_config_path() -> Path:
    """Resolve ``cli_config.json`` from the current ``DRSAI_HOME`` (not import-time)."""
    from drsai.version import __appname__

    home = os.environ.get("DRSAI_HOME") or str(Path.home() / f".{__appname__}")
    return Path(home).expanduser() / "configs" / "cli_config.json"


def _overlay_live_gfs_config(cli_cfg: dict[str, Any]) -> dict[str, Any]:
    """Keep Agent GFS tools aligned with the on-disk toggle.

    ``CLI_CONFIG_PATH`` is fixed at import time from ``DRSAI_HOME``. Desktop
    sets ``DRSAI_HOME`` before import in normal flows, but after toggle on/off
    we still re-read the live home file so enable/disable cannot drift from a
    stale in-memory merge or a mismatched import-time path.
    """
    path = _live_cli_config_path()
    if not path.is_file():
        # Live home has no config file: treat GFS as cleared.
        if "gfs" in cli_cfg:
            return {key: value for key, value in cli_cfg.items() if key != "gfs"}
        return cli_cfg
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to re-read live cli_config for GFS (%s): %s", path, exc)
        return cli_cfg
    if not isinstance(saved, dict):
        return cli_cfg
    merged = dict(cli_cfg)
    if "gfs" in saved:
        merged["gfs"] = saved["gfs"]
    else:
        merged.pop("gfs", None)
    return merged


def _build_cwd_prompt(cli_cfg: dict[str, Any], work_dir: str = "") -> str:
    """Compose the developer message handed to ``DrSaiAssistant``.

    Thin wrapper over :func:`drsai.backend.prompt_registry.build_base_system_message`
    kept for the historical private name.  The wording, the layer order and the
    injected system prompt all come from the registry now -- this function owns
    no prompt text of its own.
    """
    return build_base_system_message(
        surface=SURFACE_CLI,
        cli_cfg=cli_cfg,
        work_dir=work_dir,
    )


def _build_gfs_tools(
    user_id: str | None,
    cli_cfg: dict[str, Any] | None = None,
) -> list:
    """根据 ``cli_cfg["gfs"]`` 配置生成 GFS personal-mode 工具列表。

    **唯一配置来源是 ``cli_cfg["gfs"]``**（即 ``cli_config.json`` 中用户通过
    TUI ``/gfs`` 或 Desktop 云盘保存写入的值）。不读取 ``os.environ``，不回退 ``.env``。

    若 ``cli_cfg`` 无 ``gfs`` 配置、``enabled`` 为 false、或验证不完整，
    返回空列表——不加载任何 GFS 工具，不浪费 agent 上下文。

    失败时仅记日志，不抛异常，避免影响 agent 创建。
    """
    if not cli_cfg:
        return []

    gfs_cfg = cli_cfg.get("gfs")
    if not isinstance(gfs_cfg, dict) or not gfs_cfg:
        return []

    # ── 仅从用户配置读取 ──
    enabled = _as_bool(gfs_cfg.get("enabled"), default=False)
    if not enabled:
        return []

    ak = gfs_cfg.get("access_key") or ""
    sk = gfs_cfg.get("secret_key") or ""
    bucket = gfs_cfg.get("bucket") or ""
    if not (ak and sk and bucket):
        logger.warning(
            "GFS enabled in config but personal credentials incomplete "
            "(need access_key, secret_key, bucket). Skipping GFS tools."
        )
        return []

    email = gfs_cfg.get("email") or user_id or "personal@local"
    s3_endpoint = gfs_cfg.get("s3_endpoint") or "https://fgws3-gfs.ihep.ac.cn"

    try:
        from drsai.modules.managers.gfs import make_gfs_tools_personal
        from drsai.modules.managers.gfs.admin_client import GfsCredential
        from drsai.modules.managers.gfs.user_client import GfsUserClient

        # 直接从用户配置构造凭证 + client，完全绕过 os.environ
        cred = GfsCredential(
            access_key=ak,
            secret_key=sk,
            bucket=bucket,
            s3_endpoint=s3_endpoint,
            email=email,
            owner_id="",
            expiration=-1,
            status="active",
            resources=[],
        )
        client = GfsUserClient(cred)
        tools = make_gfs_tools_personal(client=client)
        logger.info(
            "GFS personal mode enabled: %s tools registered (user=%s, bucket=%s)",
            len(tools), email, bucket,
        )
        return tools
    except ImportError as e:
        logger.warning("GFS module import failed: %s", e)
        return []
    except Exception as e:
        logger.warning(
            "GFS tool init failed (personal, user=%s): %s. Falling back to no GFS.",
            user_id, e,
        )
        return []


def create_agent(
    api_key: Optional[str] = None,
    thread_id: Optional[str] = None,
    user_id: Optional[str] = None,
    db_manager: Optional[DatabaseManager] = None,
    defult_config_name: Optional[str] = None,
    model_provider: Optional[str] = None,
    model_id: Optional[str] = None,
    cli_cfg: Optional[dict[str, Any]] = None,
    assistant_cls: type[DrSaiAssistant] = DrSaiCLIAssistant,
    work_dir: Optional[str] = None,
    # ── New params (design-20260623 §6.2) ──
    sub_agent_config: Optional[dict] = None,
    extra_tools: Optional[list] = None,
    enable_security: bool = False,
    kernel_surface: str = "desktop",
    tool_resource_ids: Optional[list[str]] = None,
    tool_policy_revision: Optional[str] = None,
    skill_policy_mode: str = "inherit",
    skill_resource_ids: Optional[list[str]] = None,
    disabled_skill_ids: Optional[list[str]] = None,
    allow_thread_skill_override: bool = True,
    skill_policy_revision: Optional[str] = None,
) -> DrSaiAssistant:
    """Build a local OpenDrSai assistant from CLI config.

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
    cli_cfg = _overlay_live_gfs_config(cli_cfg or load_config())

    # LLM catalog: env > cli_cfg > built-in default.
    llm_config_path = _resolve(cli_cfg, "llm_config_file", "LLM_CONFIG_FILE") or None
    llm_mode_config = load_llm_mode_config(llm_config_path)

    # The compact TOML model configuration is opt-in during the compatibility
    # window.  A config.toml that only contains the existing platform tables
    # must not change legacy model routing.
    user_model_config = load_user_config()
    if not (
        user_model_config.model
        or user_model_config.model_provider
        or user_model_config.providers
    ):
        migration = migrate_legacy_model_config(environ=os.environ)
        if migration.migrated:
            logger.info(
                "Migrated legacy model selection to config.toml (model=%s, provider=%s)",
                migration.model,
                migration.provider,
            )
            user_model_config = load_user_config()
    unified_model_config_active = bool(
        user_model_config.model
        or user_model_config.model_provider
        or user_model_config.providers
    )
    resolved_user_model: ResolvedModelConfig | None = None
    if unified_model_config_active:
        compatibility_environ = dict(os.environ)
        # Use the same provider precedence as resolve_model_config().  The
        # desktop runtime supplies an explicit external provider through the
        # request/environment even when config.toml has no global
        # model_provider selection.  Previously this check defaulted to hepai,
        # made credentials optional under OIDC, then the resolver selected the
        # external provider and constructed it with an empty API key.
        selected_provider = (
            model_provider
            or os.environ.get("DRSAI_MODEL_PROVIDER")
            or user_model_config.model_provider
            or "hepai"
        )
        if selected_provider in {"hepai", "hepai-anthropic"}:
            compatibility_environ.setdefault(
                "HEPAI_API_KEY",
                str(cli_cfg.get("api_key") or api_key or ""),
            )
        elif selected_provider == "legacy-openai":
            compatibility_environ.setdefault(
                "OPENAI_API_KEY",
                str(cli_cfg.get("openai_api_key") or api_key or ""),
            )
        elif selected_provider == "legacy-anthropic":
            compatibility_environ.setdefault(
                "ANTHROPIC_API_KEY",
                str(cli_cfg.get("anthropic_api_key") or api_key or ""),
            )
        requested_provider = selected_provider
        require_static_credentials = not (
            requested_provider in {"hepai", "hepai-anthropic"}
            and get_platform_auth() is not None
        )
        resolved_user_model = (
            resolve_model_ref(
                user_model_config,
                environ=compatibility_environ,
                provider_id=model_provider,
                model_id=model_id or defult_config_name or "",
                require_credentials=require_static_credentials,
            )
            if model_provider
            else resolve_model_config(
                user_model_config,
                environ=compatibility_environ,
                model=defult_config_name,
                require_credentials=require_static_credentials,
            )
        )
        capabilities = resolved_user_model.capabilities
        llm_mode_config[resolved_user_model.model] = ModelEntry(
            model=resolved_user_model.model,
            token_limit=capabilities.token_limit,
            max_tokens=capabilities.max_tokens,
            client_type=resolved_user_model.provider.wire_api,
            reasoning=ReasoningConfig(
                supported=capabilities.reasoning.supported,
                effort_levels=list(capabilities.reasoning.effort_levels),
                param_type=capabilities.reasoning.param_type,
            ),
            vision=capabilities.vision,
            # TOML/Provider declaration wins over any stale YAML metadata.
            use_responses_api=capabilities.use_responses_api,
        )

    # Default alias: explicit arg > env var > cli_cfg > module default.
    # When provider/model_id are supplied, resolve_model_ref above produces the
    # canonical upstream model and it must remain authoritative below.
    env_alias = os.environ.get("LLM_DEFAULT_ALIAS")
    resolved_config_name = (
        resolved_user_model.model_id
        if resolved_user_model is not None and resolved_user_model.model_id in llm_mode_config
        else resolved_user_model.model
        if resolved_user_model is not None
        else (
            defult_config_name
            or env_alias
            or cli_cfg.get("defult_config_name")
            or DEFAULT_CONFIG_NAME
        )
    )
    if resolved_config_name not in llm_mode_config:
        resolved_config_name = next(
            (alias for alias, entry in llm_mode_config.items() if entry.model == resolved_config_name),
            next(iter(llm_mode_config)),
        )

    anthropic_base_url = _resolve(
        cli_cfg, "anthropic_base_url", "ANTHROPIC_BASE_URL",
        default=DEFAULT_ANTHROPIC_BASE_URL,
    )
    anthropic_api_key = _resolve(
        cli_cfg, "anthropic_api_key", "ANTHROPIC_API_KEY", "HEPAI_API_KEY",
    ) or api_key

    openai_base_url = _resolve(
        cli_cfg, "openai_base_url", "OPENAI_BASE_URL",
        default=DEFAULT_OPENAI_BASE_URL,
    )
    openai_api_key = _resolve(
        cli_cfg, "openai_api_key", "OPENAI_API_KEY", "HEPAI_API_KEY",
    ) or api_key
    if resolved_user_model is not None:
        provider_secret = resolved_user_model.provider.api_key
        provider_api_key = provider_secret.reveal() if provider_secret is not None else ""
        if resolved_user_model.provider.wire_api == "anthropic":
            anthropic_base_url = resolved_user_model.provider.base_url
            anthropic_api_key = provider_api_key
        else:
            openai_base_url = resolved_user_model.provider.base_url
            openai_api_key = provider_api_key
    openai_timeout = _model_timeout_seconds(cli_cfg)

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

    configured_skills_dir = _resolve(cli_cfg, "skills_dir", "SYSTEM_SKILLS_DIR") or None
    builtin_skills_dir = resolve_builtin_skills_dir(
        configured_skills_dir,
        search_from=(Path(__file__), Path.cwd()),
    )
    skills_dir = str(builtin_skills_dir) if builtin_skills_dir is not None else None
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

    # OpenAI new-series models (gpt-5.x, gpt-6.x, gpt-4.1, o1/o3/o4) reject 'max_tokens',
    # they require 'max_completion_tokens' instead.  Third-party OpenAI-compatible
    # APIs (DeepSeek, GLM, etc.) only accept 'max_tokens'.
    _OPENAI_NEW_MODEL_PREFIXES = ("gpt-5", "gpt-6", "gpt-4.1", "o1", "o3", "o4")

    def set_model_client(
        name: Optional[str] = resolved_config_name,
    ) -> HepAIAnthropicChatCompletionClient | HepAIChatCompletionClient | GeminiNativeChatCompletionClient:
        alias = name or resolved_config_name
        active_user_model = resolved_user_model
        if unified_model_config_active:
            # Reload on every switch so edits made by the Gateway, TUI, or another
            # process take effect for an already-running session.  The file is
            # deliberately tiny, so avoiding a stale provider/base URL is more
            # valuable than caching the parsed TOML here.
            current_user_model_config = load_user_config()
            active_user_model = (
                resolve_model_ref(
                    current_user_model_config,
                    environ=compatibility_environ,
                    provider_id=model_provider,
                    model_id=model_id or alias,
                    require_credentials=require_static_credentials,
                )
                if model_provider
                else resolve_model_config(
                    current_user_model_config,
                    environ=compatibility_environ,
                    model=alias,
                    require_credentials=require_static_credentials,
                )
            )
            active_capabilities = active_user_model.capabilities
            # Prefer yaml entry for model metadata (token_limit, max_tokens,
            # vision, reasoning) when available; fall back to config.toml
            # capabilities for unknown models. The wire transport is the one
            # exception: a config.toml/Provider declaration always wins, since
            # the YAML catalog cannot know a user's endpoint.
            yaml_entry = llm_mode_config.get(alias) or llm_mode_config.get(active_user_model.model)
            if yaml_entry is not None:
                entry = yaml_entry
                if active_capabilities.use_responses_api is not None:
                    entry = replace(entry, use_responses_api=active_capabilities.use_responses_api)
            else:
                entry = ModelEntry(
                    model=active_user_model.model,
                    token_limit=active_capabilities.token_limit,
                    max_tokens=active_capabilities.max_tokens,
                    client_type=active_user_model.provider.wire_api,
                    reasoning=ReasoningConfig(
                        supported=active_capabilities.reasoning.supported,
                        effort_levels=list(active_capabilities.reasoning.effort_levels),
                        param_type=active_capabilities.reasoning.param_type,
                    ),
                    vision=active_capabilities.vision,
                    use_responses_api=active_capabilities.use_responses_api,
                )
        else:
            entry = llm_mode_config.get(alias)
            if entry is None:
                entry = llm_mode_config[resolved_config_name]
        # In Unified TOML mode, the Resolver's model/upstream_id is the
        # authoritative wire model.  DEFAULT_LLM_MODE_CONFIG supplies
        # metadata only; using entry.model here would silently replace a TOML
        # selection with the legacy built-in model (for example v4-flash).
        llm_model = (
            active_user_model.model
            if unified_model_config_active and active_user_model is not None
            else entry.model
        )
        logger.info(
            "Resolved model client: requested_provider=%s requested_model_id=%s "
            "config_alias=%s upstream_model=%s metadata_alias=%s",
            model_provider,
            model_id,
            alias,
            llm_model,
            entry.model,
        )
        token_limit = entry.token_limit
        max_tokens = entry.max_tokens if entry.max_tokens > 0 else int(token_limit * 0.25)
        client_type = entry.client_type
        reasoning_config = entry.reasoning

        # ── Determine client_type ──
        # Priority: platform_auth > yaml entry (explicit) > config.toml provider > model-name heuristic
        platform_auth = get_platform_auth()
        is_hepai_provider = (
            active_user_model is None
            or active_user_model.provider.name in {"hepai", "hepai-anthropic"}
        )
        if platform_auth is not None and is_hepai_provider:
            # OIDC is authoritative only for the HepAI provider. An active
            # desktop session must not change a third-party provider's wire
            # protocol or credentials.
            client_type = "anthropic" if llm_model.casefold().startswith("anthropic/") else "openai"
        elif entry.client_type in ("openai", "anthropic", "gemini"):
            # yaml entry is authoritative when explicitly set (not "auto")
            client_type = entry.client_type
        elif active_user_model is not None:
            client_type = active_user_model.provider.wire_api
        elif client_type == "auto":
            if "claude" in llm_model or "anthropic" in llm_model or "minimax" in llm_model:
                client_type = "anthropic"
            else:
                client_type = "openai"

        # Handle "minimax" specially - use anthropic client with HepAI endpoint
        if active_user_model is None and "minimax" in llm_model:
            client_type = "anthropic"

        # ── Resolve connection info ──
        # Priority: ModelEntry (yaml) > active_user_model (config.toml) > cli_config.json defaults
        if client_type == "anthropic":
            default_base_url = anthropic_base_url
            default_api_key = anthropic_api_key
        else:
            default_base_url = openai_base_url
            default_api_key = openai_api_key

        if entry.base_url:
            active_base_url = entry.base_url
        elif active_user_model is not None:
            active_base_url = active_user_model.provider.base_url
        else:
            active_base_url = default_base_url

        if entry.api_key:
            active_api_key = entry.api_key
        elif entry.api_key_env:
            active_api_key = os.environ.get(entry.api_key_env, "")
        elif active_user_model is not None and active_user_model.provider.api_key is not None:
            active_api_key = active_user_model.provider.api_key.reveal()
        else:
            active_api_key = default_api_key

        provider_model = normalize_provider_model_name(llm_model, active_base_url)

        if client_type == "gemini":
            _gemini_allow_deferred_oidc = bool(
                active_user_model is None
                or active_user_model.provider.name in {"hepai", "hepai-anthropic"}
            )
            return GeminiNativeChatCompletionClient(
                model=llm_model,
                base_url=active_base_url,
                api_key=active_api_key,
                max_tokens=max_tokens,
                timeout=openai_timeout,
                vision=entry.vision,
                allow_deferred_oidc=_gemini_allow_deferred_oidc,
            )

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
                base_url=active_base_url,
                api_key=active_api_key,
                model_info=model_info,
                max_tokens=max_tokens,
                allow_deferred_oidc=bool(
                    active_user_model is None
                    or active_user_model.provider.name in {"hepai", "hepai-anthropic"}
                ),
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
        #   - OpenAI new-series (gpt-5.x, gpt-4.1, o1/o3/o4) 鈫?max_completion_tokens
        #   - All other OpenAI-compatible models (DeepSeek, GLM, etc.) 鈫?max_tokens
        model_suffix = provider_model.split("/", 1)[1] if provider_model.startswith("openai/") else provider_model
        needs_max_completion = any(
            model_suffix.startswith(prefix) for prefix in _OPENAI_NEW_MODEL_PREFIXES
        )
        # Wire transport for OpenAI-protocol models. Precedence:
        #   1. the model's own declaration (config.toml `models.<id>`, or a YAML
        #      catalog entry) — `entry.use_responses_api`;
        #   2. the Provider-wide default (resolved into the same field);
        #   3. model-name inference — new-series OpenAI models need the
        #      Responses API, everyone else stays on Chat Completions.
        # The client still falls back to Chat Completions automatically on a
        # clean endpoint-level rejection (404/405/501) before any output.
        if client_type != "openai":
            use_responses_api = False
        elif entry.use_responses_api is not None:
            use_responses_api = entry.use_responses_api
        else:
            use_responses_api = needs_max_completion
        allow_deferred_oidc = bool(
            active_user_model is None
            or active_user_model.provider.name in {"hepai", "hepai-anthropic"}
        )

        if needs_max_completion:
            return HepAIChatCompletionClient(
                model=provider_model,
                api_key=active_api_key,
                base_url=active_base_url,
                model_info=model_info,
                max_completion_tokens=max_tokens,
                timeout=openai_timeout,
                use_responses_api=use_responses_api,
                allow_deferred_oidc=allow_deferred_oidc,
            )
        else:
            return HepAIChatCompletionClient(
                model=provider_model,
                api_key=active_api_key,
                base_url=active_base_url,
                model_info=model_info,
                max_tokens=max_tokens,
                timeout=openai_timeout,
                use_responses_api=use_responses_api,
                allow_deferred_oidc=allow_deferred_oidc,
            )

    entry = llm_mode_config.get(resolved_config_name)
    if entry is None:
        entry = next(iter(llm_mode_config.values()))
    token_limit = entry.token_limit
    reserved_output_tokens = entry.max_tokens if entry.max_tokens > 0 else int(token_limit * 0.25)

    cwd_prompt = _build_cwd_prompt(cli_cfg, work_dir=cwd)

    # ── Security mode (design-20260623 §6.2) ──
    # enable_security=False: CLI/Desktop mode (personal use, all tools open)
    # enable_security=True:  server mode (permission tiers + Skill elevation)
    if enable_security:
        allow_basic_tools = ["read"]  # user: read-only (Skill elevation adds more)
        only_in_workspace_sec = True
        allow_dangerous = False
    else:
        allow_basic_tools = None           # CLI/Desktop: full access
        # Desktop app defaults: workspace unrestricted and dangerous commands
        # allowed unless the user explicitly restricts them via CLI config.
        # This matches the OpenDrSai desktop's personal-use contract — the
        # user already has full system access on their own machine, so
        # sandboxing /workspace and blocking /dangerous would only prevent
        # the agent from doing useful work without adding real security.
        only_in_workspace_sec = cli_cfg.get("workspace_enabled", False)
        allow_dangerous = cli_cfg.get("dangerous_allowed", True)

    # ── Merge extra_tools with GFS tools ──
    gfs_tools = _build_gfs_tools(user_id, cli_cfg=cli_cfg)
    if gfs_tools:
        final_tools = list(extra_tools or []) + gfs_tools
        # logger.info(
        #     "Attaching %s GFS tools for user=%s (cli_config gfs.enabled=%s)",
        #     len(gfs_tools),
        #     user_id,
        #     (cli_cfg.get("gfs") or {}).get("enabled") if isinstance(cli_cfg.get("gfs"), dict) else None,
        # )
    else:
        final_tools = list(extra_tools) if extra_tools else None
        gfs_block = cli_cfg.get("gfs") if isinstance(cli_cfg.get("gfs"), dict) else None
        # logger.info(
        #     "No GFS tools attached for user=%s (live_path=%s, has_gfs_block=%s, enabled=%s)",
        #     user_id,
        #     _live_cli_config_path(),
        #     gfs_block is not None,
        #     _as_bool((gfs_block or {}).get("enabled"), default=False) if gfs_block else False,
        # )

    # ── Sub-agent config ──
    final_sub_agent_config = sub_agent_config or {}

    kernel_identity = agent_kernel_identity(surface="desktop")
    desktop_host_capabilities = [
        "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
        "web_search", "web_fetch", "network.public_https", "image_generation", "image_edit",
    ]
    kernel_host_port = normalize_kernel_host_port({
        "schema_version": 1,
        "protocol_version": "p9-host-port-v1",
        "surface": "desktop",
        "capabilities": [
            {"id": capability, "version": 1, "required": capability == "chat"}
            for capability in desktop_host_capabilities
        ],
    }, surface="desktop")
    shared_agent_kernel = create_agent_kernel(surface=kernel_surface)
    assistant = assistant_cls(
        name=OPENDRSAI_ASSISTANT_NAME,
        model_client=set_model_client(resolved_config_name),
        system_message=cwd_prompt,
        reflect_on_tool_use=False,
        model_client_stream=True,
        thread_id=thread_id,
        db_manager=db_manager,
        metadata={
            "agent_kernel_id": str(kernel_identity["kernel_id"]),
            "agent_kernel_version": str(kernel_identity["kernel_version"]),
            "agent_prompt_version": str(kernel_identity["prompt_version"]),
            "agent_base_prompt_sha256": str(kernel_identity["base_prompt_sha256"]),
            "agent_kernel_sha256": str(kernel_identity["kernel_sha256"]),
            "agent_capability_manifest_version": str(kernel_identity["capability_manifest_version"]),
            "agent_capability_manifest_sha256": str(kernel_identity["capability_manifest_sha256"]),
            "agent_tool_manifest_version": str(kernel_identity["tool_manifest_version"]),
            "agent_model_tool_snapshot_version": str(kernel_identity["model_tool_snapshot_version"]),
            "kernel_host_port_protocol_version": str(kernel_host_port["protocol_version"]),
            "kernel_host_port_sha256": str(kernel_host_port["sha256"]),
        },
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
        allolow_basic_tools=allow_basic_tools,  # CLI: None (full); server: ["read"]
        tools=final_tools,                # Extra tools (MCP, knowledge, GFS, etc.)
        sub_agent_config=final_sub_agent_config,
        max_agent_concurrent=cli_cfg.get("max_agent_concurrent", 5),
        # Tool-loop ceilings: optional, from cli_cfg. Omit when absent so the
        # assistant defaults (desktop-oriented constants) apply.
        **({
            "max_tool_rounds_ceiling": cli_cfg["max_tool_rounds_ceiling"],
        } if "max_tool_rounds_ceiling" in cli_cfg else {}),
        **({
            "max_parallel_tool_calls_ceiling": cli_cfg["max_parallel_tool_calls_ceiling"],
        } if "max_parallel_tool_calls_ceiling" in cli_cfg else {}),
        **({
            "max_inline_tool_output_chars": cli_cfg["max_inline_tool_output_chars"],
        } if "max_inline_tool_output_chars" in cli_cfg else {}),
        token_limit=int(token_limit * 0.7),
        rag_flow_url=rag_flow_url,
        rag_flow_token=rag_flow_token,
        memory_dataset_id=memory_dataset_id,
        context_type=context_type,  # "ragflow" or "sqlite", from env DRSAI_CONTEXT_TYPE
        tool_resource_ids=tool_resource_ids,
        tool_policy_revision=tool_policy_revision,
        skill_policy_mode=skill_policy_mode,
        skill_resource_ids=skill_resource_ids,
        disabled_skill_ids=disabled_skill_ids,
        allow_thread_skill_override=allow_thread_skill_override,
        skill_policy_revision=skill_policy_revision,
    )
    exporter = getattr(assistant, "export_production_parity_manifest", None)
    parity_manifest = exporter() if callable(exporter) else desktop_production_parity_manifest(assistant)
    # ARCHIVED(2026-09-02): Desktop reuses the TUI legacy path. kernel_surface
    # is now effectively "tui" for the Desktop gateway (see
    # desktop_gateway/_agent_manager.py), so `_shared_agent_kernel` is None and
    # DrSaiAssistant.run_stream() uses its own tool loop, handling Delegate /
    # subagents directly. The backend/runtime desktop-kernel middle layer is
    # archived and never executes for Desktop.
    tui_legacy_path = kernel_surface == "tui"
    effective_shared_kernel = None if tui_legacy_path else shared_agent_kernel
    if isinstance(assistant, dict):
        assistant["_production_parity_manifest"] = parity_manifest
        assistant["_shared_agent_kernel"] = effective_shared_kernel
    else:
        assistant._kernel_host_port = kernel_host_port
        assistant._p9_context_budget = {
            "policy_version": "p9-context-budget-v1",
            "context_window_tokens": int(token_limit),
                "reserved_output_tokens": max(1, min(int(reserved_output_tokens), int(token_limit) - 1)),
            "max_messages": DEFAULT_MAX_MESSAGES,
                "summary_tokens": min(1_024, max(0, (int(token_limit) - int(reserved_output_tokens)) // 8)),
        }
        assistant._production_parity_manifest = parity_manifest
        assistant._shared_agent_kernel = effective_shared_kernel
    return assistant
