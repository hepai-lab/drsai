"""Factory module for building a local DrSaiAssistant for drsai-cli.

Ported from the project-root ``run_drsai_agent.py`` example so the CLI can
spin up a ``DrSaiAssistant`` without relying on files outside the package.

Secrets and endpoints follow the env-first, config-fallback pattern:
    env var  >  cli_config.json value  >  built-in default
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

from drsai.configs.constant import FS_DIR
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


# ── Workspace ────────────────────────────────────────────────────────────────

WORKSPACE = Path(FS_DIR) / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
DATASET = WORKSPACE / "drsai"
DATASET.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKSPACE / "runs"
WORKDIR.mkdir(parents=True, exist_ok=True)


# ── Default LLM catalog ──────────────────────────────────────────────────────

DEFAULT_LLM_MODE_CONFIG: dict[str, tuple[str, int]] = {
    "hepai/minimax-m2.7": ("hepai/minimax-m2.7", 204000),
    "hepai/minimax-m2.7-highspeed": ("hepai/minimax-m2.7-highspeed", 204000),
    "minimax-m2.5": ("minimax/minimax-m2.5", 204000),
    "minimax-m2.5-highspeed": ("minimax/minimax-m2.5-highspeed", 204000),
    "minimax-m2.7": ("minimax/minimax-m2.7", 204000),
    "minimax-m2.7-highspeed": ("minimax/minimax-m2.7-highspeed", 204000),
    "claude-sonnet-4-6": ("anthropic/claude-sonnet-4-6", 200000),
    "claude-haiku-4-5": ("anthropic/claude-haiku-4-5", 200000),
    "claude-opus-4-6": ("anthropic/claude-opus-4-6", 200000),
    "gpt-4o": ("openai/gpt-4o", 128000),
    "gpt-4.1": ("openai/gpt-4.1", 1000000),
    "gpt-5.2": ("openai/gpt-5.2", 1000000),
    "gpt-5.4": ("openai/gpt-5.4", 1000000),
    "deepseek-r1(No image)": ("deepseek-ai/deepseek-r1", 128000),
    "deepseek-v3.2(No image)": ("deepseek-ai/deepseek-v3.2", 128000),
}

DEFAULT_CONFIG_NAME = "hepai/minimax-m2.7-highspeed"

# Endpoint defaults — match run_drsai_agent.py
_DEFAULT_ANTHROPIC_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2/anthropic"
_DEFAULT_OPENAI_BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"
_DEFAULT_RAGFLOW_URL = "https://ragflow.ihep.ac.cn"


def load_llm_mode_config(path: Optional[str]) -> dict[str, tuple[str, int]]:
    """Load an external model catalog from YAML or JSON.

    Expected shape::

        alias: [model_id, token_limit]

    If ``path`` is falsy or missing, returns ``DEFAULT_LLM_MODE_CONFIG``.
    JSON stores tuples as 2-element lists — coerce back to tuples on load.
    """
    if not path:
        return DEFAULT_LLM_MODE_CONFIG

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

    out: dict[str, tuple[str, int]] = {}
    for alias, val in raw.items():
        if not (isinstance(val, (list, tuple)) and len(val) == 2):
            raise ValueError(
                f"Entry {alias!r} must be a [model_id, token_limit] pair, got {val!r}"
            )
        model_id, token_limit = val
        out[str(alias)] = (str(model_id), int(token_limit))
    return out


def _resolve(cli_cfg: dict[str, Any], cfg_key: str, *env_keys: str, default: str = "") -> str:
    """Resolve a config value. Env wins, then cli_cfg, then default."""
    for env_key in env_keys:
        v = os.environ.get(env_key)
        if v:
            return v
    v = cli_cfg.get(cfg_key)
    if v:
        return str(v)
    return default


def _build_cwd_prompt(cli_cfg: dict[str, Any]) -> str:
    """Compose a small system-prompt prefix that tells the agent the user's
    current working directory.

    The CLI injects this each time a session starts so the agent can
    resolve relative paths and skill searches against the user's project.
    An explicit ``cli_cfg['system_message']`` or env ``DRSAI_SYSTEM_MESSAGE``
    is appended on top for user-supplied context.
    """
    try:
        cwd = os.getcwd()
    except Exception:
        cwd = ""
    lines: list[str] = []
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
    defult_config_name: Optional[str] = DEFAULT_CONFIG_NAME,
    cli_cfg: Optional[dict[str, Any]] = None,
    assistant_cls: type[DrSaiAssistant] = DrSaiCLIAssistant,
) -> DrSaiAssistant:
    """Build a local DrSai assistant from CLI config.

    Args:
        api_key: legacy HEPAI key (backward-compatible). Used only as a
            last-resort fallback for either provider branch.
        thread_id, user_id, db_manager: wired through to the assistant.
        defult_config_name: model alias within the loaded llm_mode_config.
        cli_cfg: merged CLI config dict (see cli/config.DEFAULT_CONFIG).
        assistant_cls: class to instantiate. Defaults to
            :class:`DrSaiCLIAssistant`; production callers (e.g. the worker)
            should pass the plain :class:`DrSaiAssistant`.
    """
    cli_cfg = cli_cfg or {}

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
        cli_cfg, "anthropic_api_key", "ANTHROPIC_API_KEY",
    ) or api_key

    openai_base_url = _resolve(
        cli_cfg, "openai_base_url", "OPENAI_BASE_URL",
        default=_DEFAULT_OPENAI_BASE_URL,
    )
    openai_api_key = _resolve(
        cli_cfg, "openai_api_key", "OPENAI_API_KEY", "HEPAI_API_KEY",
    ) or api_key

    skills_dir = _resolve(cli_cfg, "skills_dir", "SYSTEM_SKILLS_DIR") or None
    rag_flow_url = _resolve(
        cli_cfg, "ragflow_url", "RAGFLOW_URL", default=_DEFAULT_RAGFLOW_URL,
    )
    rag_flow_token = _resolve(cli_cfg, "ragflow_token", "RAGFLOW_TOKEN") or None
    memory_dataset_id = _resolve(
        cli_cfg, "memory_dataset_id", "MEMORY_DATASET_ID",
    ) or None

    def set_model_client(
        name: Optional[str] = resolved_config_name,
    ) -> HepAIAnthropicChatCompletionClient | HepAIChatCompletionClient:
        alias = name or resolved_config_name
        entry = llm_mode_config.get(alias)
        if entry is None:
            entry = llm_mode_config[resolved_config_name]
        llm_model, token_limit = entry

        if ("claude" in llm_model) or ("minimax" in llm_model):
            model_info = dict(_MODEL_INFO["claude-sonnet-4-5"])
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            return HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url=anthropic_base_url,
                api_key=anthropic_api_key,
                model_info=model_info,
                max_tokens=int(token_limit * 0.25),
            )

        is_vision = "deepseek" not in llm_model
        return HepAIChatCompletionClient(
            model=llm_model,
            api_key=openai_api_key,
            base_url=openai_base_url,
            model_info={
                "vision": is_vision,
                "function_calling": True,
                "json_output": True,
                "structured_output": False,
                "family": ModelFamily.GPT_41,
                "multiple_system_messages": True,
                "token_model": "gpt-4o-2024-11-20",
            },
        )

    _, token_limit = llm_mode_config[resolved_config_name]

    cwd_prompt = _build_cwd_prompt(cli_cfg)

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
        is_powershell=False,
        skills_dir=skills_dir,
        work_dir=WORKDIR,
        only_system_message=False,
        only_in_workspace=False,
        allolow_dangrous_cmd=True,
        allolow_basic_tools=None,
        token_limit=int(token_limit * 0.7),
        rag_flow_url=rag_flow_url,
        rag_flow_token=rag_flow_token,
        memory_dataset_id=memory_dataset_id,
    )
