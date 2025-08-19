# A Complete Practical Guide to AI Agents

---
![](https://note.ihep.ac.cn/uploads/ccf0779c-c944-4b3a-a44f-e3c32452487f.png)


[TOC]

## 1. Introduction
An agent is any entity (robot or program) that perceives its environment and acts autonomously to achieve goals. It operates with agency, reacting to changes and making decisions without constant oversight. An AI agent is essentially an intelligent software assistant that can autonomously pursue goals and perform tasks on our behalf. In practice, an AI agent combines advanced AI techniques (like language understanding, reasoning, and planning) with practical tools or APIs to solve problems. It has the capabilities to autonomously solve complex problems. Traditional agents (e.g., control scripts) follow static and predefined rules with limited adaptability. AI agents use dynamic reasoning (e.g., LLMs) to handle unstructured inputs such as natural language, learn from context, and chain tools for multi-step problem-solving. E.g., Traditional agents execute fixed commands ("If temperature > 30°C, then turn on AC"). AI agents interpret goals ("Keep the room comfortable") and devise custom solutions (adjusting the AC, checking the weather, and suggesting clothing). By the end of this guide, you'll be able to define an AI agent, identify its core components, and implement a simple single‑agent and multi-agent system in Python.

### 1.1 Why Build an AI Agent?
AI agents are autonomous systems designed to perceive their environment, reason about tasks, and take actions to achieve specific goals. Unlike static programs, AI agents can make decisions, adapt to new situations, and interact intelligently with users or other systems. They are increasingly important as we shift from traditional automation toward systems capable of handling dynamic, complex tasks. Their ability to mimic goal-driven human behavior, such as prioritizing, planning, and acting, makes them powerful tools for solving real-world problems. To build an AI agent, it is recommended to gain some prior knowledge about LLM, such as how LLM works and how it processes and generates natural language.

### 1.2 LLM-based Agent
Recent advances in Large Language Models (LLMs), such as GPT-4, HepAI, Claude, etc., have significantly enhanced the capabilities of AI agents. These models serve as the agent's "brain," enabling it to understand natural language, reason through instructions, and generate context-aware responses. LLMs also allow agents to work flexibly across domains without task-specific training, enabling more general-purpose, adaptable systems. An LLM-based agent typically integrates the model with tools (like web search or calculators), memory, and a coordination framework to perform multi-step reasoning and execution.

### 1.3. Real-world Scenarios
AI agents are already in use across various fields. In personal productivity, agents manage calendars, schedule meetings, and summarize emails. In software development, agents assist with coding, debugging, and documentation. In research and education, they help users retrieve, synthesize, and explain complex information. In business, agents automate workflows, respond to customer inquiries, and analyze large datasets. These practical applications highlight the potential of agents to improve efficiency, decision-making, and creativity.

## 2. Core of AI Agent

LLM-powered agents can plan, reason, and execute complex multi-step tasks with minimal supervision. The basis of an AI agent is:

![](https://note.ihep.ac.cn/uploads/2cc86283-460b-48c3-9ac2-ff92bbf82a25.png)

They combine real-world awareness, adaptive intelligence, and targeted action to solve problems without constant human guidance.

### 2.1. Definitions -- Classic Agent to Modern LLM Agent

The concept of an "agent" originates from early artificial intelligence research, where an agent was defined as an entity that perceives its environment and acts rationally to achieve goals. In classical AI, agents employed symbolic reasoning and rule-based decision systems, which were often brittle and task-specific. With the evolution of machine learning, particularly reinforcement learning, agents became more adaptive and capable of learning from interaction. Today, with the rise of Large Language Models (LLMs), the agent concept has transformed further: modern LLM-based agents can interpret natural language, plan multi-step solutions, and take autonomous actions. In essence, a modern AI agent combines goal orientation, contextual understanding, and action execution, often supported by APIs or tools.

When evaluating areas where modern LLM agents can bring value, prioritize workflows that were previously difficult to automate, especially where traditional methods encounter resistance:

| No. | Area | Description |
|-----|------|-------------|
| 1 | Complex decision-making | Workflows that involve fine-grained judgments, exceptions, or context-dependent decisions, such as refund approvals in customer service workflows. |
| 2 | Rules that are difficult to maintain | The system becomes difficult to manage due to the large and complex rule set, making updates expensive and error-prone, such as vendor security reviews. |
| 3 | High reliance on unstructured data | Scenarios that require interpreting natural language, extracting meaning from documents, or interacting with users in a conversational manner, such as handling a home insurance claim. |

### 2.2. Core Components (perception, reasoning, action)

At the heart of any AI agent lie three essential components:

- **Perception**: The ability to observe and interpret inputs from its environment. This could be user queries, documents, web data, or system states. For example, an agent might perceive a user's instruction: "*Find the cheapest flight from Dhaka to Beijing*."

- **Reasoning**: Once data is perceived, the agent uses logic and inference, often powered by an LLM, to plan steps or choose actions. In our example, the agent may compare airlines, filter by price and date, and evaluate user preferences.

- **Action**: The agent executes a task, such as querying an API, generating a response, or triggering a system command. This ability to act in the world (not just talk) is what distinguishes agents from simple language models or chatbots.

![](https://note.ihep.ac.cn/uploads/f1673fa3-819c-437c-83d8-d5d50fe7e5ee.png)

Perception feeds data to Reasoning, which triggers Action. Action generates new data (e.g., API results), looping back to Perception. This Perception → Reasoning → Action loop allows the agent to interact dynamically with users and systems, adapt to new tasks, and produce meaningful outputs.

### 2.3. Agent Categories

AI agents can be categorized based on how they handle perception and reasoning:

- **Reactive Agents**: These respond directly to inputs with predefined behaviors. They don't plan or model the environment. Example: a spam filter that labels emails based on keywords.

- **Deliberative Agents**: These build an internal model of the world and use it to plan and reason. They are goal-driven and can evaluate consequences before acting. Most LLM-based agents fall under this category.

- **Hybrid Agents**: These combine reactive responses with deliberate planning. For instance, an assistant who quickly answers FAQs (reactive) but also books a multi-stop flight itinerary (deliberative).

Understanding this taxonomy helps determine how complex or autonomous an agent can be, and which design fits the task at hand.

### 2.4. LLM Enhanced

The integration of Large Language Models (LLMs) into AI agents marks a turning point in how these systems operate and reason. Traditional agents relied on rule-based logic or manually engineered decision trees to act, which often made them rigid, domain-specific, and unable to generalize. LLMs change this by acting as the agent's cognitive engine, allowing it to reason, plan, and communicate using natural language.

- Interpret ambiguous natural language instructions.
- Maintain context across multiple interactions.
- Generate structured outputs (e.g., JSON, API calls).
- Simulate reasoning through chain-of-thought prompts.
- Delegate tasks through tools and external APIs.

An LLM serves as the agent's "brain," allowing flexible thinking, summarization, translation, and even code generation. For example, GPT-4 can act as a planner in a travel assistant agent or a code reviewer in a dev agent. Crucially, the LLM doesn't work alone; it coordinates with tools, memory, and logic modules to reason and act effectively

### 2.5. Single-Agent vs Multi-Agent System

A single-agent system involves one autonomous agent handling all tasks. It's ideal for simple, focused problems like answering questions or summarizing documents. However, as tasks become complex and multi-domain, a multi-agent system becomes useful. Here, multiple agents each with specific roles, collaborate. For instance:

- One agent may gather data.
- Another may analyze or verify.
- A coordinator agent may plan and delegate subtasks.

![](https://note.ihep.ac.cn/uploads/04bfad3c-fcc2-4ac7-a867-84380da565f4.png)

| Aspect | Single-Agent System | Multi-Agent System |
|--------|--------------------|--------------------|
| Structure | One agent handles all tasks. | Multiple agents collaborate, each with a specific role. |
| Complexity | Simpler to design, deploy, and debug. | More complex, as it tackles complex and distributed problems (e.g., supply chains). |
| Task Handling | Best for focused, linear tasks. | Suitable for complex, multi-step, or domain-diverse tasks. |
| Communication | No inter-agent messaging needed. | Requires communication protocols between agents. Agents negotiate to align goals. |
| Scalability | Limited flexibility and growth. | Highly scalable and adaptable to larger systems. |
| Use Cases | Personal assistants, chatbots. | Smart cities, financial trading teams, and swarm robotics. |

Multi-agent systems simulate team dynamics, allowing agents to negotiate, share knowledge, and solve problems in parallel, resulting in faster and more robust solutions.

## 3. Fundamentals of Agent Design

### 3.1. Core Foundation

All AI agents share the same foundational components, regardless of framework or implementation. In its most basic form, an agent consists of three core components:

![](https://note.ihep.ac.cn/uploads/5a1ad01b-f3b1-40d6-9dc8-98b74ccc0701.png)

- **Model**: Large language models (LLMs) that power agents (serve as the "brain"), enabling them to interpret goals with reasoning and decision-making. They process natural language inputs, break down complex tasks into logical sequences, and determine when and how to use tools. Unlike static algorithms, modern LLMs adapt to context, learn from interactions, and generate human-like responses, allowing agents to handle ambiguity and open-ended problems.
- **Tools**: Tools are external functions or APIs that give agents the ability to take action. By integrating tools, agents transform from conversational chatbots into proactive problem-solvers that interact with the digital world, automating workflows, analyzing live data, or managing resources without human intervention. For instance, a tool could be a weather API or database query; the agent learns its signature from the prompt.
- **Instructions (system prompts)**: These are the embedded guidelines that define the agent's behavior. The system prompt explicitly defines the agent's role, capabilities, and constraints. For example, the prompt might say "*You are a helpful agent who can talk to users about the weather*" and list permitted actions. These instructions direct the LLM's output by setting its role, tone, and rules for action.

In this practical guide, we aim to use HepAI. Here's a code example of creating an agent function. Learner can also implement the same concept using their preferred libraries or build directly from scratch. We will explain the whole process of creating an agent by using HepAI from scratch.
```python
AssistantAgent(
    name="weather_agent",
    system_message="You are a helpful agent who can talk to users about the weather.",
    tools=[web_fetch_tool],
)
```

### 3.2. Selection of Model (LLM)
Choosing the LLM is a critical decision because the model is the agent's brain. Different use cases demand different model capabilities. For example, some agents require high accuracy and deep reasoning, while others prioritize speed or handling very long inputs. As we'll see in the next section on agent orchestration, users may want to consider using multiple models for different tasks in their process.

It's important to recognize that not every task demands the most powerful model. Lightweight models are typically sufficient for straightforward tasks such as information retrieval or intent classification. More complex tasks, such as deciding whether to approve a refund, may benefit from a more powerful model.

One effective approach is to use the most powerful model for each task when building agent prototypes to establish performance benchmarks. Then, try replacing them with smaller models to see if they still achieve acceptable results. This way, you don't limit the agent's capabilities too early, and you can diagnose where smaller models succeed or fail.

In summary, the principle of choosing a model is simple:

- Set up evaluations to establish performance benchmarks.
- Focus on using the best model to meet your accuracy goals.
- Optimize cost and latency by replacing larger models with smaller ones.

For choosing models, HepAI offers multiple options with various LLM models. As we aim to use HepAI for our AI agent guide, here is simple code to get the available models from HepAI.

```python
from hepai import HepAI

client = HepAI(api_key="Your_API_Key")
models = client.models.list()

for model in models:
    print(model)
```
You may get a little puzzled here as thinking of what HepAI is. Don't worry, you will get a detailed guide of HepAI from here.

### 3.3. MCP Protocol (Agent Communication Logic)

The Model Context Protocol (MCP) is a standardized client-server interface that lets an LLM-based agent connect to data sources and tools. It standardizes how AI systems, particularly large language models (LLMs), integrate and share data with external tools, systems, and data sources. Think of MCP as a "USB‑C type port for AI": the agent (MCP client) can plug into many different tools (MCP servers) without changing how the model itself operates. Under MCP, the system is split into roles:
- **MCP Client**: The AI program or model that sends queries and instructions.
- **MCP Server**: A separate service that provides one or more tools (for example, a web-search server with a "*web_search(query)*" function).

In practice, the agent first asks each MCP server what tools it provides (often by calling a "*tools()*" function). This tells the LLM which function calls it can make. When the model decides to use a tool, it will output something like "*web_search('latest news on Mars')*." The MCP framework then forwards that request to the correct server. he server runs the function (for example, performing the web search) and returns the result. The agent adds the returned information into its context, and the LLM continues reasoning with that new data.

Many common services have existing MCP server implementations (weather agent, calendars, web search, etc.) This makes the system very modular and flexible. You can add or swap tools easily by plugging in new MCP servers. For instance, if you need a new database query capability, just run a database-service MCP server. The model will see the new tool (when "*tools()*" is called again) and can start using it immediately. Also, because MCP separates the model from the tools, you could switch to a different LLM backend and still use the same servers.
An elementary code example for MCP:
```python
mcp_server_tools(
    StdioServerParams(
        command="uvx",
        args=["run", "mcp-server-fetch"],
        env=None)))
```
The reader or learner may find this code slightly different from the available example online. This is not the case; we are using HepAI, which offers a predefined method for using the MCP protocol. We will explore the practical applications of defining tools using the MCP server in a later section.

### 3.4. Defining Tools

Language models alone have fixed training knowledge and no external access, so "tools" let an agent do things the model itself can't. A tool is simply a program or API that the agent can call (for example, to search the web, get live data, or run code). By giving the agent tools, it can fetch real-time information or perform exact calculations instead of guessing. In practice, this means the LLM can delegate tasks it can't handle directly (like "What is the weather in Beijing?" or "execute a Python script") to specialized code. For instance, a tool could fetch live data (weather, stock prices, news) or run a safe computation. This greatly extends an agent's capabilities, as one explanation puts it, it "allows LLMs to extend their capabilities by interfacing with external tools and APIs". In business area, tools let agents integrate with systems (CRM, databases, etc.) and automate actions (sending emails, updating tickets) that a plain LLM could never do on its own.

In HepAI's agent framework, tools are registered with the agent and invoked automatically when needed. For example, using the HepAI-based Dr.Sai agent system, you write a tool as a normal "*async*" Python function and give it to the agent. In code, you pass a list of tool functions to the agent constructor (for example, "*tools=[get_weather]*"). Internally, the agent then provides the model with the tool's name, description, and parameter schema so the LLM knows how to call it. When the model generates output like "*get_weather("Beijing")*", the HepAI runtime intercepts that, calls the actual *get_weather* function with the argument, and returns the result into the conversation. This general function‐calling workflow: the app sends the user prompt and tool definitions to the LLM; the LLM replies with a function name and arguments in JSON; the app executes that function; then the result is passed back to the LLM to produce the final answer. In code, registering a tool might look like this by using Dr.Sai:
```python
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73°F and sunny."

agent = AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    tools=[get_weather],  # register our tool function here
    system_message="You can use get_weather(city) to fetch weather info.",
    reflect_on_tool_use=False
)
```
Here, "*get_weather*" is the tool function, and adding it to "*tools=[get_weather]*" makes it available to the agent. HepAI handles the rest: whenever the LLM decides to use "*get_weather*", the system runs that function with the given city and returns its string result to the agent.

In general, agents need the following three types of tools:
| Types | Description | Example |
|-------|-------------|---------|
| Data Tools | Enables agents to retrieve the context and information needed to execute workflows. | Read PDF documents, or perform web searches, query databases, or CRM systems. |
| Operation Tools | Enables agents to interact with the system to perform actions. | Call up scientific tools, parse results, add new information to the database, update records or send messages, send emails and text messages, and transfer customer service tickets to human processing. |
| Orchestration Tools | The agent itself can serve as a tool for other agents - see "Manager Mode" in the "Agent Orchestration" section | Research agents, writing agents, refund agents. |

The HepAI framework (as shown above) makes it straightforward to plug in these tools: you write or import the function, add it to "*tools=[...]*", and the agent learns how and when to use it during conversation. As the number of tools required increases, consider splitting tasks across multiple agents.

### 3.5. Configuration Instructions (system prompts)

The system prompt, also called "agent instructions," is the textual program that defines an AI agent's identity, behavior, and workflow. High-quality instructions (system prompts) are essential for any large language model (LLM) based application, especially for agents. This hidden instruction precedes any user input and "*defines the AI's role, behavior, and response style*". Clear instructions reduce ambiguity and enhance agent decision-making, leading to smoother workflow execution and fewer errors. The system prompts are for: 
- **Sets the Agent's Role**: Establishes its identity and expertise (e.g., "*You are a helpful agent who can talk to users about the weather and web content*").
- **Defines Workflow**: Outlines the steps the agent should follow to complete a task.
- **Enforces Boundaries**: Lists rules or limits (e.g., "*Always verify with the user before making changes*").
- **Handles Surprises**: Pre-plans how to respond if something goes wrong or is unclear.

The best practices of defining the system prompts messages:
- **Use existing guides**: Start with the documents you already have standard operating procedures, training manuals, or policy notes. Turn each section into clear steps your agent can follow. For example, if your customer‑service team has 10 FAQ articles, map each one to a simple action (like "look up shipping policy" or "explain return process").
- **Break task steps**: Providing smaller, clearer steps from complex resources can help reduce ambiguity and help the model better follow instructions.
- **Clearly defined actions**: Ensure that each step in the process corresponds to a specific action or output. For example, a step can instruct an agent to ask the user for an order number or call an API to get account details. Explicit actions reduce the likelihood of misinterpretation.
- **Plan for unexpected cases**: Think about what could go wrong or be missing, and write instructions for those scenarios. Such as how to deal with users when they provide incomplete information or ask unexpected questions. A robust process should anticipate common important situations and contain instructions to handle them, such as through conditional steps or branches (or alternative steps if necessary information is missing). 

A code example of the system prompts;
```python
# System prompt defining role, guidelines, and steps
system_message = """
You are a customer-support agent.

1. Ask the user for their order number.
2. Use get_order_status(order_id) to fetch shipment details.
3. If order is delivered, offer to close the ticket.
4. If order is delayed, call initiate_refund(amount, order_id).
5. Always cite the tool call in your response.
6. If input is unclear, ask for clarification.
"""

agent = AssistantAgent(
    name="support_bot",
    model_client=model_client,
    tools=[get_order_status, initiate_refund],
    system_message=system_message,
    reflect_on_tool_use=False
)
```

### 3.6. Agent Orchestration

Agent orchestration refers to the coordination of multiple agents (or modules) to achieve a larger goal. In a multi-agent system, there is typically an orchestrator  (often itself an agent or a controlling framework) that manages the workflow. With the foundation components in place, you can consider using orchestration patterns to enable your agent to execute workflows effectively. In practice, orchestration works like a "digital symphony": the orchestrator acts as a conductor, activating each specialized agent at the right time. In general, orchestration patterns fall into two categories:
- **Single-agent system**: A single model equipped with the appropriate tools and instructions executes the workflow in a loop.
- **Multi-agent system**: The execution of the workflow is distributed among multiple collaborative agents.

This orchestration makes complex workflows possible. Let's explore each mode in detail.

## 4. Single-agent System

A single‑agent system uses one autonomous agent to handle a complete task from start to finish. It is the simplest way to turn an LLM into a working assistant: you wrap one agent around your model, give it a handful of tools, and drive everything from a single "brain."

![](https://note.ihep.ac.cn/uploads/eec46330-6dd1-49d1-a674-7eff59fc6a79.png)

As we aim to do so, we'll focus on building a single-agent solution using HepAI (the agent framework) and Drsai (the *AssistantAgent* implementation), along with MCP integration for multiple tools.

### 4.1. Overview of HepAI and Drsai

HepAI is a lightweight Python SDK that turns any compatible large language model into a configurable AI agent. It handles the model connection (*HepAIChatCompletionClient*), lets you register simple Python functions as "*tools*," and automatically routes the model's tool calls, all via an asynchronous API.

Drsai builds on HepAI with a ready‑made *AssistantAgent* class that bundles model setup, tool registration, and prompt management into one interface. With Drsai, you define your system prompt and tool functions, instantiate *AssistantAgent*, and call "*tools*" to start interacting no extra plumbing required.

The installation process of HepAI and Drsai is really simple. We just need VSCode (IDE), Conda, and Python (version 3.12). Here, we'll demonstrate the whole process step by step: Create a virtual environment first (Conda recommended) and install HepAI and Drsai;
```bash
conda create -n drsai python=3.12
conda activate drsai
pip install hepai
pip install drsai
```
*Note*: Here, "*drsai*" is the name of the virtual environment. You can use your preferred name, such as "*agent*", "*project*", etc.
You can create and obtain a [HepAI Platform API Key](https://ai.ihep.ac.cn/) here.
You can find a detailed guide to selecting HepAI models and the guide to create HepAI API key [here](https://note.ihep.ac.cn/s/Ud7Vlhaxf).

### 4.2. Implementation with HepAI and Drsai

In this section, we'll build a working single‑agent system step by step, using *HepAI's HepAIChatCompletionClient* together with Drsai's *AssistantAgent*. You'll see how to configure your model client, register tools, write a system prompt, and run a simple chat loop, everything you need to get a HepAI agent up and running locally. A code example:
```python
from drsai import tools_recycle_reply_function

AssistantAgent(
    name="weather_agent",
    tools=tools,
    system_message="You are a helpful assistant.",
    reply_function=tools_recycle_reply_function,
)
```
You can even define multiple related tools, let the agent plan according to specific tasks, and call multiple tools in turn to decompose and execute complex tasks, for which you only need to add a line: 
```
"reply_function=tools_recycle_reply_function".
```
Now the question is, how can we build a single-agent system from scratch? To start the practical implementation, we have already created a virtual environment by using conda and installed HepAI along with Drsai. Let's code the implementation step by step:
**Step 1**: We'll start with importing the required classes, beginning with the asynchronous event loop and the HepAI/Drsai classes:
```python
import asyncio
from drsai import AssistantAgent, HepAIChatCompletionClient
```
- "*asyncio*" lets us run our agent code in a non‑blocking way.
- "*HepAIChatCompletionClient*" manages all communications with the chosen LLM (cloud or local).
- "*AssistantAgent*" ties together the model client, tools, and system prompt into one agent object.

**Step 2**: Create a *HepAIChatCompletionClient* instance. If you have an API key, pass it here; otherwise, you can point to a local model (see Section 4.1 for details).
```python
model_client = HepAIChatCompletionClient(
    model="openai/gpt-4o",
    api_key="API_KEY"
    # base_url = "http://192.168.32.148:42601/apiv2"
)
```
**Step 3**: Define the tools that the agent will use.

```python
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."
```
**Step 4**: Combine the *model_client*, *tools,* and *system_prompt_message* into *AssistantAgent*.

```python
return AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    tools=[get_weather, duckduckgo_search],
    system_message="You are a helpful assistant.",
    reflect_on_tool_use=False,
    model_client_stream=True,  # Enable streaming tokens from the model client.
)
```
**Step 5**: We are almost done. Here is the full code example of a single-agent system with a single tool integrated.

```python
from drsai import AssistantAgent, HepAIChatCompletionClient, run_console
import asyncio

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        api_key="API_KEY"
        # base_url = "http://192.168.32.148:42601/apiv2"
    )
    
        # Define a simple function tool that the agent can use.
    # For this example, we use a fake weather tool for demonstration purposes.
    async def get_weather(city: str) -> str:
        """Get the weather for a given city."""
        return f"The weather in {city} is 73 degrees and Sunny."

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        tools=[get_weather],
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )
        
asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in Beijing?"))
```
The *create_agent()* function spins up a new *AssistantAgent* with a *HepAIChatCompletionClient* (using GPT‑4o by default) and a simple *get_weather(city)* tool registered in *tools=[get_weather]*. Its behavior is set by the system_message ("*You are a helpful assistant.*"), and *model_client_stream=True* enables live token streaming. Finally, *run_console(...)* starts an interactive session first asking "*What is the weather in Beijing*?" and then letting you chat further, with the agent calling *get_weather("Beijing")* under the hood.

### 4.3. MCP for Single Agent

In a single‑agent setup, you can use the Model Context Protocol (MCP) to plug in both pre‑built and custom tools seamlessly. MCP let's your agent treat external services (like web‑fetch or HTTP clients) just like any other function, without changing the core agent logic. Here's how it works in HepAI/Drsai:
- **Start MCP Servers for Built‑In Tools**: Use *mcp_server_tools()* to launch external tool providers (MCP servers). Each server exposes a set of tools such as HTTP fetch, file I/O, or database queries over a simple standard interface. The agent discovers these tools at startup and can call them on demand.
- **Register Custom Tools**: You still define your *async* functions (for example, *get_weather(city)* or *duckduckgo_search(query)*), and *append* them to the same *tools* list. MCP and HepAI then present both external and custom tools uniformly to the LLM.
- **Build the Agent**: Supply the combined tools list to *AssistantAgent* along with your system prompt. The agent's "*brain*" (the LLM) will decide at runtime which tool to invoke, whether it came from an MCP server or your code, based on the user's request.
- **Run and Stream**: Finally, use *agent.run_stream(task=...)* wrapped in Drsai's *Console* to launch an interactive session. As the model generates tool calls, HepAI intercepts them, executes the corresponding MCP or custom function, and feeds the results back for the LLM to incorporate into its response.

The sample code example:

```python
import asyncio
from drsai import AssistantAgent, HepAIChatCompletionClient, StdioServerParams, mcp_server_tools, Console
from duckduckgo_search import DDGS

async def main():
    # Gather tools list
    tools = []

    # Fetch MCP‑provided web‑fetch tools
    tools.extend(await mcp_server_tools(
        StdioServerParams(
            command="uvx",
            args=["mcp-server-fetch"],
            env=None)
    ))
    
    # Add custom tools
    async def get_weather(city: str) -> str:
        return f"The weather in {city} is 73°F and sunny."

    tools.append(get_weather)

    async def duckduckgo_search(query: str) -> str:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=3):
                results.append(f"{r['title']}\n{r['body']}\n{r['href']}")
        return "\n\n".join(results) or "No results found."

    tools.append(duckduckgo_search)
    
    # Instantiate the agent with all tools
    agent = AssistantAgent(
        name="web_agent",
        model_client=HepAIChatCompletionClient(api_key="YOUR_API_KEY"),
        tools=tools,
        system_message="You are a helpful assistant with web and weather tools.",
        reflect_on_tool_use=False,
        model_client_stream=True
    )

    # Run interactive console sessions
    await Console(agent.run_stream(task="What is the weather in New York?"))
    await Console(agent.run_stream(task="What is the best school in the world?"))

if __name__ == "__main__":
    asyncio.run(main())
```
This approach keeps your agent code clean: you never modify the core logic to add or swap tools just register new MCP servers or append custom functions, and the agent adapts immediately.
You can find more predefined [MCP](https://github.com/modelcontextprotocol/servers) tools here.

### 4.4. Best Practices

For a robust single-agent setup, keep your system prompt short and structured, using just 3-5 clear, numbered steps and listing only the tools the agent truly needs. Register each tool one at a time in HepAI/Drsai, test it thoroughly (including edge cases and timeouts), and ensure failures return friendly error messages rather than crashing. Log every tool call and the agent's decisions so you can spot misfires and refine your prompts. Store both prompts and tool definitions in version control, and regularly review user interactions to tweak instructions or replace underperforming tools. By focusing on simplicity, testing, and continuous refinement, you'll maintain a predictable, maintainable single‑agent system.

## 5. Multi-agent System

A multi-agent system coordinates multiple AI agents (each with specialized roles) to solve complex tasks that a single agent couldn't handle alone. Like a team of experts collaborating on a project, each agent follows custom system prompts defining their unique responsibilities, tools, and communication rules. So, our general recommendation is to maximize the capabilities of individual agents first. More agents can provide intuitive conceptual separation, but can introduce additional complexity and overhead; a single agent equipped with tools is usually sufficient.

For many complex workflows, assigning prompts and tools to multiple agents can improve performance and scalability. When your agents can't follow complex instructions or consistently choose the wrong tools, you may need to further divide the system and introduce more independent agents.

The agent splitting logic:
- **Complex logic**: When a prompt contains many conditional statements (multiple if-then-else branches) and the prompt template is difficult to scale, consider assigning each logic segment to a separate agent.
- **Tool overload**: The problem is not only the number of tools, but also their similarity or overlap. Some implementations can successfully manage more than 15 well-defined, independent tools, while others struggle with fewer than 10 overlapping tools. If performance does not improve after improving tool clarity by providing a descriptive name, clear parameters, and detailed descriptions, you can use multiple agents.

A scenario of how a multi-agent system works to complete a task:

![](https://note.ihep.ac.cn/uploads/f08f1e4f-af0c-45d9-8fa7-f94c89fab819.png)


Multi-agent systems can be designed in a variety of ways to suit specific workflows and needs, and in this experiment, but our experience working with customers shows that there are two categories with broad applicability:
- Managed Architecture
- Decentralization

Multi‑agent systems make your AI workflows easier to understand, maintain, and evolve. In the next subsection, we'll explore common architecture patterns for orchestrating these agents.

### 5.1. Managed Architecture

In a managed architecture, a central agent oversees the entire workflow and delegates specific tasks to a team of specialized agents. This architecture maintains contextual continuity and centralized control. The intelligent hub, often represented by a large language model (LLM), accurately assigns tasks to the appropriate agents and seamlessly integrates the results into a cohesive output. This model ensures a smooth and unified user experience while allowing for the on-demand activation of specialized capabilities.

Imagine you're running a team where one person (the leader) assigns tasks, reviews work, and ensures everyone collaborates smoothly. That's Managed Architecture! In multi-agent systems, you designate a Coordinator Agent to oversee specialized agents (e.g., Researcher, Writer, Validator). The workflow is:
- Break tasks into steps (e.g., "First, research topic X; then draft a summary"),
- Assign each step to the best-suited agent,
- Combine results into a final output
- Resolve conflicts if agents disagree.

This architecture is particularly suitable for scenarios where a single agent needs to take full control of workflow execution and requires a unified interaction endpoint directly to the user.

![](https://hepai-picture-bed.oss-cn-beijing.aliyuncs.com/18a99317ea0bfe35e4d3d30e123189b6addd69ae1f36da6d82eff8ee0e9f24be.jpg)

Example of Managed Agent Architecture in HepAI Agents SDK:

```python
from drsai import AssistantAgent, HepAIChatCompletionClient, SelectorGroupChat, TextMentionTermination, Console
import json
import asyncio

planning_agent = AssistantAgent(
    "PlanningAgent",
    description="An agent for planning tasks, this agent should be the first to engage when given a new task.",
    system_message="""
You are a planning agent.
Your job is to break down complex tasks into smaller, manageable subtasks.
Your team members are:
WebSearchAgent: Searches for information
DataAnalystAgent: Performs calculations

You only plan and delegate tasks - you do not execute them yourself.
When assigning tasks, use this format:
1. <agent> : <task>

After all tasks are complete, summarize the findings and end with "TERMINATE".
""",
)

Spanish_Agent = AssistantAgent(
    "Spanish_Agent",
    system_message="You are a Spanish translator who can translate other languages into Spanish.",
)

French_Agent = AssistantAgent(
    "French_Agent",
    system_message="You are a French translator who can translate other languages into French.",
)

Italian_Agent = AssistantAgent(
    "Italian_Agent",
    system_message="You are a Italian translator who can translate other languages into Italian.",
)

text_termination = TextMentionTermination("TERMINATE")
model_client = HepAIChatCompletionClient(model="openai/gpt-4o")

team = SelectorGroupChat(
    participants=[planning_agent, Spanish_Agent, French_Agent, Italian_Agent],
    model_client= model_client,
    termination_condition=text_termination
)

# Use asyncio.run(...) if you are running this in a script.
async def main():
    await Console(team.run_stream(task="Translate 'hello' to spanish, french, and Italian for me!"))

asyncio.run(main())
```
Some frameworks have a declarative design, requiring developers to clearly define all branches, loops, and conditions in the workflow in advance through a graph structure consisting of nodes (agents) and edges (deterministic or dynamic handoffs). While this pattern offers advantages in visual clarity, its configuration process can quickly become lengthy and difficult to maintain as workflow dynamics and complexity increase, often requiring developers to master specialized processes in specific domains.

In contrast, the HepAI Agents SDK takes a more flexible code-first approach. Developers can express workflow logic directly using familiar programming structures without the need to predefine a full graph structure, enabling more dynamic and adaptable agent orchestration.

### 5.2. Decentralized Architecture

In a decentralized architecture, there is no single orchestrator; multiple agents communicate directly with each other to coordinate work. Each agent can ask for help and also respond to others' requests. This way, they create a network of collaborators instead of having a strict hierarchy.

Imagine a group of experts in a room solving a problem together, no boss giving orders, just peers collaborating as equals. That's decentralized architecture! Every agent works independently but talks directly to others, sharing ideas and voting on solutions. For example:
- A Researcher Agent finds data, then passes it to a Writer Agent.
- The Writer creates a draft, then asks a Fact-Checker Agent to verify it.
- If they disagree, they debate until an agreement is reached.

This pattern involves multiple equal agents, and anyone can directly hand over workflow control to the others. This model is ideal when there is no need for a single agent to maintain central control or results integration - it allows each agent to take over execution and interact directly with the user on demand.

A code example for a Decentralized architecture is:
```python
from drsai import AssistantAgent, HandoffTermination, TextMentionTermination
from drsai import run_backend, run_console
from drsai import HandoffMessage
from drsai import DrSaiSwarm
from drsai import Console, DrSaiAPP
import json
from typing import AsyncGenerator, Union
import asyncio
import sys

def refund_flight(flight_id: str) -> str:
    """Refund a flight"""
    return f"Flight {flight_id} refunded"

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_team() -> DrSaiSwarm:
    travel_agent = AssistantAgent(
        "travel_agent",
        handoffs=["flights_refunder", "user"],
        system_message="""You are a travel agent.
The flights_refunder is in charge of refunding flights.
If you need information from the user, you must first send your message, then you can handoff to the user.
Use TERMINATE when the travel planning is complete.""",
    )

    flights_refunder = AssistantAgent(
        "flights_refunder",
        handoffs=["travel_agent", "user"],
        tools=[refund_flight],
        system_message="""You are an agent specialized in refunding flights.
You only need flight reference numbers to refund a flight.
You have the ability to refund a flight using the refund_flight tool.
If you need information from the user, you must first send your message, then you can handoff to the user.
When the transaction is complete, handoff to the travel agent to finalize.""",
    )

    termination = HandoffTermination(target="user") | TextMentionTermination("TERMINATE")

    return DrSaiSwarm([travel_agent, flights_refunder], termination_condition=termination)

async def run_team_stream() -> None:
    task = "I need to refund my flight."
    task_result = await Console(create_team().run_stream(task=task))
    last_message = task_result.messages[-1]
    
    while isinstance(last_message, HandoffMessage) and last_message.target == "user":
        user_message = input("User: ")
        task_result = await Console(
            create_team().run_stream(task=HandoffMessage(source="user", target=last_message.source, content=user_message))
        )
        last_message = task_result.messages[-1]
        
async def handle_oai_stream(stream: AsyncGenerator):
    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()
    
async def main():
    drsaiapp = DrSaiAPP(agent_factory=create_team)
    stream = drsaiapp.a_start_chat_completions(
        messages=[{"content":"I need to refund my flight.", "role":"user"}],
        stream=True,
        chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
    )
    
    await handle_oai_stream(stream)

    user_message = input("User: ")
    stream = drsaiapp.a_start_chat_completions(
        messages=[{"content":user_message, "role":"user"}],
        stream=True,
        chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4",
    )
    
    await handle_oai_stream(stream)

if __name__ == "__main__":
    asyncio.run(run_team_stream())
```
This mode is especially suitable for scenarios involving direct dialogue between individual agents, where tasks can be quickly transferred by specifying the objects involved. It is particularly effective when a specialized agent is needed to completely take over a specific task without the ongoing involvement of the original agent. Developers have the option to configure the backhaul handoff feature for agents receiving the transfer, allowing them to regain control if necessary.

### 5.3. Best Practices: Choosing Between Managed vs. Decentralized

When deciding between a managed (coordinator) or decentralized (peer‑to‑peer) architecture, match the pattern to your task and operational needs:
| Criteria | Managed Architecture | Decentralized Architecture |
|----------|---------------------|---------------------------|
| Workflow Pattern | Linear, step-by-step processes (e.g., research → analysis → report). | Dynamic or parallel tasks (e.g., real-time monitoring, event processing). |
| Error Handling | Centralized retry and error logic in one orchestrator. | If a task fails, built-in backup systems will take over and reroute it. |
| Role Coordination | Specialists work in a fixed order and share the exact context. | People create "teams" quickly based on the tasks they need to complete and the resources they have available. |
| Debugging and Maintenance | Easy to debug and swap individual agents without affecting the entire flow. | Harder to trace single failures, but supports emergent collaboration and flexible scaling. |
| Best Fit | It needs predictability, strict control, and clear stages. | It needs scalability, fault tolerance, and flexible collaboration. |

*Note*: Start with a managed setup for clear, step-by-step applications. If your system becomes larger or more unpredictable, requiring real-time coordination and the ability to handle faults, think about switching to a decentralized model.

## 6. Summary

AI agents represent a major step forward in workflow automation. By combining powerful language models with well‑defined tools and structured instructions, agents can interpret ambiguous requests, invoke multiple services, and carry out multi‑step processes with minimal supervision. Unlike basic chatbots or single‑call LLM apps, agents complete end‑to‑end tasks making them especially suited to complex decision‑making, unstructured data analysis, and replacing brittle rule‑based systems.

A solid agent begins with three pillars: Model, Tools, and System Prompts. Start with a single agent for straightforward scenarios, then adopt multi‑agent patterns managed or decentralized, only as complexity demands. At every stage, implement guardrails: validate inputs, limit tool scope, and log actions to keep behavior predictable and secure.

Deployment is best approached iteratively. Prototype quickly, gather user feedback, and expand capabilities in small, controlled increments. With this foundation and a step‑by‑step mindset, AI agents can evolve from simple assistants into powerful workflow automators, delivering real value across research, customer support, DevOps, and beyond.

## 7. Resources

- Installation: *pip install drsai -U*
- HepAI Development Framework SDK: https://code.ihep.ac.cn/hepai/drsai
- HepAI high-energy AI platform: https://ai.ihep.ac.cn
- HepAI SDK： https://github.com/hepaihub/hepai
- Autogen agent framework: https://microsoft.github.io/autogen
- Practical Guide to OpenAI Agents: https://openai.github.io/openai-agents-python/