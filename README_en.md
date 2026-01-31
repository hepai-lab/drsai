# OpenDrSai Agent Development Framework

## English | [简体中文](README.md)

Developed by the HepAI team at the Institute of High Energy Physics, Chinese Academy of Sciences (CAS), this framework provides an integrated environment for rapid development and deployment of intelligent agents and multi-agent collaborative systems. It enables fast creation and deployment of backend and frontend services for your own agents and multi-agent systems.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="architecture overview">
  </p>
</div>

This development framework is based on Microsoft’s open-source project [AutoGen](https://github.com/microsoft/autogen) (version 0.5.7). While fully compatible with AutoGen’s architecture and ecosystem, OpenDrSai redesigns the components and development logic for agents and multi-agent systems to better support **professional scientific agents 🤖**, including: **complex multi-task execution 💡, state management and human–computer interaction 🙋‍♂️🙋‍♀️, scientific tool orchestration and execution 🛠️, long-task execution and monitoring ⏰, long/short-term memory handling 🧠**, etc.

It is also highly compatible with mainstream MCP and A2A protocols, the [HepAI](https://ai.ihep.ac.cn/) ecosystem, and popular RAG frameworks such as RAGFlow. With integrated development and deployment capabilities, agent or multi-agent system code can be launched with one command and registered as an OpenAI ChatCompletions API or a HepAI Worker service. A built-in human–computer interaction frontend allows rapid development of complete full-stack applications.

---

## 1. Features

* **1.** Flexible switching of base models and intelligent agent components—such as tools and knowledge bases—through the [HepAI platform](https://aiapi.ihep.ac.cn/). Compatible with OpenAI ChatCompletions, Ollama, and other model formats.
* **2.** Predefined and modularized components for perception, reasoning, memory, execution, and state management for both single-agent and multi-agent systems. Designed for extensibility and suitable for various professional scientific scenarios.
* **3.** One-click deployment of full-stack human–computer interaction services. Provides standardized backend interfaces compatible with OpenAI ChatCompletions and OpenWebUI-Pipeline, enabling agent systems to function as third-party model or agent APIs.

### 📢 Feature Comparison

|           Feature           |                                                                  OpenDrSai Agent Framework                                                                 |                                                         AutoGen                                                        |                            Camel AI                           |       LangChain      |                      AutoGPT                     |                   Dify.AI                  |
| :-------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------: | :------------------: | :----------------------------------------------: | :----------------------------------------: |
|  Framework Characteristics  | ✅ AutoGen-based, optimized for scientific tasks, strong extensibility & HCI support, visual & low-code construction of scientific agents and multi-agent systems | Dialogue-driven multi-agent architecture, modular, general-purpose, good ecosystem, but only basic framework functions | Role-play & heuristic prompting collaboration, good ecosystem |  Modular composition | Highly integrated agent/multi-agent architecture | Low-code drag-and-drop, weak extensibility |
|      Model Integration      |                                                      ✅ Supports scientific models and development strategies                                                     |                                           General-purpose model formats only                                           |                              Same                             |         Same         |                       Same                       |                    Same                    |
|    Scientific Data Access   |                                                             ✅ Scientific perception modules provided                                                             |                                                  Requires development                                                  |                              None                             |         None         |                       None                       |                    None                    |
|      Memory & Knowledge     |                                                  ✅ Modular knowledge integration & long-term intelligent memory                                                  |                                                  Requires development                                                  |                  ✅ Long-term memory included                  | Requires development |            ✅ Short + long-term memory            |        Built-in KB & message storage       |
|       Scientific Tools      |                                                 ✅ Supports MCP/OpenAPI/HepAI Worker, multiple tool access methods                                                |                              Only MCP tools + local functions; others require development                              |                        Multiple presets                       | Requires development |               Requires development               |          Built-in basic tools only         |
|    Reflection & Learning    |                                                                  ✅ Modular reflection & learning                                                                 |                                                  Requires development                                                  |                           ✅ Built-in                          | Requires development |                    ✅ Built-in                    |         Limited (mainly RAG-based)         |
|    State Management & HCI   |                                                            ✅ Full frontend–backend interaction support                                                           |                                                  Basic userproxy mode                                                  |                      Basic userproxy mode                     | Requires development |               Requires development               |                    None                    |
|     Long-task Execution     |                                                   ✅ Supports ultra-long scientific task monitoring & guardians                                                   |                                                          None                                                          |                              None                             |         None         |                       None                       |                    None                    |
|        Extensibility        |                                                                   ✅ Highly modular & extensible                                                                  |                                                        ✅ Modular                                                       |                           ✅ Modular                           |   Strong modularity  |                       Weak                       |                    Weak                    |
| Interactive App Development |                                                               ✅ Directly build deployable web apps                                                               |                                             Drag-and-drop in AutoGen Studio                                            |                         CAMEL Web App                         |   Needs external UI  |                 Needs external UI                |                Drag-and-drop               |

> Data as of: **2025-11-25**

---

## 2. Quick Start

### 2.1 Install OpenDrSai

#### Install via pip

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed hepai<=1.40.0, please keep openai<=1.98.0
```

#### Install from source

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # DrSai-UI frontend
```

#### Configure HepAI API Keys

Configure environment variables for the [HepAI](https://aiapi.ihep.ac.cn) DDF2 platform (bash example):

Linux/macOS:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# Note: Windows environment variables require a restart
```

**NOTE:** All OpenAI-format models can be connected using the same method. Other formats: see `tutorials/components/ModelClient01.md`.

---

### 2.2 Launch a Large-Model Agent Quickly

Using the example:
`examples/agent_groupchat/assistant_base_R1_oai.py`

```shell
conda activate drsai
python examples/agent_groupchat/assistant_base_R1_oai.py
```

**NOTE:** Modify the agent launch method inside

```python
if __name__ == "__main__":
```

as needed.

**NOTE:** Additional cases—including MCP integration, RAG integration, multi-agent collaboration, multi-task workflows—are available in `examples/agent_groupchat`.

---

### 2.3 Start the OpenDrSai HCI Backend (CLI)

```shell
# pip install drsai_ui -U
cp .env.example .env
drsai ui  # start backend + static frontend
```

The default port is **8081**.

Demonstration video:

<video width="80%" controls>
  <source src="assets/video/drsai_ui.mp4" type="video/mp4">
</video>

[Download Video](assets/video/drsai_ui.mp4)

**NOTE:**

* The **DrSai-General** feature requires Docker to run sandboxes and browser VNC. See: `docker/README.md`.

---

### 2.4 Frontend Setup

#### Install npm environment

```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node  # recommended ~22
```

Install frontend dependencies:

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# ********* NOTE *********
# cp .env.default .env.development or .env.production
# Dev env: frontend/.env.development
# Prod env: frontend/.env.production
# ************************

# yarn build
yarn run dev
```

---

### 2.5 Run Agents via Configuration Files (Optional)

```shell
drsai console --agent-config agent_config.yaml
drsai backend --agent-config agent_config.yaml
```

**NOTE:**

* `agent_config.yaml` defines agent/multi-agent configuration. Example:

```yaml
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: openai/gpt-4o
    api_key: sk-****
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    max_retries: 10

myassistant:
  type: AssistantAgent
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
```

For more details see `docs/agent_factory.md`.

On our platform: [https://drsai.ihep.ac.cn](https://drsai.ihep.ac.cn)
You’ll find model libraries, MCP/HepAI Worker tools, RAG memory plugins, agent frameworks, and presets.

---

## 3. Development Plan (TODO)

### 3.1 Agent Component Development

* [ ] Model Layer: support small models with special data formats; custom message/event types
* [ ] Perception Layer: support UTF-8 encoded text attachments and context injection
* [ ] Memory Layer: integrate DrSaiChatCompletionContext long-term memory with RAGFlow
* [ ] Knowledge Base Layer: compatibility with LlamaIndex
* [ ] Execution Layer: improve MCP tool streaming + frontend linkage
* [ ] State Management: no current plan
* [ ] File System: enhanced caching and injection
* [x] Agent Configuration System: stable
* [ ] Agent Learning: asynchronous experience logging after responses
* [x] Agent Events & Notifications: component completed

### 3.2 Professional Agents

* [ ] Long-task processing agent: planner + multi-tool scheduler

### 3.3 Multi-Agent Development

* [ ] Long-task–aware collaborative multi-agent architecture
* [ ] Learning & reflection across multi-agent systems
* [ ] Task dispatch scheduling
* [ ] Multi-remote-agent collaboration examples

### 3.4 Human–Computer Interaction Development

* [ ] Switch backend DB IDs to UUID
* [ ] Auto-cleanup idle agent instances
* [ ] Large file upload + agent access
* [ ] RAGFlow and remote MCP function binding
* [ ] drsai hub browsing & caching

---

## 4. Documentation

Training materials:
**OpenDrSai-tutorials-v3.pdf** (in `tutorials/`)

Tutorials (in development):

```
tutorials/base01-hepai.md
tutorials/base02-worker.md
tutorials/base03-use_claude-code.md
tutorials/agents
tutorials/components
tutorials/request
```

Documentation (in development):

```
docs/develop.md
docs/agent_factory.md
docs/drsai_ui.md
docs/open-webui.md
```

---

## 5. Contributing

We welcome contributions of all kinds, including:

* Code contributions
* Documentation and tutorials
* Bug reports, feature requests
* Community events and sharing

---

## 6. Contact

* Email: [hepai@ihep.ac.cn](mailto:hepai@ihep.ac.cn) / [zdzhang@ihep.ac.cn](mailto:zdzhang@ihep.ac.cn) / [xiongdb@ihep.ac.cn](mailto:xiongdb@ihep.ac.cn)
* WeChat: xiongdongbo_12138
* WeChat Community Group (HepAI大模型技术交流3群):

<img src="assets/微信三群.jpg" alt="微信群" style="max-width:20%; height:auto;">
