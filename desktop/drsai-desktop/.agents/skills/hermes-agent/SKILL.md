---
name: hermes-agent
description: Expert in building self-improving AI agents with tool use, multi-platform messaging, and a closed learning loop. Proficient in LLM orchestration, tool integration, session management, and agent autonomy.
---

# Hermes Agent - Complete Project Guide (A-Z)

> **Purpose of this document:** A single, comprehensive reference that explains everything about the Hermes Agent project — its architecture, source code, features, release history, and design patterns — so that any AI or developer can fully understand the system.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features Summary](#2-key-features-summary)
3. [Installation & Getting Started](#3-installation--getting-started)
4. [Project Structure](#4-project-structure)
5. [Core Architecture](#5-core-architecture)
   - 5.1 [AIAgent Class (run_agent.py)](#51-aiagent-class-run_agentpy)
   - 5.2 [Tool Orchestration (model_tools.py)](#52-tool-orchestration-model_toolspy)
   - 5.3 [Toolset System (toolsets.py)](#53-toolset-system-toolsetspy)
   - 5.4 [Tool Registry (tools/registry.py)](#54-tool-registry-toolsregistrypy)
   - 5.5 [Session Database (hermes_state.py)](#55-session-database-hermes_statepy)
   - 5.6 [Constants & Home Directory (hermes_constants.py)](#56-constants--home-directory-hermes_constantspy)
6. [CLI System](#6-cli-system)
   - 6.1 [Interactive CLI (cli.py)](#61-interactive-cli-clipy)
   - 6.2 [CLI Entry Point (hermes_cli/main.py)](#62-cli-entry-point-hermes_climainpy)
   - 6.3 [Configuration System (hermes_cli/config.py)](#63-configuration-system-hermes_cliconfigpy)
   - 6.4 [Slash Command Registry (hermes_cli/commands.py)](#64-slash-command-registry-hermes_clicommandspy)
   - 6.5 [Setup Wizard (hermes_cli/setup.py)](#65-setup-wizard-hermes_clisetupy)
   - 6.6 [Model Catalog (hermes_cli/models.py)](#66-model-catalog-hermes_climodelspy)
   - 6.7 [Skin/Theme Engine (hermes_cli/skin_engine.py)](#67-skintheme-engine-hermes_cliskin_enginepy)
7. [Tool System](#7-tool-system)
   - 7.1 [Terminal Tool (tools/terminal_tool.py)](#71-terminal-tool-toolsterminal_toolpy)
   - 7.2 [File Tools (tools/file_tools.py)](#72-file-tools-toolsfile_toolspy)
   - 7.3 [Web Tools (tools/web_tools.py)](#73-web-tools-toolsweb_toolspy)
   - 7.4 [Browser Tool (tools/browser_tool.py)](#74-browser-tool-toolsbrowser_toolpy)
   - 7.5 [Delegate Tool (tools/delegate_tool.py)](#75-delegate-tool-toolsdelegate_toolpy)
   - 7.6 [MCP Tool (tools/mcp_tool.py)](#76-mcp-tool-toolsmcp_toolpy)
   - 7.7 [Approval System (tools/approval.py)](#77-approval-system-toolsapprovalpy)
   - 7.8 [Terminal Backends (tools/environments/)](#78-terminal-backends-toolsenvironments)
8. [Agent Internals](#8-agent-internals)
   - 8.1 [Prompt Builder (agent/prompt_builder.py)](#81-prompt-builder-agentprompt_builderpy)
   - 8.2 [Context Compressor (agent/context_compressor.py)](#82-context-compressor-agentcontext_compressorpy)
   - 8.3 [Prompt Caching (agent/prompt_caching.py)](#83-prompt-caching-agentprompt_cachingpy)
   - 8.4 [Auxiliary Client (agent/auxiliary_client.py)](#84-auxiliary-client-agentauxiliary_clientpy)
   - 8.5 [Display & Spinner (agent/display.py)](#85-display--spinner-agentdisplaypy)
   - 8.6 [Skill Commands (agent/skill_commands.py)](#86-skill-commands-agentskill_commandspy)
9. [Messaging Gateway](#9-messaging-gateway)
   - 9.1 [GatewayRunner (gateway/run.py)](#91-gatewayrunner-gatewayrunpy)
   - 9.2 [Session Store (gateway/session.py)](#92-session-store-gatewaysessionpy)
   - 9.3 [Platform Adapters (gateway/platforms/)](#93-platform-adapters-gatewayplatforms)
10. [Cron Scheduling](#10-cron-scheduling)
11. [Skills System](#11-skills-system)
12. [Plugin System](#12-plugin-system)
13. [Memory System](#13-memory-system)
14. [ACP Server (IDE Integration)](#14-acp-server-ide-integration)
15. [API Server](#15-api-server)
16. [MCP Server Mode](#16-mcp-server-mode)
17. [RL Training Environments](#17-rl-training-environments)
18. [Profiles (Multi-Instance)](#18-profiles-multi-instance)
19. [Security Model](#19-security-model)
20. [Provider & Model System](#20-provider--model-system)
21. [Streaming & Reasoning](#21-streaming--reasoning)
22. [Release History](#22-release-history)
23. [File Dependency Chain](#23-file-dependency-chain)
24. [Key Design Patterns](#24-key-design-patterns)
25. [Configuration Reference](#25-configuration-reference)
26. [Known Pitfalls](#26-known-pitfalls)

---

## 1. Project Overview

**Hermes Agent** is a self-improving AI agent built by [Nous Research](https://nousresearch.com). It is an open-source (MIT licensed), Python-based project that provides:

- A **full interactive terminal UI** (CLI) for conversing with LLMs
- A **messaging gateway** supporting 16+ platforms (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Email, etc.)
- A **closed learning loop** — the agent creates skills from experience, improves them during use, nudges itself to persist knowledge, searches past conversations, and builds a deepening model of who you are
- **40+ built-in tools** — terminal execution, file manipulation, web search, browser automation, code execution, image generation, TTS/STT, and more
- **Any LLM provider** — OpenRouter (200+ models), Nous Portal (400+ models), OpenAI, Anthropic, Hugging Face, GitHub Copilot, z.ai/GLM, Kimi/Moonshot, MiniMax, Alibaba/DashScope, custom endpoints
- **Six terminal backends** — local, Docker, SSH, Modal (serverless), Daytona (serverless), Singularity (HPC)
- **Scheduled automations** via built-in cron scheduler
- **IDE integration** via ACP (Agent Communication Protocol) for VS Code, Zed, JetBrains
- **MCP integration** — both client (connect to any MCP server) and server (expose Hermes to MCP clients)
- **RL training** via Atropos environments for training the next generation of tool-calling models

**Tech Stack:**

- Python 3.11+ (core agent, tools, gateway, cron)
- Node.js (browser automation via agent-browser)
- SQLite with WAL mode and FTS5 (session storage, full-text search)
- OpenAI-compatible API (primary inference interface)
- Anthropic SDK (native Anthropic support)
- Rich + prompt_toolkit (CLI rendering)

**Repository:** `github.com/NousResearch/hermes-agent`
**Version:** 0.7.0 (as of April 2026)
**License:** MIT

---

## 2. Key Features Summary

| Feature                      | Description                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terminal UI**              | Full TUI with multiline editing, slash-command autocomplete, conversation history, interrupt-and-redirect, streaming tool output                                                 |
| **Multi-Platform Messaging** | Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Email, Home Assistant, DingTalk, Feishu/Lark, WeCom, Mattermost, SMS, Webhook — all from a single gateway process            |
| **Learning Loop**            | Agent-curated memory with periodic nudges, autonomous skill creation, skills self-improve during use, FTS5 session search with LLM summarization, Honcho dialectic user modeling |
| **Scheduled Tasks**          | Built-in cron scheduler with delivery to any platform (daily reports, nightly backups, weekly audits)                                                                            |
| **Subagent Delegation**      | Spawn isolated subagents for parallel workstreams with restricted toolsets                                                                                                       |
| **Execute Code**             | Python scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns                                                                             |
| **Terminal Backends**        | Local, Docker, SSH, Modal, Daytona, Singularity — run on a $5 VPS or a GPU cluster                                                                                               |
| **Skills**                   | 70+ bundled skills across 28 categories, Skills Hub for community discovery, agentskills.io compatibility                                                                        |
| **Plugins**                  | Drop-in Python plugins with lifecycle hooks (pre_llm_call, post_llm_call, on_session_start, on_session_end)                                                                      |
| **MCP**                      | Client (connect to MCP servers for extended tools) and Server (expose conversations to MCP clients)                                                                              |
| **IDE Integration**          | VS Code, Zed, JetBrains via ACP server with session management and tool streaming                                                                                                |
| **API Server**               | OpenAI-compatible `/v1/chat/completions` endpoint for headless integrations                                                                                                      |
| **Profiles**                 | Multi-instance support — each profile gets isolated config, memory, sessions, skills, gateway                                                                                    |
| **Security**                 | Command approval system, secret redaction, SSRF protection, PII redaction, injection detection, credential directory protection                                                  |
| **RL Training**              | Atropos environments for batch trajectory generation and agent policy optimization                                                                                               |

---

## 3. Installation & Getting Started

```bash
# One-line install (Linux, macOS, WSL2)
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# After install
source ~/.bashrc    # or: source ~/.zshrc
hermes              # start chatting

# Key commands
hermes model        # Choose LLM provider and model
hermes tools        # Configure which tools are enabled
hermes config set   # Set individual config values
hermes gateway      # Start the messaging gateway
hermes setup        # Run the full setup wizard
hermes update       # Update to latest version
hermes doctor       # Diagnose any issues
```

**For development:**

```bash
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv venv --python 3.11
source venv/bin/activate
uv pip install -e ".[all,dev]"
python -m pytest tests/ -q    # ~3000 tests
```

---

## 4. Project Structure

```
hermes-agent/
├── run_agent.py              # AIAgent class — core conversation loop
├── model_tools.py            # Tool orchestration, _discover_tools(), handle_function_call()
├── toolsets.py               # Toolset definitions, _HERMES_CORE_TOOLS list
├── toolset_distributions.py  # Toolset sampling distributions for RL
├── cli.py                    # HermesCLI class — interactive CLI orchestrator
├── hermes_state.py           # SessionDB — SQLite session store (FTS5 search)
├── hermes_constants.py       # Shared constants, get_hermes_home()
├── hermes_time.py            # Timezone handling
├── utils.py                  # Shared utility functions
├── batch_runner.py           # Parallel batch processing
├── trajectory_compressor.py  # Trajectory compression for RL training
├── mcp_serve.py              # MCP server mode entry point
├── mini_swe_runner.py        # Minimal SWE benchmark runner
├── rl_cli.py                 # RL CLI commands
│
├── agent/                    # Agent internals
│   ├── prompt_builder.py         # System prompt assembly
│   ├── context_compressor.py     # Auto context compression
│   ├── prompt_caching.py         # Anthropic prompt caching
│   ├── auxiliary_client.py       # Auxiliary LLM client (vision, summarization)
│   ├── model_metadata.py         # Model context lengths, token estimation
│   ├── models_dev.py             # models.dev registry integration
│   ├── display.py                # KawaiiSpinner, tool preview formatting
│   ├── skill_commands.py         # Skill slash commands (shared CLI/gateway)
│   └── trajectory.py             # Trajectory saving helpers
│
├── hermes_cli/               # CLI subcommands and setup
│   ├── main.py               # Entry point — all `hermes` subcommands
│   ├── config.py             # DEFAULT_CONFIG, OPTIONAL_ENV_VARS, migration
│   ├── commands.py           # Slash command definitions + SlashCommandCompleter
│   ├── callbacks.py          # Terminal callbacks (clarify, sudo, approval)
│   ├── setup.py              # Interactive setup wizard
│   ├── skin_engine.py        # Skin/theme engine
│   ├── skills_config.py      # `hermes skills` — skill management
│   ├── tools_config.py       # `hermes tools` — tool management
│   ├── skills_hub.py         # Skills Hub integration
│   ├── models.py             # Model catalog, provider model lists
│   ├── model_switch.py       # Shared /model switch pipeline
│   └── auth.py               # Provider credential resolution
│
├── tools/                    # Tool implementations (one file per tool)
│   ├── registry.py           # Central tool registry
│   ├── approval.py           # Dangerous command detection
│   ├── terminal_tool.py      # Terminal/shell execution
│   ├── process_registry.py   # Background process management
│   ├── file_tools.py         # File read/write/search/patch
│   ├── web_tools.py          # Web search/extract
│   ├── browser_tool.py       # Browser automation
│   ├── code_execution_tool.py # execute_code sandbox
│   ├── delegate_tool.py      # Subagent delegation
│   ├── mcp_tool.py           # MCP client integration
│   ├── skills_tool.py        # Skill management tool
│   ├── todo_tool.py          # Todo/task tracking tool
│   ├── memory_tool.py        # Memory read/write tool
│   ├── tts_tool.py           # Text-to-speech
│   ├── vision_tool.py        # Image analysis
│   ├── image_gen_tool.py     # Image generation
│   └── environments/         # Terminal backends
│       ├── base.py               # BaseEnvironment ABC
│       ├── local.py              # Local execution
│       ├── docker.py             # Docker containers
│       ├── ssh.py                # SSH remote execution
│       ├── modal.py              # Modal serverless
│       ├── managed_modal.py      # Nous-hosted Modal
│       ├── daytona.py            # Daytona serverless
│       ├── singularity.py        # Singularity HPC containers
│       └── persistent_shell.py   # Persistent shell mixin
│
├── gateway/                  # Messaging platform gateway
│   ├── run.py                # GatewayRunner — main message loop
│   ├── session.py            # SessionStore — conversation persistence
│   ├── status.py             # Gateway status, token locks
│   └── platforms/            # 16 platform adapters
│       ├── base.py               # BasePlatformAdapter ABC
│       ├── telegram.py           # Telegram (polling + webhook)
│       ├── discord.py            # Discord
│       ├── slack.py              # Slack
│       ├── whatsapp.py           # WhatsApp
│       ├── matrix.py             # Matrix (E2EE)
│       ├── signal.py             # Signal
│       ├── email.py              # Email (IMAP/SMTP)
│       ├── homeassistant.py      # Home Assistant
│       ├── sms.py                # SMS (Twilio)
│       ├── mattermost.py         # Mattermost
│       ├── dingtalk.py           # DingTalk
│       ├── feishu.py             # Feishu/Lark
│       ├── wecom.py              # WeCom (Enterprise WeChat)
│       ├── webhook.py            # Generic webhook
│       └── api_server.py         # OpenAI-compatible API server
│
├── acp_adapter/              # ACP server (IDE integration)
│   ├── server.py             # HermesACPAgent class
│   ├── session.py            # SessionManager
│   ├── events.py             # Streaming callbacks
│   ├── permissions.py        # Approval callbacks
│   └── entry.py              # Entry point
│
├── cron/                     # Scheduler
│   ├── scheduler.py          # tick() — job execution engine
│   └── jobs.py               # Job storage and CRUD
│
├── plugins/                  # Plugin system
│   └── memory/               # 8 memory provider plugins
│       ├── openviking/
│       ├── mem0/
│       ├── hindsight/
│       ├── holographic/
│       ├── honcho/
│       ├── retaindb/
│       └── byterover/
│
├── environments/             # RL training environments (Atropos)
│   ├── hermes_base_env.py    # Abstract base RL environment
│   ├── agent_loop.py         # HermesAgentLoop — rollout execution
│   ├── tool_context.py       # ToolContext — sandbox for RL
│   ├── web_research_env.py   # Web research tasks
│   └── agentic_opd_env.py    # Observation-Prediction-Demo env
│
├── skills/                   # 70+ bundled skills across 28 categories
├── optional-skills/          # Additional optional skills
├── tests/                    # ~3000 pytest tests
├── scripts/                  # Install, update, packaging scripts
├── docker/                   # Docker build files
├── docs/                     # Documentation source (Docusaurus)
├── website/                  # Landing page
├── desktop/                  # Desktop app (Electron, separate repo)
├── tinker-atropos/           # RL submodule
│
├── pyproject.toml            # Python package config
├── AGENTS.md                 # Developer guide for AI assistants
├── RELEASE_v0.2.0.md → v0.7.0.md  # Release notes
└── cli-config.yaml.example   # Example config
```

**User config directory:** `~/.hermes/`

```
~/.hermes/
├── config.yaml           # User settings
├── .env                  # API keys and secrets
├── MEMORY.md             # Persistent agent memory
├── USER.md               # User profile
├── SOUL.md               # Agent personality/identity
├── sessions.db           # SQLite session database
├── skills/               # User-installed skills
├── skins/                # Custom CLI themes
├── plugins/              # User plugins
├── cron/                 # Cron jobs and output
│   ├── jobs.json
│   └── output/
├── cache/                # Image/audio cache
├── plans/                # Generated plans
├── profiles/             # Multi-instance profiles
└── mcp/                  # MCP server configs
```

---

## 5. Core Architecture

### 5.1 AIAgent Class (run_agent.py)

The `AIAgent` class is the heart of the system — the core conversation loop that orchestrates LLM calls, tool execution, context management, and response delivery.

**Constructor (~60 parameters):**

```python
class AIAgent:
    def __init__(self,
        model: str = "anthropic/claude-opus-4.6",
        max_iterations: int = 90,
        enabled_toolsets: list = None,
        disabled_toolsets: list = None,
        quiet_mode: bool = False,
        save_trajectories: bool = False,
        platform: str = None,            # "cli", "telegram", etc.
        session_id: str = None,
        session_db: SessionDB = None,
        skip_context_files: bool = False,
        skip_memory: bool = False,
        base_url: str = None,
        api_key: str = None,
        provider: str = None,
        api_mode: str = "chat_completions",  # or "anthropic_messages" or "codex_responses"
        tool_progress_callback = None,
        stream_delta_callback = None,
        thinking_callback = None,
        status_callback = None,
        iteration_budget: IterationBudget = None,
        credential_pool = None,
        checkpoints_enabled: bool = False,
        # ... plus provider, routing, callback params
    )
```

**Main Methods:**

| Method                                                                          | Returns  | Purpose                                                                            |
| ------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `chat(message, stream_callback)`                                                | `str`    | Simple interface — returns final response text                                     |
| `run_conversation(user_message, system_message, conversation_history, task_id)` | `dict`   | Full interface — returns `{final_response, messages, completed, api_calls, error}` |
| `_interruptible_api_call(api_kwargs)`                                           | Response | Runs API request in background thread with interrupt support                       |
| `_interruptible_streaming_api_call(api_kwargs, on_first_delta)`                 | Response | Streaming variant with delta callbacks                                             |

**The Core Agent Loop** (inside `run_conversation()`):

```python
while api_call_count < self.max_iterations and self.iteration_budget.remaining > 0:
    response = client.chat.completions.create(
        model=model, messages=messages, tools=tool_schemas
    )
    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1
    else:
        return response.content  # Final text response
```

**Key Behaviors:**

- **Three API modes:** `chat_completions` (OpenAI-compatible), `anthropic_messages` (Anthropic SDK), `codex_responses` (OpenAI Codex)
- **Parallel tool execution:** Independent tool calls run concurrently via ThreadPoolExecutor (unless they share file paths or are in the never-parallel list)
- **Interrupt support:** Background threads allow interrupt detection without blocking on HTTP
- **Error recovery:** Automatic fallback chain (primary → fallback model), retry with exponential backoff, context compression on token overflow
- **Budget pressure:** Warnings at 70% (caution) and 90% (urgent) of iteration budget
- **Oversized results:** Tool results >100K chars are saved to temp files with a preview
- **Stale connection detection:** 90s timeout for streaming, 60s read timeout

**IterationBudget** (thread-safe):

```python
class IterationBudget:
    def consume() -> bool    # Check and consume one iteration
    def refund()             # Give back iteration (for execute_code turns)
    @property remaining      # Remaining iterations
```

---

### 5.2 Tool Orchestration (model_tools.py)

Bridges the agent and tool registry — handles discovery, schema generation, and dispatch.

**Key Functions:**

| Function                                                                                | Purpose                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `_discover_tools()`                                                                     | Imports all tool modules (each calls `registry.register()` on import)     |
| `get_tool_definitions(enabled_toolsets, disabled_toolsets, quiet_mode)`                 | Returns OpenAI-format tool schemas filtered by toolset                    |
| `handle_function_call(function_name, function_args, task_id, user_task, enabled_tools)` | Main dispatcher — routes calls to registry with arg coercion              |
| `coerce_tool_args(tool_name, args)`                                                     | Type coercion for LLM-generated arguments (string→int, string→bool, etc.) |

**Tool Discovery Order:**

1. Static tools (web_tools, terminal_tool, file_tools, browser_tool, etc.)
2. Optional tools (fal_client for image gen, honcho, etc.) — graceful fallback if missing
3. Plugin-registered tools
4. MCP server tools (dynamic, via tools/list_changed notifications)

**Special Tool Handling:**

- **Agent-level tools** (todo, memory, session_search, delegate_task): Intercepted by `run_agent.py` before `handle_function_call()`
- **execute_code**: Passes `enabled_tools` for sandbox tool list
- **Dynamic schema adjustments**: `browser_navigate` strips web_search reference if tools unavailable

**Async Bridging:**

- Persistent event loops (not `asyncio.run()`) to prevent "Event loop is closed" errors
- Main thread uses shared loop; worker threads get per-thread loops
- `_run_async()` detects running loop and spins up disposable thread if needed

---

### 5.3 Toolset System (toolsets.py)

Provides flexible tool grouping and composition.

**Core Toolsets:**

| Toolset          | Tools Included                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `web`            | web_search, web_extract, web_crawl                                                               |
| `terminal`       | terminal                                                                                         |
| `file`           | read_file, write_file, edit_file, list_files, search_files                                       |
| `browser`        | browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_extract |
| `vision`         | analyze_image                                                                                    |
| `image_gen`      | generate_image                                                                                   |
| `tts`            | text_to_speech                                                                                   |
| `todo`           | todo_read, todo_write                                                                            |
| `memory`         | memory_read, memory_write                                                                        |
| `session_search` | session_search                                                                                   |
| `delegation`     | delegate_task                                                                                    |
| `code_execution` | execute_code                                                                                     |
| `cronjob`        | create_job, list_jobs, delete_job                                                                |
| `messaging`      | send_message                                                                                     |
| `homeassistant`  | ha_get_states, ha_call_service, ...                                                              |

**Composite Toolsets:**

- `hermes-cli` — All core tools for CLI platform
- `hermes-telegram`, `hermes-discord`, etc. — Platform-specific tool sets
- `hermes-gateway` — Union of all platform tools
- `debugging` — terminal + file + web
- `safe` — Everything except terminal

**Resolution:**

```python
resolve_toolset(name, visited=None) → List[str]
# Recursively resolves toolset to tool names
# Handles composition (includes) and cycle detection
# Special aliases: "all" or "*" = all tools
```

---

### 5.4 Tool Registry (tools/registry.py)

Singleton managing all tool schemas and handlers. Circular-import safe — has no tool dependencies.

**ToolEntry** (per-tool metadata):

```python
@dataclass(slots=True)
class ToolEntry:
    name: str
    toolset: str
    schema: dict           # OpenAI-format tool definition
    handler: Callable      # Sync or async handler function
    check_fn: Callable     # Returns True if tool is available
    requires_env: list     # Required environment variables
    is_async: bool
    description: str
    emoji: str
```

**Key Methods:**

```python
registry.register(name, toolset, schema, handler, check_fn, requires_env)
registry.get_definitions(tool_names, quiet)  # Returns filtered schemas
registry.dispatch(name, args, **kwargs)      # Execute with async bridging
registry.deregister(name)                    # Remove (for MCP tool refresh)
registry.check_tool_availability()           # Returns (available, unavailable)
```

---

### 5.5 Session Database (hermes_state.py)

SQLite-based persistent session storage with FTS5 full-text search.

**Schema (v6):**

```sql
-- Sessions table
sessions (
    id TEXT PRIMARY KEY,
    source TEXT, user_id TEXT, model TEXT, model_config TEXT,
    system_prompt TEXT, parent_session_id TEXT,
    started_at TEXT, ended_at TEXT, end_reason TEXT,
    message_count INTEGER, tool_call_count INTEGER,
    input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
    estimated_cost_usd REAL, actual_cost_usd REAL,
    title TEXT  -- UNIQUE INDEX
)

-- Messages table
messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT, role TEXT, content TEXT,
    tool_call_id TEXT, tool_calls TEXT,  -- JSON
    tool_name TEXT, timestamp TEXT,
    token_count INTEGER, finish_reason TEXT,
    reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT
)

-- FTS5 virtual table (auto-synced via triggers)
messages_fts (content)
```

**Concurrency Model:**

- WAL (Write-Ahead Logging) for concurrent readers + single writer
- `BEGIN IMMEDIATE` for write transactions (lock at start, not commit)
- Jitter retry on lock: 20-150ms random backoff, max 15 retries
- Periodic WAL checkpoint every 50 writes

**Key Operations:**

- `create_session()`, `end_session()`, `reopen_session()`
- `add_message()`, `get_messages()`
- `search_sessions(query)` — FTS5 full-text search
- `update_token_counts()` — Supports both incremental (CLI) and absolute (gateway) modes

---

### 5.6 Constants & Home Directory (hermes_constants.py)

Import-safe constants module with no circular dependencies.

```python
get_hermes_home() → Path          # HERMES_HOME env var or ~/.hermes
display_hermes_home() → str       # User-friendly display: "~/.hermes"
get_optional_skills_dir() → Path  # HERMES_OPTIONAL_SKILLS env var
parse_reasoning_effort(str) → Dict  # "high" → {"enabled": True, "effort": "high"}

# Key constants
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
NOUS_API_BASE_URL = "https://inference-api.nousresearch.com/v1"
AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
VALID_REASONING_EFFORTS = ("xhigh", "high", "medium", "low", "minimal")
```

---

## 6. CLI System

### 6.1 Interactive CLI (cli.py)

The `HermesCLI` class provides the interactive terminal interface.

**Features:**

- **Rich** for banner/panels, **prompt_toolkit** for input with autocomplete
- **KawaiiSpinner** — animated faces during API calls, `┊` activity feed for tool results
- Multiline editing with Shift+Enter
- Slash-command autocomplete
- Session history with up/down arrow navigation
- Clipboard image paste (Alt+V / Ctrl+V)
- Status bar showing model, provider, and token counts
- Inline diff previews for file write/patch operations

**Configuration Loading:**

```python
load_cli_config() → dict
# Loads from ~/.hermes/config.yaml (or ./cli-config.yaml fallback)
# Merges with hardcoded defaults
# Expands ${ENV_VAR} references
# Maps terminal config → env vars
```

---

### 6.2 CLI Entry Point (hermes_cli/main.py)

All `hermes` subcommands are dispatched from here:

```
hermes                    # Default: interactive chat
hermes chat               # Explicit interactive mode
hermes gateway start|stop|status|install|uninstall
hermes setup              # Setup wizard
hermes model              # Select model/provider
hermes tools              # Configure tools
hermes skills             # Manage skills
hermes config set|get     # Direct config manipulation
hermes cron list|delete   # Cron job management
hermes doctor             # Diagnose issues
hermes sessions browse    # Session picker
hermes profile create|list|switch|delete|export|import
hermes mcp serve|add|remove  # MCP management
hermes acp                # Start ACP server
hermes update|uninstall|version
```

**Profile System:**

- `_apply_profile_override()` runs BEFORE any imports to set `HERMES_HOME`
- Pre-parses `--profile/-p` from argv
- Allows fully isolated agent instances with separate config, memory, sessions, skills

---

### 6.3 Configuration System (hermes_cli/config.py)

**Key Configuration Sections:**

```yaml
model: "anthropic/claude-opus-4.6" # or dict with provider/base_url/api_key
providers: {} # Provider-specific configs
fallback_providers: [] # Ordered failover list
credential_pool: {} # Multiple API keys per provider

agent:
  max_turns: 90
  gateway_timeout: 1800
  tool_use_enforcement: "auto"

terminal:
  backend: "local" # local|docker|modal|daytona|ssh|singularity
  timeout: 180
  persistent_shell: true
  docker_image: "nikolaik/python-nodejs:..."

compression:
  enabled: true
  threshold: 0.50 # Compress when 50% of context used
  target_ratio: 0.20 # Summary = 20% of compressed content
  protect_last_n: 20

auxiliary:
  vision: { provider, model }
  web_extract: { provider, model }
  compression: { provider, model }

memory:
  memory_enabled: true
  provider: "" # "" | "honcho" | "mem0" | etc.
  memory_char_limit: 2200

display:
  personality: "kawaii"
  show_reasoning: false
  inline_diffs: true
  skin: "default"
  streaming: true

tts:
  provider: "edge" # edge|elevenlabs|openai|neutts

stt:
  enabled: true
  provider: "local" # local|groq|openai

privacy:
  redact_pii: false

mcp_servers: {} # MCP server configurations

skills:
  external_dirs: [] # Additional skill directories

approvals:
  mode: "smart" # smart|always|off
```

**Config Files:**

- `~/.hermes/config.yaml` — User settings (authoritative)
- `~/.hermes/.env` — API keys and secrets
- Config version migration system (currently v5)

---

### 6.4 Slash Command Registry (hermes_cli/commands.py)

All slash commands defined centrally in `COMMAND_REGISTRY`:

```python
CommandDef(name, description, category, aliases, args_hint, cli_only, gateway_only)
```

**Derived automatically by:**

- CLI `process_command()` — dispatch on canonical name
- Gateway dispatch + help
- Telegram BotCommand menu
- Slack `/hermes` subcommands
- Autocomplete + help text

**Key Commands:**

| Command        | Aliases    | Description                   |
| -------------- | ---------- | ----------------------------- |
| `/new`         | `/reset`   | Start fresh conversation      |
| `/model`       |            | Show/switch model             |
| `/personality` |            | Set agent personality         |
| `/retry`       |            | Retry last turn               |
| `/undo`        |            | Remove last turn              |
| `/compress`    | `/compact` | Compress context              |
| `/usage`       | `/cost`    | Show token usage              |
| `/insights`    |            | Usage analytics               |
| `/skills`      |            | Browse/install skills         |
| `/background`  | `/bg`      | Manage background processes   |
| `/plan`        |            | Generate implementation plan  |
| `/rollback`    |            | Restore filesystem checkpoint |
| `/verbose`     |            | Toggle debug output           |
| `/reasoning`   |            | Set reasoning effort          |
| `/yolo`        |            | Toggle approval bypass        |
| `/btw`         |            | Ephemeral side question       |
| `/stop`        |            | Kill current agent run        |
| `/queue`       |            | Queue next prompt             |
| `/browser`     |            | Interactive browser session   |
| `/history`     | `/resume`  | Session browser               |
| `/skin`        |            | Switch CLI theme              |

---

### 6.5 Setup Wizard (hermes_cli/setup.py)

Modular interactive wizard with independent sections:

1. **Model & Provider** — Select AI provider, enter API keys, choose model
2. **Terminal Backend** — Choose execution environment
3. **Agent Settings** — Max iterations, compression, session policies
4. **Messaging Platforms** — Configure Telegram, Discord, Slack, etc.
5. **Tools** — TTS, STT, web search, image generation, browser

Features:

- Live credential validation
- Real-time model list fetching from provider APIs
- Automatic OpenClaw migration detection
- Atomic config file writes

---

### 6.6 Model Catalog (hermes_cli/models.py)

Provider-specific model lists:

```python
_PROVIDER_MODELS = {
    "nous": ["anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4.6", ...],  # 25+
    "openrouter": ["anthropic/claude-opus-4.6", "google/gemini-3-flash", ...],  # 30+
    "anthropic": ["claude-opus-4-6", "claude-sonnet-4-6", ...],
    "openai": ["gpt-5", "gpt-5.4-mini", "gpt-4.1", "gpt-4o", ...],
    "copilot": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", ...],
    "huggingface": [...],
    "minimax": [...],
    "kimi-coding": [...],
    "alibaba": [...],
    "deepseek": [...],
    # ... more providers
}
```

Features:

- Dynamic fetching via provider `/models` endpoints
- Curated lists used when live probe returns fewer models
- Fuzzy matching for typo correction
- Validation against provider catalog

---

### 6.7 Skin/Theme Engine (hermes_cli/skin_engine.py)

Data-driven CLI visual customization — no code changes needed.

**Customizable Elements:**

| Element                          | Key                      | Used By           |
| -------------------------------- | ------------------------ | ----------------- |
| Banner border/title/accent       | `colors.*`               | banner.py         |
| Response box border              | `colors.response_border` | cli.py            |
| Spinner faces (waiting/thinking) | `spinner.*`              | display.py        |
| Spinner verbs/wings              | `spinner.*`              | display.py        |
| Tool output prefix               | `tool_prefix`            | display.py        |
| Per-tool emojis                  | `tool_emojis`            | display.py        |
| Agent name/welcome/prompt        | `branding.*`             | banner.py, cli.py |

**Built-in Skins:** default, ares, mono, slate, poseidon, sisyphus, charizard

**User Skins:** Drop `~/.hermes/skins/<name>.yaml` and activate with `/skin <name>`

---

## 7. Tool System

### 7.1 Terminal Tool (tools/terminal_tool.py)

Shell command execution across multiple backends.

```python
def terminal_tool(
    command: str,
    background: bool = False,
    timeout: Optional[int] = None,
    task_id: Optional[str] = None,
    force: bool = False,        # Skip approval for dangerous commands
    workdir: Optional[str] = None,
    check_interval: Optional[int] = None,  # Background task polling
    pty: bool = False,
) -> str  # JSON result
```

**Features:**

- Multi-backend: Selects based on `TERMINAL_ENV` (local/docker/ssh/modal/daytona/singularity)
- Per-task_id sandboxes with thread-safe creation locks
- Dangerous command routing through approval system
- Background task support with file-based IPC
- Interrupt handling — polls `is_interrupted()` during execution
- Auto-cleanup daemon thread for idle environments (>300s)
- Disk usage warnings at configurable threshold

---

### 7.2 File Tools (tools/file_tools.py)

Safe file operations with size guards and sensitive path protection.

- `read_file_tool(path, offset, limit)` — Read with pagination (default 100K char limit)
- `write_file_tool(path, content)` — Write with approval for sensitive paths
- `edit_file_tool(path, old_text, new_text)` — String replacement editing
- `list_files_tool(path)` — Directory listing
- `search_files_tool(pattern, path)` — Glob/regex file search

**Safety:**

- Device path blocklist (`/dev/zero`, `/dev/stdin`, etc.)
- Read dedup tracking — returns stub on re-read if mtime unchanged
- Sensitive path blocking: `/etc/`, `/boot/`, `~/.ssh` without approval
- Prompt injection protection for known dangerous paths

---

### 7.3 Web Tools (tools/web_tools.py)

Web search and content extraction.

- `web_search_tool(query, limit)` — Search via configurable backend
- `web_extract_tool(urls, format)` — Extract content from URLs
- `web_crawl_tool(url, instructions)` — LLM-guided web crawling

**Backends:** Firecrawl, Parallel Web, Tavily, Exa, DuckDuckGo

- Fallback detection by highest-priority available API key
- LLM processing via auxiliary client (Gemini 3 Flash) for intelligent extraction
- SSRF protection and URL safety checks

---

### 7.4 Browser Tool (tools/browser_tool.py)

Headless browser automation with accessibility tree.

```python
browser_navigate(url, task_id) → str
browser_snapshot(task_id, max_chars) → str
browser_click(ref, task_id) → str      # Element refs like @e1, @e2
browser_type(ref, text, task_id) → str
browser_scroll(ref, direction, task_id) → str
browser_extract(task, max_chars, task_id) → str
```

**Backends:**

- **Local:** Headless Chromium via `agent-browser` CLI
- **Cloud:** Browserbase (stealth, proxies, CAPTCHA solving)
- **Camofox:** Anti-detection browser using Camoufox

**Features:**

- Accessibility tree for text-based snapshots (no vision required)
- Session isolation per task_id with inactivity cleanup
- API key detection in URLs (prevents exfiltration)
- SSRF protection for private/internal addresses

---

### 7.5 Delegate Tool (tools/delegate_tool.py)

Spawn isolated subagents for parallel workstreams.

```python
def delegate_task(
    goal: str,
    context: str = None,
    toolsets: List[str] = None,       # Default: ["terminal", "file", "web"]
    tasks: List[Dict] = None,          # Batch mode: up to 3 concurrent
    max_iterations: int = 50,
    parent_agent = None,
) → str
```

**Isolation:**

- Fresh conversation (no parent history)
- Own task_id (separate terminal session, file ops)
- Restricted toolset (configurable, blocked tools always stripped)
- Focused system prompt from goal + context
- Parent only sees delegation call and summary result

**Blocked Tools:** delegate_task, clarify, memory, send_message, execute_code (no recursion, no user interaction)

**Constraints:** MAX_DEPTH=2, MAX_CONCURRENT_CHILDREN=3

---

### 7.6 MCP Tool (tools/mcp_tool.py)

Model Context Protocol client integration.

**Configuration (config.yaml):**

```yaml
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    timeout: 120
  remote_api:
    url: "https://my-mcp-server.example.com/mcp"
    headers:
      Authorization: "Bearer sk-..."
    sampling:
      enabled: true
      model: "gemini-3-flash"
```

**Features:**

- **Transports:** Stdio (local processes) and HTTP/StreamableHTTP (remote)
- **Dynamic tool discovery:** Listens for `tools/list_changed` notifications
- **Sampling support:** MCP servers can request LLM completions
- **Automatic reconnection** with exponential backoff (5 retries)
- Dedicated background event loop in daemon thread
- Thread-safe via lock protecting server dict

---

### 7.7 Approval System (tools/approval.py)

Dangerous command detection and approval flow.

```python
detect_dangerous_command(command: str) → (is_dangerous, pattern_key, description)
```

**106 patterns covering:**

- Destructive operations (`rm -r /`, `mkfs`, `dd if=`)
- Privilege escalation (`chmod 777`, `chown -R root`)
- SQL injection (`DROP TABLE`, `DELETE FROM` without WHERE)
- System targeting (`/etc/` writes, `systemctl stop`, fork bombs)
- Shell injection (pipe to sh, wget to sh, process substitution)
- Network exfiltration (curl with embedded API keys)
- Secret access (`cat ~/.env`, `cat ~/.netrc`)

**Normalization:** Strips ANSI escapes, null bytes, normalizes Unicode

**Approval Modes:**

- `smart` — Learns which commands are safe based on user decisions
- `always` — Always ask for dangerous commands
- `off` — Never ask (or `/yolo` toggle)

---

### 7.8 Terminal Backends (tools/environments/)

| Backend           | File               | Features                                                                       |
| ----------------- | ------------------ | ------------------------------------------------------------------------------ |
| **Local**         | `local.py`         | Direct execution, interrupt support, non-blocking I/O, persistent shell        |
| **Docker**        | `docker.py`        | Sandboxed containers, cap-drop ALL, no-new-privileges, PID limits, bind mounts |
| **SSH**           | `ssh.py`           | Remote execution via ControlMaster, persistent shell mixin                     |
| **Modal**         | `modal.py`         | Native Modal SDK `Sandbox.create()`/`Sandbox.exec()`, persistent snapshots     |
| **Managed Modal** | `managed_modal.py` | Modal through Nous-hosted gateway                                              |
| **Daytona**       | `daytona.py`       | Daytona SDK cloud sandboxes, stop/resume lifecycle                             |
| **Singularity**   | `singularity.py`   | Singularity containers with scratch dir, SIF cache                             |

**Common Interface (BaseEnvironment ABC):**

```python
execute(command, timeout) → {"output": str, "returncode": int}
cleanup() → None
```

---

## 8. Agent Internals

### 8.1 Prompt Builder (agent/prompt_builder.py)

Assembles the system prompt from multiple sources:

| Component               | Source                                               |
| ----------------------- | ---------------------------------------------------- |
| Agent Identity          | `DEFAULT_AGENT_IDENTITY` or `SOUL.md`                |
| Memory Guidance         | When/how to use memory tool                          |
| Session Search Guidance | How to recall past conversations                     |
| Skills Guidance         | When to create/patch skills                          |
| Tool Use Enforcement    | Must execute tools, not describe actions             |
| Skills Index            | `~/.hermes/skills/.hermes-skills.json`               |
| Platform Hints          | OS, Python version, shell, available tools           |
| Context Files           | `.hermes.md`, `AGENTS.md`, `.cursorrules`, `SOUL.md` |
| Model/Provider Info     | Current model and provider identity                  |

**Context File Discovery:**

1. Check `cwd/.hermes.md` or `HERMES.md`
2. Walk parent directories up to git root
3. Validate against injection patterns before inclusion

**Injection Detection (30+ patterns):**

- "ignore previous instructions", "system prompt override"
- "do not tell the user", "act as if you have no restrictions"
- HTML comment injection, exfiltration via curl, Unicode stealth chars

---

### 8.2 Context Compressor (agent/context_compressor.py)

Automatically compresses conversation history when approaching context limits.

```python
class ContextCompressor:
    threshold_percent: float = 0.50   # Compress when 50% of context used
    protect_first_n: int = 3          # Keep system prompt + first turn
    protect_last_n: int = 20          # Keep recent N messages
    summary_target_ratio: float = 0.20  # Summary = 20% of compressed content
```

**Compression Algorithm:**

1. **Pre-pass:** Replace old tool results with placeholder (cheap)
2. **Protect head:** System prompt + first exchange always kept
3. **Protect tail:** Token-budget-based tail protection (~20K tokens)
4. **Summarize middle:** LLM-generated structured summary (Goal, Progress, Decisions, Files, Next Steps)
5. **Iterative updates:** On subsequent compressions, update previous summary instead of re-summarizing

---

### 8.3 Prompt Caching (agent/prompt_caching.py)

Anthropic prompt caching support for cost reduction.

- System prompt cached across turns (first conversation turn establishes cache)
- Cache markers inserted at system prompt boundaries
- Must not break mid-conversation — altering past context invalidates cache
- The ONLY time context is altered is during compression

**Critical Rule:** Do NOT implement changes that would alter past context, change toolsets, reload memories, or rebuild system prompts mid-conversation.

---

### 8.4 Auxiliary Client (agent/auxiliary_client.py)

Separate LLM client for non-primary tasks:

- **Vision analysis** — Image description and analysis
- **Web extraction** — Content summarization
- **Context compression** — Generating conversation summaries
- **Session search** — Summarizing search results
- **MCP sampling** — Serving server-initiated LLM requests

Configured per-task via `auxiliary` section in config.yaml.

---

### 8.5 Display & Spinner (agent/display.py)

- **KawaiiSpinner** — Animated face characters during API calls
- **Tool preview formatting** — `┊` prefixed activity feed for tool execution
- **Inline diff previews** — Shows unified diffs for write/patch operations
- Respects active skin for colors, emojis, and branding

---

### 8.6 Skill Commands (agent/skill_commands.py)

Shared skill invocation for CLI and gateway:

- Skills loaded from `~/.hermes/skills/` and external directories
- Injected as **user message** (not system prompt) to preserve prompt caching
- `/plan` command generates implementation plans stored in `.hermes/plans/`
- Skill content includes setup instructions, tool options, usage examples

---

## 9. Messaging Gateway

### 9.1 GatewayRunner (gateway/run.py)

Main controller managing all platform adapters and routing messages.

**Key Attributes:**

- `adapters: Dict[Platform, BasePlatformAdapter]` — Active platform instances
- `session_store: SessionStore` — Conversation persistence
- `_running_agents: Dict[str, AIAgent]` — Per-session cached agents (preserves prompt caching)
- `_pending_approvals: Dict[str, Dict]` — Dangerous command approval tracking
- `pairing_store: PairingStore` — DM code-based user authorization

**Message Flow:**

1. Platform adapter queues `MessageEvent`
2. GatewayRunner dequeues, calls `_handle_message()`
3. Slash command? → dispatch to handler
4. Regular message? → `_handle_message_with_agent()` (async, with per-session locking)
5. Response delivered back via platform adapter

**Features:**

- Agent caching per session (preserves Anthropic prompt cache across turns)
- Session reset policies (inactivity timeout, hard reset)
- Per-session model overrides via `/model`
- Background memory flush on session expiry
- Approval routing (`/approve`, `/deny`) with interactive buttons (Discord)
- 30+ slash command handlers

---

### 9.2 Session Store (gateway/session.py)

**SessionSource** — Where a message originated (platform, chat_id, user info)
**SessionContext** — Full context for system prompt injection (platforms, home channels, metadata)
**SessionStore** — Loads/saves conversation transcripts as JSON files

```
~/.hermes/sessions/{session_key}.json
Format: [{role, content, timestamp}, ...]
```

**Features:**

- Session key computed from platform + chat_id + thread_id (deterministic hash)
- Inactivity timeout for session resets
- PII redaction (phone numbers hashed)
- Survives gateway restarts

---

### 9.3 Platform Adapters (gateway/platforms/)

**16 adapters sharing `BasePlatformAdapter` interface:**

| Platform           | Key Features                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Telegram**       | Polling + webhook mode, media handling, inline keyboards, forum topic isolation, group mention gating    |
| **Discord**        | Server channels, threads, reactions (processing/done/error), button-based approval, @mention requirement |
| **Slack**          | Multi-workspace OAuth, thread handling, app_mention, `/hermes` subcommands                               |
| **WhatsApp**       | Group & DM support, media captions, LID↔phone alias resolution                                           |
| **Matrix**         | E2EE room encryption, threaded messages, trusted device flow, native voice messages                      |
| **Signal**         | Encrypted DMs, group membership, SSE keepalive, phone URL encoding                                       |
| **Email**          | IMAP/SMTP, multi-recipient, skip_attachments option                                                      |
| **Home Assistant** | REST tools + WebSocket, service discovery, smart home automation                                         |
| **SMS**            | Twilio integration                                                                                       |
| **Mattermost**     | Self-hosted Slack alternative, configurable mention behavior                                             |
| **DingTalk**       | Alibaba enterprise messaging                                                                             |
| **Feishu/Lark**    | Enterprise messaging, message cards, approval workflows                                                  |
| **WeCom**          | Enterprise WeChat, department management                                                                 |
| **Webhook**        | Generic HTTP POST for custom integrations                                                                |
| **API Server**     | OpenAI-compatible `/v1/chat/completions` endpoint                                                        |

**Common Features:**

- Image/audio caching for vision and STT tools
- Rate limiting with exponential backoff
- Session routing with authorization rules
- Cross-platform conversation continuity

---

## 10. Cron Scheduling

Built-in job scheduler running in the gateway background thread.

**Schedule Types:**

- `"once in 5m"` — One-shot after duration
- `"every 30m"` — Recurring interval
- `"0 9 * * *"` — Standard cron expression
- `"2026-04-06T14:00"` — Absolute datetime

**Job Storage:** `~/.hermes/cron/jobs.json`

**Execution Flow:**

1. `tick()` called every 60s from gateway background thread
2. Fetch due jobs past `next_run_at`
3. Spawn `hermes` CLI subprocess with job prompt + skills
4. Capture output → save to `~/.hermes/cron/output/{job_id}/{timestamp}.md`
5. Deliver to target platform (or stay local)

**Delivery Targets:**

- `"local"` — Output saved locally only
- `"origin"` — Send to originating chat
- `"telegram:<chat_id>"` — Explicit platform/chat routing
- `[SILENT]` prefix — Suppress delivery but keep logs

**Grace Windows:** Based on schedule frequency (120s–2hrs) to handle missed jobs

---

## 11. Skills System

**Skills are composable, agent-invokable knowledge units.**

**Structure:**

```
skills/
├── creative/              # ASCII art, diagrams, music
├── software-development/  # Debugging, testing, docs
├── github/                # Codebase inspection, PR workflow
├── research/              # Literature, web scraping
├── productivity/          # Task management
├── media/                 # Image, video, audio processing
├── mlops/                 # ML experiment tracking
├── autonomous-ai-agents/  # Multi-agent orchestration
└── [20+ more categories]
```

**Per-Skill Structure:**

```
skill-name/
├── SKILL.md     # Metadata (YAML frontmatter) + implementation instructions
└── [sub-skills]/
```

**SKILL.md Example:**

```yaml
---
name: ascii-art
description: Generate ASCII art using multiple tools
version: 4.0.0
dependencies: []
metadata:
  hermes:
    tags: [ASCII, Art, Banners, Creative]
    related_skills: [excalidraw]
---
[Implementation instructions, tool options, examples...]
```

**Discovery:**

- Auto-discovered from `~/.hermes/skills/` + external dirs
- Skills index built at startup (`.hermes-skills.json`)
- Loaded as user messages to preserve prompt caching
- Per-platform enable/disable via `hermes skills`
- Skills Hub (`agentskills.io`) for community sharing

---

## 12. Plugin System

Drop Python files into `~/.hermes/plugins/` to extend Hermes.

**Plugin Capabilities:**

- Register custom tools and toolsets
- Inject messages into conversation
- Lifecycle hooks: `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`
- Enable/disable via `hermes plugins enable/disable <name>`

**Memory Provider Plugins (plugins/memory/):**
8 implementations: openviking, mem0, hindsight, holographic, honcho, retaindb, byterover

Each implements:

```python
class MemoryProvider:
    def is_available() → bool
    def store(key, value)
    def retrieve(query) → list
    def clear()
```

---

## 13. Memory System

Hermes has a pluggable memory provider interface:

**Built-in Memory:**

- `MEMORY.md` — Markdown file with persistent facts
- `USER.md` — User profile information
- Memory read/write tools called by agent during conversation
- Periodic nudges prompt agent to save important information
- FTS5 session search for cross-session recall

**Honcho Integration:**

- AI-native dialectic user modeling
- Async memory writes
- Profile-scoped host/peer resolution
- Multi-user isolation in gateway mode

**Configuration:**

```yaml
memory:
  memory_enabled: true
  provider: "" # "" for built-in, "honcho", "mem0", etc.
  memory_char_limit: 2200
```

---

## 14. ACP Server (IDE Integration)

Agent Communication Protocol server for VS Code, Zed, JetBrains.

**Entry:** `hermes acp` → `acp_adapter/server.py`

**HermesACPAgent Class:**

```python
initialize()                    # Handshake with IDE client
authenticate(method_id)         # Validate credentials
new_session(cwd, mcp_servers)   # Create isolated session
load_session(session_id)        # Resume session
fork_session(session_id)        # Branch for parallel work
list_sessions()                 # Browse all sessions
cancel(session_id)              # Interrupt running agent
```

**Features:**

- Slash command support (`/model`, `/tools`, `/reset`, `/compact`)
- Client-provided MCP servers (IDE's MCP ecosystem flows into agent)
- Streaming callbacks for messages, thinking, tool progress
- Dangerous command approval via IDE UI

---

## 15. API Server

OpenAI-compatible API endpoint for headless integrations (e.g., Open WebUI).

**Endpoint:** `POST /v1/chat/completions`

**Features:**

- `X-Hermes-Session-Id` header for persistent sessions
- Tool progress streaming via SSE events
- `/api/jobs` REST API for cron management
- Input limits, field whitelists, SQLite-backed response persistence
- CORS origin protection

---

## 16. MCP Server Mode

Expose Hermes conversations to MCP-compatible clients.

**Entry:** `hermes mcp serve`

**Features:**

- Browse conversations and sessions
- Read messages and search across sessions
- Manage attachments
- Supports both stdio and Streamable HTTP transports
- Compatible with Claude Desktop, Cursor, VS Code, etc.

---

## 17. RL Training Environments

Atropos-based RL training framework for agent policy optimization.

**Base Class:** `HermesAgentBaseEnv` (extends `atroposlib.BaseEnv`)

**Configuration:**

```python
HermesAgentEnvConfig:
    enabled_toolsets: ["terminal", "file", "web"]
    max_agent_turns: 30
    agent_temperature: 1.0
    terminal_backend: "local"  # or docker/modal for isolation
    dataset_name: str
```

**Subclass Requirements:**

- `setup()` — Load dataset
- `get_next_item()` — Return next task
- `format_prompt()` — Convert item → user message
- `compute_reward()` — Score rollout
- `evaluate()` — Periodic eval on test set

**Example Environments:**

- `web_research_env.py` — Web research tasks
- `agentic_opd_env.py` — Observation-Prediction-Demonstration
- `hermes_swe_env.py` — Software engineering tasks

**Supporting:**

- `HermesAgentLoop` — Orchestrates step-by-step rollouts
- `ToolContext` — Sandbox for tool execution, records side effects
- `trajectory_compressor.py` — Compresses trajectories for training data

---

## 18. Profiles (Multi-Instance)

Run multiple fully isolated Hermes instances from the same installation.

**Commands:**

```bash
hermes profile create <name>
hermes profile list
hermes profile switch <name>
hermes profile delete <name>
hermes profile export <name>
hermes profile import <file>
hermes -p <name>             # Launch with specific profile
```

**Each profile gets:**

- Own `HERMES_HOME` directory (`~/.hermes/profiles/<name>/`)
- Own config.yaml, .env, memory, sessions, skills, gateway service
- Token-lock isolation (prevents two profiles sharing bot credentials)

**Implementation:**

- `_apply_profile_override()` sets `HERMES_HOME` env var before any imports
- All 119+ references to `get_hermes_home()` automatically scope to active profile
- Profile operations are HOME-anchored (`~/.hermes/profiles/`) for cross-profile visibility

---

## 19. Security Model

### Command Approval

- 106 dangerous command patterns (destructive, privilege escalation, SQL, exfiltration)
- Smart approval mode learns from user decisions
- Session-based approval state (per-session tracking)
- `--fuck-it-ship-it` flag or `/yolo` toggle to bypass

### Secret Protection

- Secret redaction in logs and tool output (API keys, tokens)
- Browser URL scanning for embedded secrets
- LLM response scanning for exfiltration attempts
- Credential directory protection (`.docker`, `.azure`, `.config/gh`, `.ssh`)
- `execute_code` sandbox output redaction

### Input Safety

- Prompt injection detection in context files (30+ patterns)
- Unicode stealth character detection
- ANSI escape sequence normalization
- Device path blocklist for file reads
- SSRF protection in web/browser tools

### PII Handling

- Optional `privacy.redact_pii` mode
- Phone number hashing in session metadata
- Sender ID anonymization in gateway logs

### Supply Chain

- All dependency version ranges pinned
- `uv.lock` with hashes for reproducible builds
- CI workflow scanning PRs for supply chain attack patterns
- Compromised `litellm` dependency removed

---

## 20. Provider & Model System

### Supported Providers

| Provider              | API Mode           | Key Features                              |
| --------------------- | ------------------ | ----------------------------------------- |
| **Nous Portal**       | chat_completions   | 400+ models, first-class setup            |
| **OpenRouter**        | chat_completions   | 200+ models, provider routing preferences |
| **Anthropic**         | anthropic_messages | Native prompt caching, OAuth PKCE         |
| **OpenAI**            | chat_completions   | GPT-5, Codex                              |
| **GitHub Copilot**    | chat_completions   | OAuth, 400k context                       |
| **Hugging Face**      | chat_completions   | Curated agentic model picker              |
| **Google (Direct)**   | chat_completions   | Full Gemini context lengths               |
| **z.ai/GLM**          | chat_completions   | Chinese LLM models                        |
| **Kimi/Moonshot**     | chat_completions   | Kimi Code API                             |
| **MiniMax**           | anthropic_messages | M2.7 models                               |
| **Alibaba/DashScope** | chat_completions   | Qwen models                               |
| **DeepSeek**          | chat_completions   | V3 models                                 |
| **Vercel AI Gateway** | chat_completions   | Routing through Vercel                    |
| **Kilo Code**         | chat_completions   | Custom provider                           |
| **OpenCode Zen/Go**   | chat_completions   | Custom provider                           |
| **Custom Endpoint**   | configurable       | Any OpenAI-compatible API                 |

### Provider Features

- **Ordered fallback chain:** Auto-failover across configured providers on errors
- **Credential pools:** Multiple API keys per provider with `least_used` rotation
- **Per-turn primary restoration:** After fallback use, restore primary on next turn
- **Context length detection:** models.dev integration, provider-aware resolution, `/v1/props` for llama.cpp
- **Rate limit handling:** User-friendly 429 messages with Retry-After countdown
- **Anthropic long-context tier:** Auto-reduces to 200k on tier limit 429

---

## 21. Streaming & Reasoning

### Streaming

- Enabled by default in CLI and gateway
- Token-by-token delivery via `stream_delta_callback`
- Proper spinner/tool progress display during streaming
- Stale connection detection (90s timeout)
- Fallback to non-streaming if provider doesn't support it

### Reasoning/Thinking

- Configurable effort: xhigh, high, medium, low, minimal, none
- `/reasoning` command to toggle display and effort level
- Anthropic thinking blocks preserved across multi-turn conversations
- `<think>` tag extraction for compatible models
- Reasoning persisted to SessionDB (v6 schema) for cross-session continuity
- Thinking-budget exhaustion detection to skip useless continuation retries

---

## 22. Release History

### v0.2.0 (March 12, 2026) — The Foundation Release

> 216 merged PRs from 63 contributors, resolving 119 issues

- Multi-platform messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal, Email, Home Assistant)
- MCP client support (stdio + HTTP)
- 70+ skills across 15+ categories
- Centralized provider router (`call_llm()` API)
- ACP server for IDE integration
- CLI skin/theme engine
- Git worktree isolation (`hermes -w`)
- Filesystem checkpoints and `/rollback`
- 3,289 tests

### v0.3.0 (March 17, 2026) — Streaming, Plugins, Providers

- Unified streaming infrastructure (token-by-token delivery)
- First-class plugin architecture (`~/.hermes/plugins/`)
- Native Anthropic provider with prompt caching
- Smart approvals + `/stop` command
- Honcho memory integration
- Voice mode (CLI push-to-talk, Telegram/Discord voice)
- Concurrent tool execution (ThreadPoolExecutor)
- PII redaction
- `/browser connect` via Chrome DevTools Protocol
- Vercel AI Gateway provider
- Persistent shell mode for local/SSH backends
- Agentic On-Policy Distillation RL environment

### v0.4.0 (March 23, 2026) — Platform Expansion

- OpenAI-compatible API server (`/v1/chat/completions`)
- 6 new messaging adapters (Signal rewrite, DingTalk, SMS, Mattermost, Matrix, Webhook)
- `@file` and `@url` context references with tab completion
- 4 new providers (GitHub Copilot, Alibaba, Kilo Code, OpenCode)
- MCP server management CLI with OAuth 2.1 PKCE
- Gateway prompt caching (dramatic cost reduction)
- Context compression overhaul (structured summaries, iterative updates)
- Streaming enabled by default
- 200+ bug fixes

### v0.5.0 (March 28, 2026) — Hardening

- Nous Portal expanded to 400+ models
- Hugging Face as first-class provider
- Telegram Private Chat Topics
- Native Modal SDK backend (replaced swe-rex)
- Plugin lifecycle hooks activated
- GPT model tool-use enforcement
- Nix flake with NixOS module
- Supply chain hardening (removed litellm, pinned deps, CI scanning)
- Anthropic per-model output limits (128K for Opus 4.6)

### v0.6.0 (March 30, 2026) — Multi-Instance

> 95 PRs and 16 resolved issues in 2 days

- Profiles for multiple isolated agent instances
- MCP Server Mode (`hermes mcp serve`)
- Official Docker container
- Ordered fallback provider chain
- Feishu/Lark platform adapter
- WeCom (Enterprise WeChat) adapter
- Slack multi-workspace OAuth
- Telegram webhook mode + group controls
- Exa search backend
- Skills & credentials on remote backends

### v0.7.0 (April 3, 2026) — Resilience

> 168 PRs and 46 resolved issues

- Pluggable memory provider interface (ABC-based plugin system)
- Same-provider credential pools with automatic rotation
- Camofox anti-detection browser backend
- Inline diff previews in tool activity feed
- API server session continuity + tool streaming
- ACP client-provided MCP servers
- Gateway hardening (race conditions, approval routing, compression death spirals)
- Secret exfiltration blocking (URL scanning, base64 detection)

---

## 23. File Dependency Chain

```
hermes_constants.py  (no deps — imported by everything)
       ↑
tools/registry.py  (no tool deps — imported by all tool files)
       ↑
tools/*.py  (each calls registry.register() at import time)
       ↑
model_tools.py  (imports tools/registry + triggers tool discovery)
       ↑
run_agent.py (AIAgent), cli.py (HermesCLI), gateway/run.py (GatewayRunner)
       ↑
hermes_cli/main.py  (entry point — dispatches to all subsystems)
```

**Key Principle:** `tools/registry.py` is circular-import safe. It has no tool dependencies. Tool files import the registry; `model_tools.py` imports both.

---

## 24. Key Design Patterns

| Pattern                        | Description                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Registry-based Tool System** | Single source of truth; plugins register at import time; dynamic (MCP) and static tools coexist    |
| **Toolset Composition**        | Recursive resolution with cycle detection; platform-specific composites                            |
| **Iteration Budget**           | Thread-safe shared budget across parent + subagents                                                |
| **Streaming First**            | Preferred over non-streaming for health checking (stale connection detection)                      |
| **Prefix Caching**             | System prompt cached across turns (Anthropic optimization); context never altered mid-conversation |
| **Proactive Compression**      | Triggered at 50% context usage; structured summaries with iterative updates                        |
| **Async Bridging**             | Persistent event loops prevent "Event loop is closed"; per-thread loops for workers                |
| **Profile Isolation**          | HERMES_HOME env var set before imports; all state functions route through `get_hermes_home()`      |
| **Agent Caching**              | Gateway caches AIAgent per session to preserve prompt cache across turns                           |
| **WAL Concurrency**            | SQLite WAL mode + jitter retry for concurrent readers + single writer                              |
| **Plugin Architecture**        | Tools, toolsets, hooks, memory providers extensible via plugins                                    |
| **Multi-Backend Execution**    | Pluggable terminal backends with unified BaseEnvironment interface                                 |
| **Safety Layers**              | Approval system → sensitive path guards → injection detection → capability filtering               |

---

## 25. Configuration Reference

### Environment Variables (key ones)

| Variable              | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `HERMES_HOME`         | Override home directory (profiles set this automatically) |
| `OPENROUTER_API_KEY`  | OpenRouter provider key                                   |
| `ANTHROPIC_API_KEY`   | Anthropic provider key                                    |
| `OPENAI_API_KEY`      | OpenAI provider key                                       |
| `NOUS_API_KEY`        | Nous Portal key                                           |
| `FIRECRAWL_API_KEY`   | Web search/extraction                                     |
| `EXA_API_KEY`         | Exa search backend                                        |
| `BROWSERBASE_API_KEY` | Cloud browser                                             |
| `FAL_KEY`             | Image generation                                          |
| `ELEVENLABS_API_KEY`  | Premium TTS                                               |
| `HONCHO_API_KEY`      | Honcho memory                                             |
| `TERMINAL_ENV`        | Terminal backend override                                 |
| `TERMINAL_CWD`        | Terminal working directory                                |
| `MESSAGING_CWD`       | Gateway working directory                                 |

### Config File Locations

| File                          | Purpose                          |
| ----------------------------- | -------------------------------- |
| `~/.hermes/config.yaml`       | Main configuration (YAML)        |
| `~/.hermes/.env`              | API keys and secrets             |
| `~/.hermes/MEMORY.md`         | Persistent agent memory          |
| `~/.hermes/USER.md`           | User profile                     |
| `~/.hermes/SOUL.md`           | Agent persona/identity           |
| `~/.hermes/sessions.db`       | SQLite session database          |
| `~/.hermes/cron/jobs.json`    | Cron job definitions             |
| `.hermes.md` (in project dir) | Per-project context file         |
| `AGENTS.md` (in project dir)  | Developer instructions for agent |

---

## 26. Known Pitfalls

1. **DO NOT hardcode `~/.hermes` paths** — Use `get_hermes_home()` from `hermes_constants`. Hardcoding breaks profiles.

2. **DO NOT use `simple_term_menu`** — Rendering bugs in tmux/iTerm2 (ghosting). Use `curses` instead.

3. **DO NOT use `\033[K`** (ANSI erase-to-EOL) — Leaks as literal text under prompt_toolkit's `patch_stdout`. Use space-padding.

4. **`_last_resolved_tool_names` is process-global** — Saved/restored around subagent execution in `delegate_tool.py`.

5. **DO NOT hardcode cross-tool references in schemas** — Tool may be unavailable. Add dynamic references in `get_tool_definitions()`.

6. **Tests must not write to `~/.hermes/`** — `_isolate_hermes_home` autouse fixture redirects to temp dir.

7. **Prompt caching must not break** — Do NOT alter past context, change toolsets, reload memories, or rebuild system prompts mid-conversation.

8. **Working directory behavior differs:** CLI uses `os.getcwd()`, gateway uses `MESSAGING_CWD` env var.

9. **Config has three loaders:** `load_cli_config()` (CLI), `load_config()` (hermes tools/setup), direct YAML (gateway). They have different merge behaviors.

10. **Profile operations are HOME-anchored** — `_get_profiles_root()` returns `Path.home() / ".hermes" / "profiles"`, NOT `get_hermes_home() / "profiles"`. This is intentional for cross-profile visibility.

---

_This document covers Hermes Agent v0.7.0 as of April 2026. For the latest information, refer to the [official documentation](https://hermes-agent.nousresearch.com/docs/) and the [GitHub repository](https://github.com/NousResearch/hermes-agent)._
