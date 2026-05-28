# OpenDrSai Scientific Agent Development Framework

## English | [简体中文](README.md)

An integrated framework for rapid development and deployment of agents and multi-agent collaborative systems, developed by the HepAI team at the Institute of High Energy Physics, Chinese Academy of Sciences: [HepAI](https://ai.ihep.ac.cn/). It enables fast development and deployment of both backend and frontend services for your own agents and multi-agent systems.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="Architecture Diagram">
  </p>
</div>

This framework is based on Microsoft’s open-source framework [AutoGen](https://github.com/microsoft/autogen) (currently version 0.5.7). While maintaining full compatibility with the AutoGen architecture and ecosystem, it redesigns components and development logic for agents and multi-agent systems, making it more suitable for developing **professional scientific agents and multi-agent systems 🤖**, such as complex multi-task execution 💡, state management and human-computer interaction 🙋‍♂️🙋‍♀️, professional scientific tool management and execution 🛠️, long-task execution management ⏰, and long/short-term memory management 🧠.

It is highly compatible with mainstream MCP and A2A protocols, the [HepAI](https://ai.ihep.ac.cn/) ecosystem, and RAGFlow-based RAG architectures. Additionally, it supports integrated development and deployment: agent or multi-agent system code can be launched with one click and registered as OpenAI ChatCompletions format or HepAI Worker format APIs. A corresponding human-computer interaction frontend is also provided, enabling full-stack application development and deployment. Documentation is available at [OpenDrSai Docs](https://docs-drsai.ihep.ac.cn/).

## 1. Features

- 1. Supports flexible switching of agent foundation models via the [HepAI platform](https://aiapi.ihep.ac.cn/), along with flexible configuration of tools, knowledge bases, and other agent components. Also compatible with OpenAI ChatCompletions, Ollama, and other model formats.
- 2. Provides predefined modular components for perception, reasoning, memory, execution, and state management for agents and multi-agent systems. These are plugin-based and highly extensible, supporting a wide range of professional agent applications.
- 3. Includes a one-click startup frontend and backend for human-computer interaction, enabling "development-as-application". It also provides backend interfaces compatible with OpenAI ChatCompletions and OpenWebui-Pipeline, allowing agents and multi-agent systems to be used as third-party API services.
- 4. Features a brand-new **Terminal User Interface (TUI)** based on React/Ink, enabling direct interaction with agents in the terminal. Launch with `drsai` or `drsai chat`. Supports session management, model switching, slash commands, reasoning visualization, and more — delivering a Claude Code-like immersive development experience.
- 5. Includes a **Desktop App** (Electron) launchable via `drsai desktop`, with system tray support and remote gateway connectivity.

### 📢 Feature Comparison

|      Feature       | OpenDrSai Framework |    AutoGen     |    Camel AI    |    LangChain   |    AutoGPT     | Dify.AI |
| :-------------: | :------------: | :------------: | :------------: | :------------: | :------------: | :------------: |
| Framework Characteristics | ✅ Based on AutoGen, optimized for scientific tasks, highly extensible with strong HCI support, supports visualization and low-code development | Conversation-driven multi-agent architecture, modular and general-purpose, strong ecosystem but basic framework only | Role-playing + heuristic prompting collaboration architecture, strong ecosystem | Modular assembly development | Highly integrated agent/multi-agent architecture | Low-code platform with drag-and-drop, limited extensibility |
| Model Integration | ✅ Supports professional scientific models and custom strategies | Only general LLM formats supported | Only general LLM formats supported | Only general LLM formats supported | Only general LLM formats supported | Only general LLM formats supported |
| Scientific Data Integration | ✅ Includes perception modules for scientific data | Requires development | Not available | Not available | Not available | Not available |
| Memory & Knowledge | ✅ Modular knowledge integration and long-term memory management | Requires development | ✅ Long-term memory supported | Requires development | ✅ Short/long-term memory | ✅ Built-in knowledge base and storage |
| Scientific Tools | ✅ Supports MCP/OpenAPI/HepAI Worker integrations | Only MCP tools and local functions | ✅ Built-in tools and integrations | Requires development | Requires development | Limited built-in tools |
| Reflection & Learning | ✅ Modular reflection and learning | Requires development | ✅ Built-in reflection and learning | Requires development | ✅ Built-in reflection and learning | Limited, mostly RAG-based |
| State Management & HCI | ✅ Full frontend/backend HCI support | Basic userproxy mode | Basic userproxy mode | Requires development | Requires development | Not available |
| Long Task Management | ✅ Supports long-running scientific task monitoring | Not available | Not available | Not available | Not available | Not available |
| Modularity & Extensibility | ✅ Highly modular and extensible | ✅ Modular | ✅ Modular | Strong modularity | Limited | Limited |
| Interactive App Development | ✅ Build agents directly into web apps | AutoGen Studio drag-and-drop | CAMEL Web App | Requires external UI | Requires external UI | Drag-and-drop frontend |
| Terminal UI (TUI) | ✅ React/Ink TUI with slash commands, session mgmt, model switching, reasoning viz | Not available | Not available | Not available | Not available | Not available |
| Desktop Client | ✅ Electron desktop app with system tray and remote connectivity | Not available | Not available | Not available | Not available | Not available |

> As of: November 25, 2025

------

## 2. Quick Start

### 2.1 Install OpenDrSai

#### Install from Source (Recommended)

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://github.com/hepai-lab/drsai.git drsai # From Github
git clone https://code.ihep.ac.cn/hepai/drsai drsai # or From IHEP

cd your/path/to/drsai/python/packages/drsai && pip install -e . # backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # frontend UI
````

#### Install via pip (May be outdated)

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
```

#### Configure HepAI API Key

Configure API access key for [HepAI](https://aiapi.ihep.ac.cn):

Linux/macOS:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# Note: restart required
```

### 2.2 Quick Start — Terminal Mode (TUI) 🆕

After installation, launch agent interaction directly in your terminal with zero configuration:

```shell
conda activate drsai
drsai        # Launch the new Ink terminal UI (TUI)
# or
drsai chat   # Equivalent to drsai
```

A first-run setup wizard will guide you through API key configuration.

**TUI Highlights:**
- 🎨 Modern React/Ink terminal interface
- 💬 Multi-session management: create, switch, rename, search history
- 🔄 Live model switching: `/model <name>`, list models: `/models`
- 🧠 Reasoning visualization: `/reasoning show|hide`
- 📋 Project instructions: `/init` creates DRSAI.md, `/memory` view/reload
- 🔒 Workspace isolation: `/workspace on|off`
- ⚡ 30+ slash commands: type `/help` for the full list

### 2.3 Launch a Basic Agent (Code Mode)

Example: [examples/agent_groupchat/assistant_base_R1_oai.py](examples/agent_groupchat/assistant_base_R1_oai.py)

```shell
conda activate drsai
python examples/agent_groupchat/assistant_base_R1_oai.py
```

**NOTE**: Modify the startup method in `if __name__ == "__main__":` as needed.

**NOTE**: Additional examples include MCP tools, RAG, multi-agent collaboration, and multi-task execution.

### 2.4 Start Backend Service

```shell
cp .env.example .env
drsai ui
```

Default port: 8081. Use `drsai --help` for more options.

<video width="80%" controls>
  <source src="assets/video/drsai_ui.mp4" type="video/mp4">
</video>

[Download demo video](assets/video/drsai_ui.mp4)

**NOTE:**

* DrSai-General requires Docker (Python sandbox + browser VNC). See [docker](docker/README.md)

### 2.5 Frontend Setup

#### Configure npm Environment

Install node:

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node # recommended node version ~ 22
```

Install frontend dependencies:

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# *********NOTE：*********
# cp .env.default .env.development or .env.production
# Development: frontend/.env.development
# Production: frontend/.env.production
# ************************

# yarn build # build static assets
yarn run dev # start dev server
```

### 2.6 Desktop App 🆕

OpenDrSai includes an Electron desktop client with system tray support and remote connectivity:

```shell
drsai desktop    # Launch DrSai desktop client (under development...)
drsai gateway    # Start SSE gateway (for desktop client connection)
```

The desktop client can connect to local or remote DrSai backend services and stays resident in the system tray.

### 2.7 TUI Slash Commands Overview 🆕

In the TUI terminal mode, type `/help` to see all available commands. Key commands:

| Category | Command | Description |
| :--- | :--- | :--- |
| **Session** | `/new [name]` | Create a new session |
| | `/switch <id\|name>` | Switch to another session |
| | `/list` (`/ls`) | List all saved sessions |
| | `/resume <id\|name>` | Resume a previous session |
| | `/search <query>` | Search past sessions |
| | `/rename <name>` | Rename current session |
| | `/retry` | Retry the last message |
| | `/copy [n]` | Copy the n-th-to-last assistant reply |
| **Model** | `/model [name]` (`/m`) | Show/switch model (session-local) |
| | `/model_global [name]` (`/mg`) | Switch model and save as global default |
| | `/models` (`/listmodels`) | List all available models |
| **Display** | `/reasoning show\|hide\|low\|medium\|high` | Toggle or tune reasoning box |
| | `/verbose` | Toggle per-turn stats footer |
| | `/bell on\|off` | Ring terminal bell on response |
| | `/fast on\|off` | Switch to fastest model alias |
| **Project** | `/init` | Create DRSAI.md project instructions file |
| | `/memory show\|reload` | View/reload project instructions |
| **Workspace** | `/workspace on\|off` (`/ws`) | Toggle workspace restriction |
| | `/dangerous on\|off` (`/dg`) | Toggle dangerous command permission |
| | `/cd <path>` (`/workdir`) | Switch working directory |
| **Subagent** | `/agent <name\|list\|clear>` | Set/list subagents |
| | `/delegate <type> <prompt>` (`/sub`) | Delegate task to subagent |
| **Plan** | `/plan_mode on\|off` (`/pm`) | Toggle plan mode |
| | `/inject prefix\|suffix\|clear` | Inject custom prompts |
| **System** | `/setup` (`/env`) | Re-open setup wizard |
| | `/status` | Show agent and session status |
| | `/quit` (`/exit`, `/q`) | Save and exit |


## 3. Roadmap (TODO)

### 3.1 Agent Components

- [ ] Model layer: developing support for small models with special-format data, custom message types and events

~~-HepAI platform model integration, see examples/components/model_client01.py~~

- [ ] Perception layer: developing UTF-8 encoded text attachment parsing and chat context injection

- [ ] Memory layer: developing DrSaiChatCompletionContext long-term memory integration with RAGFlow, with automatic document_id creation

~~-Prompt-based long memory compression ChatCompletionContext, see examples/components/model_context01.py~~

- [ ] Knowledge base layer: developing LlamaIndex-compatible knowledge base components

~~-Component-based HepAI RAGFlow knowledge base integration, see examples/components/memory_ragflow01.py~~-

- [ ] Execution layer: 1. streaming output for MCP tool calls with frontend integration; 2. local function long task execution; 3. MCP long task concurrency and queuing

- [ ] State management: no further development planned, suggestions welcome

~~Extended long task state management; see _process_long_task_query in drsaiagent.py~~

- [ ] File management: developing file caching and injection system

- [x] Agent configuration management: no further development planned, suggestions welcome

~~Enhanced agent config with component-based snapshot recovery; see _to_config, _from_config, save_state, load_state in drsaiagent.py~~

- [ ] Agent learning system: async recording of agent responses and strategies into the agent knowledge base

- [x] Agent events & notifications: no further development planned, suggestions welcome

~~Frontend-backend message sync: ModelClientStreamingChunkEvent, AgentLogEvent, TaskEvent; see examples/agent_groupchat/assistant_custom_log_event-interaction.py~~

### 3.2 Professional Agents

- [ ] Long-task processing agent & tutorial: self-planning multi-tool component scheduler
- [ ] Deep retrieval agent & tutorial: long-memory + self-planning deep retrieval
- [ ] Multi-agent long-task system & tutorial

### 3.3 Multi-Agent Systems

- [ ] Long-task coordination architecture with background execution and real-time HCI

~~Long-task query multi-agent coordination system; see examples/agent_groupchat/groupchat_task_LongTask~~

- [ ] Multi-agent reflection and learning system
- [ ] Task-distribution-based multi-agent scheduler
- [ ] Remote multi-agent collaboration cases

### 3.4 Frontend & Backend

- [x] ✅ React/Ink TUI terminal interface (completed)
- [x] ✅ Electron desktop client (completed)
- [x] ✅ 30+ slash command system: session mgmt, model switching, reasoning viz (completed)
- [x] ✅ CLI config management (`drsai config`) (completed)
- [x] ✅ First-run setup wizard (completed)
- [x] ✅ Frontend task management display & interaction (completed)
- [x] ✅ Frontend execution file and log display (completed)
- [ ] UUID-based database IDs to replace auto-increment integers
- [ ] Auto cleanup of inactive agent instances to save resources
- [ ] Long task display & interaction in frontend
- [ ] Default login system
- [ ] Non-text/large file upload and agent ingestion via file system, supporting HepAI file system URLs
- [ ] RAGFlow knowledge base / memory + MCP remote function linking for agents (format per agent_config.yaml)

## 4. Contributing

We welcome contributions to OpenDrSai, including but not limited to:

- Code: agent/multi-agent component development, system examples, frontend UI development
- Documentation: agent/multi-agent docs, tutorials, FAQs
- Bug reports: bugs, feature requests, usage issues
- Community events: offline meetups, online seminars, knowledge sharing

## 5. Contact

- Email: <hepai@ihep.ac.cn> / <zdzhang@ihep.ac.cn> / <xiongdb@ihep.ac.cn>
- WeChat: xiongdongbo_12138


