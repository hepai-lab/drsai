'''
A Model_Context component that keep agent's memory using RAGFlow and LLM
'''
from pydantic import BaseModel
from typing import (
    List, 
    Dict, 
    Any,
    Self,
    Literal,

)

from autogen_core import(
    ComponentBase,
    Component, 
    ComponentModel
)
from autogen_core.tools import (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolSchema
)
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    StructuredMessage,
    StructuredMessageFactory,
    # MultiModalMessage,
    Image,
)
from autogen_core.models import (
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResultMessage,
    FunctionExecutionResult,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    RequestUsage,
    ModelFamily,
)
from autogen_core.model_context import ChatCompletionContext

from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager

from loguru import logger

COMPRESSION_PROMPT_ZN = """
你是一个负责压缩长对话记忆的助手。现在给你一段包含用户、智能助手{name}以及其他助手多轮对话的记录。你的任务是从中提取长期有价值的信息，并输出高度压缩、结构清晰的摘要。

请从以下方面进行总结：

1. **用户的初始任务、目标、背景信息、用户或者其他智能助手查询的记忆等信息**（只保留长期有用内容）。
2. **智能助手{name}在对话中做出的关键回复、思考过程摘要和重要决策**：
   - 包含每个关键动作使用的工具名称、调用目的、输入要点、输出或执行结果。
   - 若工具失败或返回无效结果，也需简要记录原因。
3. **当前轮对话结束时，用户或其他助手对{name}提出的最新需求或待办事项**。

同时请遵守以下要求：
- 忽略闲聊、重复确认、无用解释等短期内容。
- 若对话是中英文或混合语言，保留相应的语言。
- 尽可能压缩 token，同时保持可读性与完整的因果链。
- 输出必须客观、无臆测，仅基于对话内容进行总结。

请最终按照每个部分进行输出。

"""

COMPRESSION_PROMPT_EN = """
You are an assistant responsible for compressing long multi-agent conversations into concise, long-term memory summaries. You will receive a conversation containing the user, assistant {name}, and possibly other agents. Your task is to extract only the high-value, long-term information and produce a highly compressed and structured summary.

Please summarize the conversation from the following perspectives:

1. **The user’s initial goal, task description, and any relevant background information** (keep only information that remains useful later).
2. **Key actions, reasoning steps, and major decisions made by assistant {name}:**
   - Include the tools used, the purpose of each tool call, the main inputs, and the outputs or results.
   - If a tool call failed or returned an invalid result, briefly record the reason.
3. **The current outstanding request or the latest requirement from the user or other agents toward assistant {name}.**

Additional instructions:
- Ignore small talk, repeated confirmations, and temporary or low-value content.
- The input may contain Chinese, English, or mixed languages; keep the origin languages**, clearly structured.
- Compress aggressively to minimize token usage while keeping essential causal chains.
- Do not infer or invent any information that is not explicitly stated.

Output the final result as a structured bullet-point summary.


"""

class DrSaiChatCompletionContextConfig(BaseModel):
    agent_name: str
    model_client: ComponentModel
    token_limit: int | None = None
    compression_prompt: str|None = None
    rag_flow_url: str | None = None
    rag_flow_token: str | None = None
    dataset_id: str|None = None,
    document_id: str|None = None,
    tool_schema: List[ToolSchema] | None = None
    initial_messages: List[LLMMessage] | None = None
    history_messages: List[LLMMessage] | None = None

class DrSaiChatCompletionContext(ChatCompletionContext, Component[DrSaiChatCompletionContextConfig]):
    """
    A context that limits the number of tokens using LLM and store memory using RAGFlow.
    Note:
        - This ChatCompletionContext keeps the first two SystemMessage and the last two UserMessage.
    """

    component_config_schema = DrSaiChatCompletionContextConfig
    component_provider_override = "drsai.DrSaiChatCompletionContext"
    component_description = "A context that limits the number of tokens used by the model."

    def __init__(
        self,
        agent_name: str,
        model_client: ChatCompletionClient,
        *,
        token_limit: int | None = None,
        compression_prompt: str|None = None,
        rag_flow_url: str | None = None,
        rag_flow_token: str | None = None,
        dataset_id: str|None = None,
        document_id: str|None = None,
        tool_schema: List[ToolSchema] | None = None,
        initial_messages: List[LLMMessage] | None = None,
    ) -> None:
        """
        agent_name: The name of the agent.
        model_client: The model client to use.
        token_limit: The maximum number of tokens to use.
        compression_prompt: The prompt to use for compressing the conversation.
        rag_flow_url: The url of ragflow.
        rag_flow_token: The token of ragflow.
        dataset_id: The id of dataset for memory storage.
        document_id: The id of document for memory storage. 
        tool_schema: The schema of tools.
        initial_messages: The initial messages to use.
        """

        super().__init__(initial_messages)

        self._agent_name = agent_name
        if token_limit is not None and token_limit <= 0:
            raise ValueError("token_limit must be greater than 0.")
        self._token_limit = token_limit
        self._model_client = model_client

        self._compression_prompt = compression_prompt or COMPRESSION_PROMPT_ZN.format(name=agent_name)

        self._rag_flow_manager = None
        if rag_flow_url is not None and rag_flow_token is not None:
            self._rag_flow_manager = RAGFlowMemoryManager(rag_flow_url, rag_flow_token)
            if dataset_id is None or document_id is None:
                raise ValueError("dataset_id and document_id must be provided when rag_flow_url and rag_flow_token are provided.")
            self._dataset_id = dataset_id
            self._document_id = document_id
            
        self._tool_schema = tool_schema or []

        self._history_messages = []

    async def add_message(
            self, 
            message: LLMMessage, 
            important_keywords: List[str] = None,
            questions: List[str] = None
            ) -> None:
        """
        Add a message to the context and store the content to ragflow memory manager.
        important_keywords: The key terms or phrases to tag with the chunk.
        questions: If there is a given question, the embedded chunks will be based on them.
        """

        if self._rag_flow_manager is not None:
            await self._rag_flow_manager.add_chunks_to_dataset(
                dataset_id = self._dataset_id,
                document_id = self._document_id,
                content = message.content,
                important_keywords = important_keywords,
                questions = questions)
        self._messages.append(message)
        self._history_messages.append(message)

    async def get_messages(self) -> List[LLMMessage]:
        """Get at most `token_limit` tokens in recent messages. If the token limit is not
        provided, then return as many messages as the remaining token allowed by the model client."""
        messages = list(self._messages)
       
        # TODO: 判断token>85%limit后开始压缩，保留最后一条消息用户的任务消息！！
        try:
            if self._token_limit is not None:
                token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
                if token_count > self._token_limit:
                    messages.append(UserMessage(source="user", content=self._compression_prompt))
                    compressed_response = await self._model_client.create(
                        messages=messages,
                        tools=self._tool_schema,
                    )
                    compressed_content = compressed_response.content
                    
                    # keep some key messages
                    remaining_messages = []
                    
                    # Keep first two SystemMessage
                    system_count = 0
                    for message in messages:
                        if isinstance(message, SystemMessage) and system_count < 2:
                            remaining_messages.append(message)
                            system_count += 1
                    
                    # Add compressed content as UserMessage in the middle
                    remaining_messages.append(UserMessage(content=compressed_content, source="system"))
                    
                    # Keep last UserMessage
                    user_messages = [msg for msg in messages if isinstance(msg, UserMessage)]
                    for user_message in reversed(user_messages):
                        if user_message.source == "user":
                            remaining_messages.append(user_message)
                            break
                    return remaining_messages
                else:
                    return messages
            else:
                raise ValueError("token_limit must be provided.")

        except Exception as e:
            logger.error(f"There is an error when compressing the memory using LLM: {e}. We have to truncate the memory.")
            if self._token_limit is None:
                remaining_tokens = self._model_client.remaining_tokens(messages, tools=self._tool_schema)
                while remaining_tokens < 0 and len(messages) > 0:
                    middle_index = len(messages) // 2
                    messages.pop(middle_index)
                    remaining_tokens = self._model_client.remaining_tokens(messages, tools=self._tool_schema)
            else:
                token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
                while token_count > self._token_limit and len(messages) > 0:
                    middle_index = len(messages) // 2
                    messages.pop(middle_index)
                    token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
            if messages and isinstance(messages[0], FunctionExecutionResultMessage):
                # Handle the first message is a function call result message.
                # Remove the first message from the list.
                messages = messages[1:]
            return messages

    def _to_config(self) -> DrSaiChatCompletionContextConfig:
        return DrSaiChatCompletionContextConfig(
            model_client=self._model_client.dump_component(),
            token_limit=self._token_limit,
            compression_prompt=self._compression_prompt,
            rag_flow_url=self._rag_flow_manager.base_url if self._rag_flow_manager else None,
            rag_flow_token=self._rag_flow_manager.api_key if self._rag_flow_manager else None,
            dataset_id=self._dataset_id,
            document_id=self._document_id,
            tool_schema=self._tool_schema,
            initial_messages=self._initial_messages,
            history_messages=self._history_messages,
        )

    @classmethod
    def _from_config(cls, config: DrSaiChatCompletionContextConfig) -> Self:
        return cls(
            model_client=ChatCompletionClient.load_component(config.model_client),
            token_limit=config.token_limit,
            compression_prompt=config.compression_prompt,
            rag_flow_url=config.rag_flow_url,
            rag_flow_token=config.rag_flow_token,
            dataset_id=config.dataset_id,
            document_id=config.document_id,
            tool_schema=config.tool_schema,
            initial_messages=config.initial_messages,
        )


