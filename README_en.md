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

### 2.2 Launch a Basic Agent

Example: [examples/agent_groupchat/assistant_base_R1_oai.py](examples/agent_groupchat/assistant_base_R1_oai.py)

```shell
conda activate drsai
python examples/agent_groupchat/assistant_base_R1_oai.py
```

**NOTE**: Modify the startup method in `if __name__ == "__main__":` as needed.

**NOTE**: Additional examples include MCP tools, RAG, multi-agent collaboration, and multi-task execution.

### 2.3 Start Backend Service

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

### 2.4 Frontend Setup

```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node
```

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# cp .env.default .env.development or .env.production

yarn run dev
```

### 2.5 Run via Config (Optional)

```shell
drsai console --agent-config agent_config.yaml
drsai backend --agent-config agent_config.yaml
```

Example:

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

See: [Configuration Docs](docs/agent_factory.md)

## 3. Roadmap (TODO)

### 3.1 Agent Components

* Model layer: support special-format data models
* Perception: UTF-8 attachment parsing
* Memory: integration with RAGFlow
* Knowledge base: LlamaIndex compatibility
* Execution: streaming MCP tools, concurrency
* File system: caching and injection
* Learning system: async knowledge accumulation

### 3.2 Professional Agents

* Long-task planning agents
* Deep retrieval agents
* Multi-agent long-task systems

### 3.3 Multi-Agent Systems

* Long-task coordination
* Reflection systems
* Task schedulers

### 3.4 Frontend & Backend

* UUID database IDs
* Auto cleanup inactive agents
* Large file support
* Login system

## 4. Contributing

We welcome contributions:

* Code (agents, systems, UI)
* Documentation
* Bug reports & suggestions
* Community events

## 5. Contact

* Email: [hepai@ihep.ac.cn](mailto:hepai@ihep.ac.cn) / [zdzhang@ihep.ac.cn](mailto:zdzhang@ihep.ac.cn) / [xiongdb@ihep.ac.cn](mailto:xiongdb@ihep.ac.cn)
* WeChat: xiongdongbo_12138


