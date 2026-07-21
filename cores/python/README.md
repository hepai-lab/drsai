# OpenDrSai

An integrated framework for rapid development and deployment of agents and multi-agent systems, developed by the [HepAI](https://ai.ihep.ac.cn/) team at the Institute of High Energy Physics, Chinese Academy of Sciences. It enables the fast creation and deployment of backend and frontend services for customized agent and multi-agent collaboration systems.

<div align="center">
  <p>
      <img width="30%" src="assets/drsai.png" alt="Adaptation Logic Diagram">
  </p>
</div>

This framework adopts the **BAMS (Brain-Actuators-Memory-Sensors) architecture**, with Brain as the core reasoning engine, Actuators for tool orchestration and task execution, Memory for long/short-term context management, and Sensors for external data and model integration. It redesigns the components and development logic of agent and multi-agent systems, making it more suitable for building **professional scientific agents and multi-agent systems 🤖: such as complex multi-task execution 💡, state management and human-computer interaction 🙋‍♂️🙋‍♀️, professional scientific tool management and execution 🛠️, long-duration task execution ⏰, and memory management 🧠**.

It ensures strong compatibility with mainstream MCP and A2A protocols, the [HepAI](https://ai.ihep.ac.cn/) ecosystem, and RAGFlow as a representative RAG architecture. Furthermore, it provides integrated capabilities for both development and deployment: agent or multi-agent system code can be launched with a single command, registered as an OpenAI ChatCompletions format service or HepAI Worker service, and directly exposed as an API. Together with the bundled human-computer interaction frontend, developers can rapidly build and deploy complete end-to-end applications.

## 1. Features

* Flexible switching of base models for agents via the [HepAI platform](https://aiapi.ihep.ac.cn/), along with dynamic configuration of components such as tools and knowledge bases. Supports integration of OpenAI ChatCompletions, Ollama, and other model formats.
* Provides pre-defined components for perception, reasoning, memory, execution, and state management in agent and multi-agent systems. These are plugin-based and extensible, supporting a wide variety of professional agent design use cases.
* Offers a one-click launch for human-computer interaction frontends and backends, enabling immediate application deployment. Compatible backend interfaces (OpenAI ChatCompletions, OpenWebUI-Pipeline) allow the system to be served as a third-party model or agent API.

## 2. Quick Start

### 2.1 Install OpenDrSai

#### From source (recommended)

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://code.ihep.ac.cn/hepai/drsai drsai

cd your/path/to/drsai/cores/python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd your/path/to/drsai/apps/webui/backend && pip install -e . # for DrSai-UI human-computer interaction frontend
```

#### Install via pip

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai drsai_ui -U
```

#### Configure HepAI Platform API Key

Set the environment variables for the [HepAI](https://aiapi.ihep.ac.cn) DDF2 platform API key (based on bash):

Linux/macOS:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

Windows:

```shell
setx "HEPAI_API_KEY" "your_api_key"
# Note: Windows environment variables require a restart to take effect
```

#### Agent Example Test

See [examples/oai_client/assistant_R1_oai.py](examples/oai_client/assistant_R1_oai.py) for a demonstration of quickly developing an agent system with OpenDrSai.

### 2.2 Launch Human-Computer Interaction Frontend

#### Configure npm environment

Install Node.js

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node
```

Install frontend dependencies

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# cp .env.default .env.development or .env.production # copy .env.default to .env.development or .env.production
# Development variables: frontend/.env.development
# Production variables: frontend/.env.production

# yarn build # build frontend static resources
yarn run dev # start frontend development environment
```

### 2.3 Start OpenDrSai Service via CLI

```shell
# pip install drsai_ui -U # ensure drsai_ui is installed

cp .env.example .env # copy .env.example to .env
drsai ui # start Magenti-UI backend and static frontend

drsai console --agent-config agent_config.yaml # start CLI-based agent/multi-agent service
drsai backend --agent-config agent_config.yaml # deploy agent/multi-agent as OpenAI-compatible backend service
```

**NOTE:**

* The `agent_config.yaml` file defines configuration information for agents and multi-agent systems. It allows quick setup for testing, or for frontend users to customize their agents. Example:

```yaml
# Define your base agent model
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: claude-sonnet-4-6
    api_key: ${HEPAI_API_KEY}
    base_url: https://aiapi.ihep.ac.cn/apiv2

agent_config:
  - name: assistant
    type: AssistantAgent
    model_context: DrSaiChatCompletionContext
    model_client: *client
    tools:
      - provider: drsai.modules.components.tool.get_current_time
    memory:
      - provider: drsai.RAGFlowMemory
```

## 3. Development

### 3.1 Core Package (dr-sai)

The core package is located at `cores/python/packages/drsai/`.

```shell
cd cores/python/packages/drsai
pip install -e ".[all]"
```

### 3.2 Testing

```shell
cd cores/python/packages/drsai
python -m pytest tests/
```

## 4. Documentation

For full documentation, visit [OpenDrSai Docs](https://docs-drsai.ihep.ac.cn/).

## 5. License

This project is licensed under the terms of the LICENSE file in the repository.
