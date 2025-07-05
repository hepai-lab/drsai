智能体、多智能体系统代码构建实用指南
==

![](https://note.ihep.ac.cn/uploads/ccf0779c-c944-4b3a-a44f-e3c32452487f.png)


[toc]


# 0.引言

大型语言模型（LLMs）越来越能够处理复杂、多步骤的任务。但是这仅限制于文本等单纯的输出。深度思考推理、多模态和工具的使用解锁了一类全新的 LLM 驱动的系统，即智能体。

本指南专为产品和工程团队设计，旨在探索如何构建他们的第一个智能体，将众多应用部署方案提炼为实用且可操作的最佳实践。

本指南包括有前景的智能体框架、智能体设计逻辑和编排的清晰模式，以及确保智能体安全、可预测和有效运行的最佳实践。

阅读完本指南后，您将具备必要的基础知识，能够自信地开始构建您的第一个智能体。

# 1.什么是智能体

传统软件能够帮助用户简化和自动化工作流程，而智能体则能够以高度独立性代表用户执行相同的工作流程。

**智能体是能够代表用户自主执行和完成任务的系统。**

智能体具备一定的智能和决策能力，能够感知环境、处理信息、做出决策并采取行动，以实现设定的目标。智能体可以根据环境的变化进行自我调整，并在需要时与外部系统或其他智能体进行交互。其核心特征包括自主性、适应性和交互能力。

**智能体是执行和管理工作流的主体**。工作流是一系列必须执行的步骤，以满足用户的目标，无论是解决客户服务问题、提交代码更改、执行数据分析，还是生成报告。集成了大型语言模型（LLM）但不用于控制工作流程执行的应用程序——如简单的聊天机器人、单轮 LLM 或情感分类器——都不属于智能体。

更具体地说，智能体具备核心特征，使其能够可靠且一致地代表用户行动：

1. 它利用 LLM 来管理工作流程的执行并做出决策。它能够识别工作流程何时完成，并在需要时主动纠正其行为。在发生故障时，它可以停止执行并将控制权转交给用户。

2. 它可以访问各种工具与外部系统进行交互，以获取上下文信息和采取行动，并根据工作流程的当前状态动态选择适当的工具，始终在明确定义的保护措施内操作。 

# 2.智能体的适用场景 

构建智能体需要重新思考您的系统如何做出决策和处理复杂性。与传统自动化不同，智能体特别适合那些传统的确定性和基于规则的方法无法胜任的工作流程。

以支付欺诈分析为例。传统的规则引擎就像一个检查清单，根据预设标准标记交易。相比之下，大型语言模型（LLM）智能体更像是一位经验丰富的调查员，能够评估上下文、考虑微妙的模式，并在没有明显违反规则的情况下识别可疑活动。这种细致入微的推理能力正是智能体能够有效管理复杂和模糊情况的原因。

在评估智能体可以带来价值的领域时，应优先考虑那些之前难以实现自动化的工作流程，特别是传统方法遇到阻力的地方：

<html><body><table><tr><td>01</td><td>复杂决策</td><td>涉及细致判断、例外情况或依赖上下文的决策的 工作流程，例如客户服务工作流程中的退款审批。</td></tr><tr><td>02</td><td>难以维护的规则</td><td>由于规则集庞大且复杂，导致系统变得难以管理， 使得更新成本高昂或容易出错，例如供应商安全审查。</td></tr><tr><td>03</td><td>对非结构化数据 的高度依赖</td><td>需要解释自然语言、从文档中提取意义或以对话 方式与用户互动的场景，例如处理家庭保险索赔。</td></tr></table></body></html> 

在决定构建智能体之前，请验证您的用例是否能清晰地满足这些标准。否则，确定性解决方案可能已足够。 


# 3.智能体设计基础

在其最基本的形式中，智能体由三个核心组件组成：

1. **模型**：为智能体的推理和决策提供支持的大型语言模型（LLM）。
2. **工具**：智能体可以用来采取行动的外部函数或 API。
3. **指令(系统提示词)**：用于明确定义智能体行为的指导方针和保护措施。

以下是在使用 HepAI 的 Agents SDK 时的代码示例。您也可以使用您偏好的库来实现相同的概念，或直接从头开始构建。 

```python
AssistantAgent(
    name="weather_agent",
    system_message="You are a helpful agent who can talk to users about the weather.",
    tools=[web_fetch_tool],
)
```

## 3.1.选择模型

不同的模型在任务复杂性、延迟和成本方面具有不同的优势和权衡。正如我们将在下一节关于“智能体编排”中看到的那样，你可能需要考虑在流程中的不同任务中使用多种模型。

并非每个任务都需要最智能的模型——简单的检索或意图分类任务可以由更小、更快的模型处理，而更复杂的任务（例如决定是否批准退款）则可能受益于更强大的模型。

一种有效的方法是：在构建代理原型时，为每个任务使用最强大的模型，以建立性能基准。然后，尝试用较小的模型替换，看看它们是否仍能达到可接受的结果。这样，你就不会过早地限制代理的能力，并且可以诊断出较小模型在哪些地方成功或失败。

总结来说，选择模型的原则很简单：

（1） 设置评估以建立性能基准
（2） 专注于使用最佳模型满足你的准确率目标
（3） 在可能的情况下，通过用较小模型替换较大模型来优化成本和延迟

**获取可用模型的方法：**

```Python  
from hepai import HepAI     
client=HepAI(api_key="Your API Key")   
models=client.models.list()  
```

你可以在此处创建和获取 [HepAI平台API-KEY](https://ai.ihep.ac.cn/mine)。
你可以在此处找到 [HepAI 模型选择的详细指南](https://note.ihep.ac.cn/s/Ud7Vlhaxf)。

## 3.2 定义工具 

工具通过使用底层应用程序或系统的 API 来扩展智能体的能力。对于没有API 的系统，智能体可以通过网页和应用程序的用户界面直接与这些系统和应用程序进行交互——就像人类一样。 

每个工具都应具有标准化的定义，从而实现工具与代理之间智能体的多对多关系。文档完善、经过充分测试且可重用的工具可以提高可发现性，简化版本管理，并避免冗余定义。模型上下文协议（Model Context Protocal，MCP）是标准的大模型上下文协议，新工具应符合 MCP 协议，支持 MCP 协议的工具非常容易接入到智能体中。 

总的来说，智能体需要以下三类工具： 

<html><body><table><tr><td>类型</td><td>描述</td><td>示例</td></tr><tr><td>数据 工具</td><td>使智能体能够检索执行工作流所需的上下文和 信息。</td><td>读取PDF文档，或进行网页搜索，查询数据库或CRM系统。</td></tr><tr><td>操作 工具</td><td>使智能体能够与系统交互以执行操作。</td><td>调用科学工具、解析结果，向数据库添加新信息、更新记录或发送信息，发送电子邮件和短信，将客户服务工单转交给人工处理。</td></tr><tr><td>编排 工具</td><td>智能体本身可以作为其他智能体的工具——参见“智能体编排”部分中的“管理者模式”</td><td>研究智能体、写作智能体、退款智能体。</td></tr></table></body></html> 

例如：使用 SDK 为智能体配备一系列工具，包含预定义 MCP 工具和自定义工具：

```python	
from drsai import AssistantAgent, HepAIChatCompletionClient, StdioServerParams, mcp_server_tools

tools = []

# Web fetch MCP tools
tools.extend(
await mcp_server_tools(
    StdioServerParams(
        command=config["uvx"],
        args=config["run", "mcp-server-fetch"],
        env=None)))

# Self-def tools
async def get_weather(city: str) -> str:
   """Get the weather for a given city."""
   return f"The weather in {city} is 73 degrees and Sunny."
tools.append(get_weather)

agent = AssistantAgent(
    name="Web_Agent",
    system_message="You are a helpful agent who can talk to users about the weather and web content.",
    tools= tools,
)

```

你可以在此处找到更多预定义 [MCP](https://github.com/modelcontextprotocol/servers) 工具。

随着所需工具数量的增加，可以考虑将任务拆分到多个智能体上执行（参见“编排”部分）。

## 3.3 配置指令（系统提示词）

高质量的指令（系统提示词）对于任何基于大语言模型（LLM）的应用程序都至关重要，尤其是对于智能体而言。清晰的指令可以减少歧义，提升智能体的决策能力，从而实现更流畅的工作流执行并减少错误。

- **智能体指令的最佳实践**

（1）利用现有文档：在创建流程时，使用现有的操作流程、支持脚本或政策文档来生成适合 LLM 的流程。例如，在客户服务中，流程可以大致映射到知识库中的各个文章。

（2）提示智能体分解任务：从复杂的资源中提供更小、更清晰的步骤，有助于减少歧义，并帮助模型更好地遵循指令。

（3）定义明确的操作：确保流程中的每一步都对应一个具体的操作或输出。例如，某一步骤可以指示智能体向用户询问订单号，或调用 API 以获取账户详情。显式地明确操作可以减少解释错误的可能性。

（4）应对特殊情况：现实中的交互常常会产生决策点，例如当用户提供不完整信息或提出意外问题时该如何处理。一个鲁棒的流程应预见到常见的重要情况，并包含处理这些情况的指令，例如通过条件步骤或分支（如果缺少必要信息则执行替代步骤）来实现。

你可以使用高级模型（如 DeepSeek-R1）从现有文档中自动生成指令。以下是一个示例提示词：

```text
You are an expert in writing instructions for an LLM agent. Convert the following help center document into a clear set of instructions, written in a numbered list. The document will be a policy followed by an LLM. Ensure that there is no ambiguity, and that the instructions are written as directions for an agent. The help center document to convert is the following {{help_center_doc}}
```

## 3.4 智能体编排 

在基础组件就位后，你可以考虑使用编排模式，以使你的智能体能够有效地执行工作流。 

虽然立即构建一个具有复杂架构的完全自主智能体很诱人，但客户通常通过渐进式方法取得更大的成功。 

一般来说，编排模式分为两类： 

（1）单智能体系统：一个配备适当工具和指令的单一模型在循环中执行工作流。
（2）多智能体系统：工作流的执行被分布在多个协同的智能体之间。

让我们详细探讨每种模式。 

# 4.单智能体系统 

单个智能体可以通过逐步添加工具来处理许多任务，从而保持复杂性可控，并简化评估和维护。每个新工具都能扩展其能力，而不会过早地迫使你协调多个智能体。 

![单智能体工作逻辑](https://note.ihep.ac.cn/uploads/c371a91e-3035-4171-b677-17a45e2154a5.png)

HepAI Agents默认智能体的运行方式包括模型根据指令（提示词）直接回复、工具调用、生成某种结构化输出，或者因为模型连接等原因出现错误。 

例如，在 Agents SDK 中，智能体可以通过 ```Console``` 方法以命令行输出的方式启动，智能体会根据用户输入调用大模型判断是否需要使用工具，最后可能会输出：

（1）调用了一个最终输出工具（由特定的输出类型定义）
（2）模型返回了一个不包含任何工具调用的响应（例如，直接的用户消息）

**示例用法：**

```python
# Use asyncio.run(...) if you are running this in a script.
await Console(agent.run_stream(task="What is the weather in New York?")
```

甚至你可以定义多个具有关联的工具，让智能体根据具体的任务进行规划，依次调用多个工具进行复杂任务的分解与执行，对此，你只需要加上一行``` reply_function=tools_recycle_reply_function```：

```python
from drsai import tools_recycle_reply_function
AssistantAgent(
    name="weather_agent",
    tools=tools,
    system_message="You are a helpful assistant.",
    reply_function=tools_recycle_reply_function,
    )
```

在不切换到多智能体框架的情况下，管理复杂性的一种有效策略是使用提示模板。与其为不同的用例维护多个单独的提示，不如使用一个灵活的、可接受策略变量的基础提示。这种模板方法可以轻松适应各种上下文，显著简化维护和评估。当新的用例出现时，你可以更新变量，而不是重写整个工作流。

例如：

```text
You are a call center agent. You are interacting with {{user_first_name}} who has been a member for {{user_tenure}}. The user's most common complains are about {{user_complaint_categories}}. Greet the user, thank them for being a loyal customer, and answer any questions the user may have! 
```



# 5.多智能体系统  

**何时考虑创建多个智能体**

我们的一般建议是首先最大化单个智能体的能力。更多的智能体可以提供直观的概念分离，但可能会引入额外的复杂性和开销，因此通常一个配备工具的单个智能体就足够了。

对于许多复杂的工作流，将提示词和工具分配到多个智能体可以提高性能和可扩展性。当你的智能体无法遵循复杂的指令或持续选择错误的工具时，你可能需要进一步划分系统并引入更多独立的智能体。

**拆分智能体的实用指南**

（1）复杂逻辑：当提示包含许多条件语句（多个 if-then-else 分支），并且提示模板难以扩展时，考虑将每个逻辑段分配到单独的智能体。
（2）工具过载：问题不仅在于工具的数量，还在于它们的相似性或重叠性。一些实现可以成功管理超过 15 个定义明确、独立的工具，而另一些则在处理少于 10 个重叠工具时遇到困难。如果通过提供描述性名称、清晰参数和详细说明来改进工具清晰度后，性能仍未改善，则可以使用多个智能体。

多智能体系统可以通过多种方式设计以适应特定工作流程和需求，在对此实验中但我们与客户合作的经验表明存在两个具有广泛适用性的类别： 

**多智能体类型**

**管理型架构（智能体即工具）：**

中央"管理"智能体通过工具调用协调多个专业智能体，每个智能体负责处理特定任务或领域。

**去中心化型（智能体接力协作）：**

多个智能体以对等节点身份协同运行，基于各自的专业分工相互移交任务。  

多智能体系统可建模为图结构，其中智能体对应节点。在管理型架构中，边表示工具调用关系；而在去中心化架构中，边表示智能体间传递执行权的任务移交过程。

无论采用何种编排模式，以下核心指导原则始终适用：保持组件的灵活性、可组合性，并由清晰且结构化的提示驱动。

## 5.1.管理型架构

管理型架构通过工具调用机制，使中央大语言模型（"管理"中枢）能够无缝协调专业化智能体网络。该架构既能保持上下文连续性又可维持控制权集中，智能中枢可精准分派任务至适宜智能体，并将执行结果有机整合为统一输出。这种模式确保获得流畅统一的用户体验，同时实现专业化能力的按需调用。

本架构特别适用于需单一智能体全权控制工作流执行，并要求直接面向用户提供统一交互端点的场景。 

![](https://hepai-picture-bed.oss-cn-beijing.aliyuncs.com/18a99317ea0bfe35e4d3d30e123189b6addd69ae1f36da6d82eff8ee0e9f24be.jpg)

**管理型代理架构在 HepAI Agents SDK 中的实现示例:**

```python
from drsai import AssistantAgent, HepAIChatCompletionClient, SelectorGroupChat, TextMentionTermination, Co
import json

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

team = SelectorGroupChat(
    participants=[planning_agent, Spanish_Agent, French_Agent, Italian_Agent], 
    termination_condition=text_termination
)
# Use asyncio.run(...) if you are running this in a script.
await Console(team.run_stream(task="Translate 'hello' to spanish, french, and Italian for me!")
```

部分框架采用声明式设计，要求开发者通过由节点（智能体）和边（确定性或动态移交）构成的图结构，预先明确定义工作流中的所有分支、循环及条件。虽然这种模式在可视化清晰度方面具有优势，但随着工作流动态性和复杂度的提升，其配置过程会迅速变得冗长且难以维护，通常需要开发者掌握特定领域的专业流程。

相比之下， HepAI Agents SDK 采用更灵活的代码优先方法。开发者可直接使用熟悉的编程结构表达工作流逻辑，无需预先定义完整图结构，从而实现更动态且适应性强的智能体编排。

## 5.2.去中心化型 

在去中心化模式中，智能体可将工作流执行权相互"移交"。移交是允许智能体委托其他智能体的单向转移。在 Agents SDK 中，移交是一种工具或函数类型。若智能体调用移交函数，系统将立即启动被移交目标智能体的执行，同时转移最新的会话状态。 

该模式涉及多个平等地位的智能体，任一智能体均可直接将工作流控制权移交给其他智能体。当无需单一智能体维持中央控制或结果整合时，该模式最为理想——它允许每个智能体按需接管执行并与用户直接交互。

以下是通过 HepAI的Agents SDK 实现去中心化模式的智能程序员。通过显式地构建智能体之间的联络人，能够让智能体在完成自己的任务或者当任务需要潜在对象完成时直接通过HandoffMessage进行任务移交。每个智能体在遇到问题后都可以向用户反馈： 

![](https://note.ihep.ac.cn/uploads/3bc46455-80bc-45b2-956c-d56fef25a54a.png)

```python
import asyncio
from drsai import AssistantAgent, HandoffTermination, TextMentionTermination
from drsai import AssistantAgent, HandoffTermination, TextMentionTermination
from drsai import HandoffMessage
from drsai import DrSaiSwarm
from drsai import Console

def code(input_:str):
    "这里用于生成一段代码"
    return f"伪代码：{input_}"

def test(input_:bool):
    "这里用于测试一段代码"
    if bool:
        return f"当前任务通过"
    else:
        return f"当前任务失败"

planner = AssistantAgent(
    "planner",
    handoffs=["host", "user"],
    system_message="""你是一个进行任务决策的agent，你需要将任务分解成1.x 2.x 3.x ...，这些步骤都是用于编写代码的，但是你不用给出代码，代码由别人写。你的结果一定会传递给host""",
)
host = AssistantAgent(
    "host",
    handoffs=["planner",'coder', "user"],
    system_message="""你需要判断接下来的任务找谁做，以及判断当前步骤的任务是否完成，是否需要重做。如果你判断任务完成，在最后的输出中添加一个 TERMINATE""",
)
coder = AssistantAgent(
    "coder",
    handoffs=["tester", "user"],
    tools=[code],
    system_message="""你的作用是生成相关的代码，你的结果一定会传递给tester。""",
)
tester = AssistantAgent(
    "tester",
    handoffs=["host", "user"],
    tools=[test],
    system_message="""测试结束返回给host。""",
)

termination = HandoffTermination(target="user") | TextMentionTermination("TERMINATE")

team = DrSaiSwarm([planner, host,coder,tester], termination_condition=termination)


async def run_team_stream() -> None:

    task = "我需要使用python构建一段爬虫程序，需要我做哪些步骤？"

    task_result = await Console(team.run_stream(task=task))
    last_message = task_result.messages[-1]

    while isinstance(last_message, HandoffMessage) and last_message.target == "user":
        user_message = input("User: ")

        task_result = await Console(
            create_team().run_stream(task=HandoffMessage(source="user", target=last_message.source, content=user_message))
        )
        last_message = task_result.messages[-1]


# Use asyncio.run(...) if you are running this in a script.
await run_team_stream()
```

在上述示例中，理想的过程是用户的初始消息首先发送至planner，当planner完成计划制定给后转给host，然后host让coder写代码，最后tester结束后给host。所有智能体根据自己的能力和下一步需要做的事对任务直接进行处理后直接移交给潜在的对象，在每个智能体遇到问题时都可以直接向用户反馈。

该模式特别适用于各个智能体直接对话等场景，通过指定传输潜在对象，将任务快速移交。当您希望由专业智能体完全接管特定任务而无需原始智能体持续参与时尤为有效。开发者可选择为接收移交的智能体配置回传移交功能，使其在必要时能够再次转移控制权。

# 6.总结 

智能体标志着工作流自动化的新时代，系统能够通过模糊性进行推理、跨工具执行操作，并以高度自主性处理多步骤任务。与更简单的 LLM 应用程序不同，智能体端到端地执行工作流，使其非常适合涉及复杂决策、非结构化数据或脆弱的基于规则的系统的用例。 

要构建可靠的智能体，需从坚实的基础开始：将强大的模型与定义明确的工具和清晰、结构化的指令相结合。使用与你的复杂性级别相匹配的编排模式，从单个智能体开始，仅在需要时发展为多智能体系统。防护机制在每个阶段都至关重要，从输入过滤和工具使用到人工干预，帮助确保智能体在生产环境中安全、可预测地运行。 

成功部署的路径并非全有或全无。从小规模开始，通过真实用户进行验证，并随着时间的推移逐步扩展能力。凭借正确的基础和迭代方法，智能体可以带来真正的商业价值——不仅自动化任务，还能以智能和适应性自动化整个工作流。 

如果你正在为你的组织探索智能体或准备首次部署，请随时联系我们。我们的团队可以提供专业知识、指导和实践支持，以确保你的成功。 

### 资源链接：  

- **HepAI 智能体/多智能体开发框架 SDK：**: https://code.ihep.ac.cn/hepai/drsai
- **HepAI 高能人工智能平台：** https://ai.ihep.ac.cn
- **HepAI SDK：** https://github.com/hepaihub/hepai
- **安装：** `pip install drsai -U`


### 参考资料
- **Autogen智能体框架：** https://microsoft.github.io/autogen
- **OpenAI 智能体实用指南：** https://openai.github.io/openai-agents-python/