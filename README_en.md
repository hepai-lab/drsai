#### [简体中文](README.md) | English

# OpenDrSai

An integrated framework for rapid development and deployment of intelligent agents and multi-agent collaborative systems, developed by the [HepAI](https://ai.ihep.ac.cn/) team of the Institute of High Energy Physics, Chinese Academy of Sciences. It enables fast creation and deployment of intelligent agents and multi-agent systems with both frontend and backend services.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="Adaptation Logic Diagram">
  </p>
</div>

This framework is based on Microsoft’s open-source project [AutoGen](https://github.com/microsoft/autogen) (currently version 0.5.7). While maintaining full compatibility with AutoGen’s structure and ecosystem, it redesigns the components and development logic of agents and multi-agent systems to better support the development of **professional scientific agents and multi-agent systems 🤖 — such as complex multi-task execution 💡, state management and human-computer interaction 🙋‍♂️🙋‍♀️, professional scientific tool execution 🛠️, long-task management ⏰, and memory management 🧠**. It is highly compatible with mainstream MCP, A2A protocols, [HepAI](https://ai.ihep.ac.cn/) ecosystem components, and RAG architectures like RAGFlow. Moreover, it offers integrated development and deployment capabilities: agent or multi-agent system code can be launched with one command, registered as an OpenAI ChatCompletions or HepAI Worker API service. A supporting frontend enables direct development and deployment of complete end-to-end applications.

## 1. Features

* 1. Flexible switching between base models, tools, and knowledge bases on the [HepAI platform](https://aiapi.ihep.ac.cn/). Supports integration with OpenAI ChatCompletions, Ollama, and other model formats.
* 2. Predefined components for perception, reasoning, memory, execution, and state management, with a modular design allowing flexible extension for various professional agent applications.
* 3. One-click startup for human-computer interaction frontend and backend. Provides OpenAI ChatCompletions and OpenWebUI-Pipeline compatible backend APIs, allowing agents or multi-agent systems to serve as third-party model or agent APIs.

## 2. Quick Start

### 2.1. Install OpenDrSai

#### Install from source (recommended)

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/python/packages/drsai_ui && pip install -e . # for DrSai-UI human-computer interaction frontend
```

#### Install via pip

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
# NOTE: if you have installed openai>=1.99.0, please keep openai<=1.98.0
```

#### Configure HepAI API Access Key

Set the API key and environment variables for the [HepAI](https://aiapi.ihep.ac.cn) DDF2 platform (based on bash):

For Linux/Mac:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

For Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# NOTE: Windows environment variables take effect after restarting the computer
```

#### Agent Example Test

Take [examples/agent_groupchat/assistant_R1_oai.py](examples/agent_groupchat/assistant_R1_oai.py) as an example — it demonstrates how to quickly build an agent system using OpenDrSai.

```shell
conda activate drsai
python examples/agent_groupchat/assistant_R1_oai.py
```

**NOTE:** Modify the agent startup method in `if __name__ == "__main__":` as needed for testing.

**NOTE:** The `examples/agent_groupchat` directory contains additional examples of agents and multi-agent systems, including MCP tool integration, RAG integration, multi-agent collaboration, and multi-task execution.

### 2.2. Launch the OpenDrSai Human-Computer Interaction Backend

```shell
# pip install drsai_ui -U # ensure drsai_ui is installed

cp .env.example .env # copy .env.example to .env
drsai ui # start the Magenti-UI backend and static frontend
```

The backend and static frontend run on port 8081 by default. The following video demonstrates interaction with the R1_test agent launched in section 2.1:

<video width="80%" controls>
  <source src="assets/video/drsai_ui.mp4" type="video/mp4">
</video>

### 2.3. Run Agent / Multi-Agent Services via Configuration File

```shell
# pip install drsai_ui -U # ensure drsai_ui is installed
drsai console --agent-config agent_config.yaml # launch command-line mode agent/multi-agent service
drsai backend --agent-config agent_config.yaml # deploy as an OpenAI-format backend model service
```

**NOTE:**

* The `agent_config.yaml` file defines configurations for agents and multi-agent systems. You can use it to quickly create custom agent setups. Example:

```yaml
# Define your base model
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: openai/gpt-4o
    api_key: sk-****
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    max_retries: 10
# Assemble your agent
myassistant:
  type: AssistantAgent # agent type, provided by OpenDrSai or user-defined
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
```

See [agent configuration documentation](docs/agent_factory.md) for details. On our [AI Platform](https://drsai.ihep.ac.cn), you’ll find rich base models, MCP/HEPAI Worker tools, RAG memory plugins, and various predefined agent/multi-agent frameworks. You can flexibly choose components to rapidly build your own intelligent collaboration system. See `docs/agent_factory.md` for more details.

**NOTE:**

* The DrSai-General feature requires Docker for sandboxed Python and browser VNC containers. See [docker](docker/README.md) for Docker image setup and configuration.

### 2.4. Human-Computer Interaction Frontend

#### Configure npm Environment

Install Node.js:

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

# cp .env.default .env.development or .env.production # copy .env.default to .env.development or .env.production
# development env: frontend/.env.development
# production env: frontend/.env.production

# yarn build # build static frontend resources
yarn run dev # start frontend development server
```

## 3. Development Plan (TODO)

### 3.1. Agent Component Development

* [ ] Model layer: support for Anthropic Claude, Ollama, and other model formats
* [ ] Perception layer: default support for UTF-8 encoded text attachments and context injection
* [ ] Memory layer: develop ChatCompletionContext for long-term memory compression
* [ ] Knowledge base layer: develop HepAI RAGFlow-compatible modular knowledge components
* [ ] Execution layer: independent tool execution process with long-task management
* [ ] State management system: enhance long-task state tracking
* [ ] File management system: develop file caching and injection
* [ ] Agent configuration management: optimize configuration snapshots and modular management
* [ ] Agent learning system: record agent responses asynchronously for post-task learning
* [ ] Component scheduler: design self-planning, multi-tool execution scheduler agent

### 3.2. Multi-Agent System Development

* [ ] Multi-agent collaboration architecture
* [ ] Task management system
* [ ] Agent management system
* [ ] Multi-agent state management system
* [ ] Learning and reflection system
* [ ] Multi-agent coordination scheduler

### 3.3. Frontend and Backend Interaction

* [ ] Task management interaction in UI
* [ ] Display and interaction for execution logs and files
* [ ] Visualization of long-running task processes

## 4. Documentation

Detailed tutorials are in the `tutorials` directory (in progress, contact us for help):

```
tutorials/base01-hepai.md: Model configuration and usage on HepAI platform
tutorials/base02-worker.md: Remote function configuration using HEPAI Worker
tutorials/base03-use_claude-code.md: Using Claude-Code on the HepAI platform
tutorials/agents: Examples of agent/multi-agent systems
tutorials/components: Agent component development examples
tutorials/request: Client request examples
```

Documentation is available in the `docs` directory (in progress):

```
docs/develop.md: Guide for developing agent/multi-agent system code
docs/agent_factory.md: Open development and community guide for agent/multi-agent systems
docs/drsai_ui.md: User guide for the human-computer interaction frontend
docs/open-webui.md: Frontend access guide for OpenAI format and OpenWebUI Pipeline plugin
```

## 5. Contributing

We welcome contributions to OpenDrSai — including code, documentation, issue reports, and suggestions. You can contribute in many ways:

* **Code contributions:** agent/multi-agent components, system examples, frontend UI development
* **Documentation contributions:** tutorials, FAQs, and guides
* **Issue reporting:** bugs, feature requests, and usage feedback
* **Community engagement:** online/offline workshops, discussions, and sharing sessions

## 6. Contact Us

* Email: [hepai@ihep.ac.cn](mailto:hepai@ihep.ac.cn) / [zdzhang@ihep.ac.cn](mailto:zdzhang@ihep.ac.cn) / [xiongdb@ihep.ac.cn](mailto:xiongdb@ihep.ac.cn)
* WeChat: xiongdongbo_12138
* WeChat Group: *HepAI Large Model Tech Exchange Group 3*

<img src="assets/微信三群.jpg" alt="WeChat Group 3" style="max-width:20%; height:auto;">
