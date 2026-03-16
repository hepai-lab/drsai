'''
A Model_Context component that keep agent's memory using RAGFlow and LLM
'''
from pydantic import BaseModel, Field, field_serializer
from typing import (
    List, 
    Dict, 
    Any,
    Self,
    Literal,
    Optional
)

from autogen_core import(
    Component, 
    ComponentModel
)
from autogen_core.tools import ( 
    ToolSchema,
    ParametersSchema,
)
from autogen_core import CancellationToken
from autogen_core.models import (
    ChatCompletionClient,
    FunctionExecutionResultMessage,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    FunctionExecutionResult,
    SystemMessage,
)
from autogen_core.model_context import ChatCompletionContext

from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager

from loguru import logger
from datetime import datetime
import json
import os
from dataclasses import asdict

class LocalMesssage(BaseModel):
    """
    A message in a local memory.
    """
    role: Literal["user", "assistant", "system"]
    content: str
    source: str | None = None
    is_tool_call: bool = False # json.dumps(tool_call)->content
    create_time: datetime = Field(default_factory=datetime.now)

    @field_serializer('create_time')
    def serialize_dt(self, dt: datetime) -> str:
        return dt.strftime('%Y-%m-%d %H:%M:%S')

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

def get_judgment_tool(strict: bool = False,) -> ToolSchema:
    parameters = ParametersSchema(
        type="object",
        properties={
            "be_documented": {
                "type": "boolean",
                "description":  "The conversation should be documented or not."
            }
        },
        required=["be_documented"],
        additionalProperties=False,
    )
    tool_schema = ToolSchema(
        name="judgment_documented",
        description=f"Determine whether the aforementioned conversation should be recorded",
        parameters=parameters,
        strict=strict,
    )
    return tool_schema

SUMMARY_PROMPT_EN = """You need to analyze the following dialogue and summarize them in bullet points according to the requirements below:

- What is the user's task?
- How does the intelligent assistant: {name} respond to user questions? What tools/skills are used, and what steps are taken?
- What errors occurred in the middle, were they corrected through feedback, how were they corrected, and what were the results of the correction?
- What kind of reply did the intelligent assistant: {name} finally give?

If the user's question is merely a greeting or an inquiry about identity, call the `judgment_documented` tool to respond with false, indicating that no record is needed.

**NOTE:**

- If documenting is need, do not call the `judgment_documented` tool.

"""

class DrSaiChatCompletionContextConfig(BaseModel):
    agent_name: str
    model_client: ComponentModel
    user_id: str
    thread_id: str
    work_dir: str
    token_limit: int | None = None
    compression_prompt: str|None = None
    summary_task_prompt: str|None = None
    rag_flow_url: str | None = None
    rag_flow_token: str | None = None
    dataset_id: str|None = None,
    document_id: str|None = None,
    tool_schema: List[ToolSchema] | None = None
    learning_dataset_id: str|None = None
    learning_document_id: str|None = None
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
        user_id: str | None = None,
        thread_id: str | None = None,
        work_dir: str | None = None, 
        token_limit: int | None = None,
        compression_prompt: str|None = None,
        summary_task_prompt: str|None = None,
        rag_flow_url: str | None = None,
        rag_flow_token: str | None = None,
        dataset_id: str|None = None,
        document_id: str|None = None,
        learning_dataset_id: str|None = None,
        learning_document_id: str|None = None,
        # upload_memory: bool = False,
        tool_schema: List[ToolSchema] = [],
        initial_messages: List[LLMMessage] | None = None,
    ) -> None:
        """
        agent_name: The name of the agent.
        model_client: The model client to use.
        token_limit: The maximum number of tokens to use.
        compression_prompt: The prompt to use for compressing the conversation.
        rag_flow_url: The url of ragflow.
        rag_flow_token: The token of ragflow.
        // upload_memory: update memory to ragflow when add_message is called.
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

        self._thread_id = thread_id
        self._user_id = user_id
        self._work_dir = work_dir

        self._compression_prompt = compression_prompt or COMPRESSION_PROMPT_EN.format(name=agent_name)
        self._summary_task_prompt = summary_task_prompt or SUMMARY_PROMPT_EN.format(name=agent_name)

        self._dataset_id = dataset_id
        self._document_id = document_id
        self._learning_dataset_id = learning_dataset_id
        self._learning_document_id = learning_document_id

        self._rag_flow_manager = None
        if rag_flow_url is not None and rag_flow_token is not None:
            self._rag_flow_manager = RAGFlowMemoryManager(rag_flow_url, rag_flow_token)
            if dataset_id is None:
                raise ValueError("dataset_id must be provided when rag_flow_url and rag_flow_token are provided.")
        
        # self._is_upload_memory = upload_memory 

        self._tool_schema = tool_schema

        self._history_messages: list[dict] = []

        self._current_messages: list[LLMMessage] = []

    async def add_message(
            self, 
            message: LLMMessage, 
            # important_keywords: List[str] = None,
            # questions: List[str] = None,
            # document_id: str = None
            ) -> None:
        """
        Add a message to the context and store the content to ragflow memory manager.
        important_keywords: The key terms or phrases to tag with the chunk.
        questions: If there is a given question, the embedded chunks will be based on them.
        """

        # if self._rag_flow_manager is not None and self._is_upload_memory:
        #     await self._rag_flow_manager.add_chunks_to_dataset(
        #         dataset_id = self._dataset_id,
        #         document_id = document_id or self._document_id,
        #         content = message.content,
        #         important_keywords = important_keywords,
        #         questions = questions)
        self._messages.append(message)
        self._current_messages.append(message)

        if isinstance(message, SystemMessage):
            local_messages = LocalMesssage(
                role="system",
                content=message.content
            )
        elif isinstance(message, UserMessage):
            local_messages = LocalMesssage(
                role="user",
                content=message.content,
                name=message.source
            )
        elif isinstance(message, AssistantMessage):
            content = message.content
            if isinstance(message.content, list):
                # content = json.dumps([asdict(tool_call) for tool_call in message.content])
                content = str(message.content)
            local_messages = LocalMesssage(
                role="assistant",
                content=content,
                name=message.source
            )
        elif isinstance(message, FunctionExecutionResultMessage): 
            tool_call_list = [tool_call.model_dump() for tool_call in message.content]
            local_messages = LocalMesssage(
                role="assistant",
                content=json.dumps(tool_call_list),
                is_tool_call=True
            )
        self._history_messages.append(local_messages.model_dump())

    def format_messages_str(self, messages: List[LLMMessage]) -> str:
        """Summarize current messages."""
        content_str = "The conversations:\n\n"
        for message in messages:
            if isinstance(message, SystemMessage):
                content_str += f"System: {message.content}\n"
            elif isinstance(message, UserMessage):
                content_str += f"{message.source}: {message.content}\n"
            elif isinstance(message, AssistantMessage):
                content_str += f"{message.source}: {message.content}\n"
            elif isinstance(message, FunctionExecutionResultMessage):
                content_str += f"Tool Calling: {str(message.content)}\n"
        return content_str
    
    async def get_messages(
            self, 
            cancellation_token: CancellationToken = None) -> List[LLMMessage]:
        """Get at most `token_limit` tokens in recent messages. If the token limit is not
        provided, then return as many messages as the remaining token allowed by the model client."""
        messages = list(self._messages)
       
        try:
            if self._token_limit is not None:
                token_count = self._model_client.count_tokens(messages, tools=self._tool_schema)
                if token_count > self._token_limit:
                    messages_str = self.format_messages_str(messages)
                    compressed_response = await self._model_client.create(
                        messages=[
                            UserMessage(source="user", content=self._compression_prompt+messages_str)
                        ],
                        cancellation_token=cancellation_token,
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
                    
                    # Update messages
                    self._messages = remaining_messages
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
            # Update messages
            self._messages = messages
            return messages

    async def create_new_session_document(
        self,
        user_id: Optional[str] = None,
        dataset_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        work_dir: Optional[str] = None,
        create_type: str = "session" # or learning_memory
        ) -> str:
        """
        Create a temporary file named {user_id}_{thread_id}.txt in work_dir,
        upload it to RAGFlow, then attach user_id and thread_id as meta_fields.

        Returns:
            The document_id of the newly created document.
        """
        if self._rag_flow_manager is None:
            raise ValueError("RAGFlow manager is not configured.")
        
        user_id = user_id or self._user_id
        dataset_id = dataset_id or self._dataset_id
        thread_id = thread_id or self._thread_id
        work_dir = work_dir or self._work_dir

        # 1. cerate session document
        if create_type == "learning_memory":
            file_name = f"{user_id}_learning_memory.txt"
            meta_fields = {"user_id": user_id, "learning_dataset_id": dataset_id}
        else:
            file_name = f"{user_id}_{thread_id}.txt"
            meta_fields={"user_id": user_id, "thread_id": thread_id},
        file_path = os.path.join(work_dir, file_name)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(f"user_id: {user_id}\nthread_id: {thread_id}\n")

        try:
            # 2. upload to RAGFlow and get document_id
            document_ids = await self._rag_flow_manager.add_files_to_dataset_and_parse(
                dataset_id=dataset_id,
                files_path=file_path,
            )
            document_id = document_ids[0]

            # 3. write user_id / thread_id to document meta
            await self._rag_flow_manager.update_document(
                dataset_id=dataset_id,
                document_id=document_id,
                meta_fields=meta_fields,
            )
        finally:
            # 4. delete the temporary file
            if os.path.exists(file_path):
                os.remove(file_path)

        if create_type == "learning_memory":
            self._learning_document_id = document_id
        else:
            self._document_id = document_id

        logger.info(f"Session document: {document_id} created for user_id: {user_id}, thread_id: {thread_id}")

        return document_id

    async def upload_conversation_to_ragflow(
            self, 
            current_messages: Optional[List[LLMMessage]] = None,
            document_id: Optional[str] = None,
            important_keywords: Optional[List[str]] = None,
            questions: Optional[List[str]] = None
            ) -> str:
        """Upload the conversation to RAGFlow."""

        current_messages = current_messages or self._current_messages
        if self._rag_flow_manager:
            for message in current_messages:
                if isinstance(message, UserMessage):
                    questions = [message.content]
                    continue
                await self._rag_flow_manager.add_chunks_to_dataset(
                    dataset_id = self._dataset_id,
                    document_id = document_id or self._document_id,
                    content = message.content,
                    important_keywords = important_keywords,
                    questions = questions)

    async def summry_conversation_to_ragflow(
            self, 
            current_messages: Optional[List[LLMMessage]] = None,
            summary_task_prompt: Optional[str] = None,
            dataset_id: Optional[str] = None,
            document_id: Optional[str] = None,
            thread_id: Optional[str] = None,
            cancellation_token: Optional[CancellationToken] = None,
            ) -> str:
        """Summarize the conversation."""
        
        if self._rag_flow_manager is None:
            raise ValueError("RAGFlow manager is not configured.")
        current_messages = current_messages or self._current_messages
        questions = [message.content for message in current_messages if message.source == "user" or message.source == "user_proxy"]
        summry_prompt = summary_task_prompt or self._summary_task_prompt
        messages_str = self.format_messages_str(current_messages)
        summry_response = await self._model_client.create(
            messages=[
                UserMessage(source="user", content=summry_prompt+messages_str)
            ],
            cancellation_token=cancellation_token,
        )
        summry_content = summry_response.content
        # judgment_tools = [get_judgment_tool()]
        # messages_str = self.format_messages_str(current_messages)
        # summry_response = await self._model_client.create(
        #     messages=[
        #         UserMessage(source="user", content=summry_prompt+messages_str)
        #     ],
        #     tools=judgment_tools,
        #     cancellation_token=cancellation_token,
        # )
        # summry_content = summry_response.content

        # thread_id = thread_id or self._thread_id

        # if isinstance(summry_content, list):
        #     arguments = json.loads(summry_content[0].arguments)
        #     if arguments.get("be_documented", False):
        #         summry_response = await self._model_client.create(
        #             messages=[
        #                 UserMessage(source="user", content=summry_prompt+messages_str)
        #             ],
        #             cancellation_token=cancellation_token,
        #         )
        #         summry_content = summry_response.content
        #     else:
        #         return "The conversation is not summarized."
        
        await self._rag_flow_manager.add_chunks_to_dataset(
            dataset_id = dataset_id,
            document_id = document_id,
            content = summry_content,
            questions = questions,
            important_keywords = [f"thread_id:{thread_id}"]
            )
        logger.info(f"Summarized conversation added to RAGFlow for thread_id: {thread_id}")
        return str(summry_content)
    
    async def summry_conversation_to_memory(
            self,
            summary_task_prompt: Optional[str] = None
            ) -> None:
        """Summarize the conversation by user's prompt.
        
        Arguments:
            summary_task_prompt: The user's request for summarizing the conversation.
        
        Note:
            If the specific summarizing request is not provided , the default prompt will be used.
        """

        try:
            summry_content = await self.summry_conversation_to_ragflow(
                summary_task_prompt=summary_task_prompt,
                dataset_id=self._learning_dataset_id,
                document_id=self._learning_document_id
                )
            return f"Summarized conversation added to RAGFlow, The summry_content is: \n{summry_content}"
        except Exception as e:
            logger.error(f"Failed to summarize conversation: {e}")
            return "Failed to summarize conversation"

    def _extract_thread_id(self, chunk: Dict[str, Any]) -> Optional[str]:
        """ extract the type of 'thread_id:...' from the chunk"""
        for kw in chunk.get('important_keywords', []):
            if isinstance(kw, str) and kw.startswith('thread_id:'):
                return kw[10:]
        return "null"

    async def retreve_from_memory(
        self, 
        question: str,
        document_ids: List[str] = [],
        page_size: int = 10,
        similarity_threshold: float = 0.2,
        vector_similarity_weight: float = 0.3,
        top_k: int = 1024,
        rerank_id: str = "hepai/bge-reranker-v2-m3___OpenAI-API@OpenAI-API-Compatible",
        keyword: bool = True,
        cross_languages: list[str] = ["English", "Chinese"],
        metadata_condition: Optional[Dict[str, str]] = None,
        # user_id: Optional[str] = None,
        # thread_id: Optional[str] = None,
        ) -> str:
        """Retrieve relevant information from memory. No special requirements, just input the question.
        
        Arguments:
            question: The question to retrieve relevant information.
            document_ids: The document_ids to retrieve relevant information. Default is [].
            page_size: The number of chunks to retrieve. Default is 10.
            similarity_threshold: The similarity threshold. Default is 0.2.
            vector_similarity_weight: The vector similarity weight. Default is 0.3.
            top_k: The top_k. Default is 1024.
            rerank_id: The rerank_id. Default is "hepai/bge-reranker-v2-m3___OpenAI-API@OpenAI-API-Compatible".
            keyword: Whether to use keyword. Default is True.
            cross_languages: The cross_languages. Default is ["English", "Chinese"].
        
        Return:
                The string of relevant information.
        """
        kwargs: Dict[str, Any] = dict(
            question=question,
            dataset_ids=[self._dataset_id],
            similarity_threshold=similarity_threshold,
            vector_similarity_weight=vector_similarity_weight,
            page_size=page_size,
            top_k=top_k,
            rerank_id=rerank_id,
            keyword=keyword,
            cross_languages=cross_languages,
        )

        if document_ids:
            kwargs["document_ids"] = document_ids
            
        if metadata_condition:
            kwargs["metadata_condition"] = metadata_condition
        else:
            # user_id = user_id or self._user_id
            # thread_id = thread_id or self._thread_id , "thread_id": self._thread_id
            kwargs["metadata_condition"] = {"user_id": self._user_id}
        
        raw = await self._rag_flow_manager.retrieve_chunks_by_content(**kwargs)
        chunks = raw.get('chunks', []) if raw else []
        for chunk in chunks:
            thread_id = self._extract_thread_id(chunk)
            chunk["thread_id"] = thread_id

        if len(chunks) > 0:
            return "**Relevant information:** \n" + "\n".join(
                [f'Session_ID: {chunk["thread_id"]}\n{chunk["content"]}' for chunk in chunks]
            )
        else:
            return "No relevant information found."

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


