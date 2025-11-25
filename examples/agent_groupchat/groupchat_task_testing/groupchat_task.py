from drsai.modules.components.model_client.LLMClient import HepAIChatCompletionClient
from drsai.modules.components.task_manager.base_task_system import Task, TaskStatus
from drsai.modules.managers.database.db_manager import DatabaseManager
from drsai.modules.groupchat import DrSaiBaseGroupChatRunner, DrSaiBaseGroupChatRunnerConfig
from drsai.modules.components.groupchat_running.base_running_deamon import(
    BaseRunTimeDeamon,
    GroupChatEvent,
    handle_group_chat_event,)


from autogen_core import (
    ComponentModel,
    Component,
    AgentId,
    CancellationToken,
    SingleThreadedAgentRuntime,
    AgentRuntime
)

from autogen_agentchat.base import (
    ChatAgent, 
    TaskResult, 
    TerminationCondition)

from autogen_agentchat.base import Response

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
    StructuredMessageFactory,
    MultiModalMessage,
    Image,
    StopMessage,
    MessageFactory,
)

from autogen_core.models import  (
    CreateResult,
    LLMMessage,
    SystemMessage,
    UserMessage,
    AssistantMessage,
)
from autogen_core.model_context import (
    ChatCompletionContext,
    UnboundedChatCompletionContext,
)

from autogen_agentchat.state import BaseState, TeamState
from autogen_agentchat.teams._group_chat._events import (
    GroupChatAgentResponse,
    GroupChatError,
    GroupChatMessage,
    GroupChatPause,
    GroupChatRequestPublish,
    GroupChatReset,
    GroupChatResume,
    GroupChatStart,
    GroupChatTermination,
    SerializableException,
    )

from pydantic import BaseModel
from typing import (
    List, 
    Dict, 
    Any, 
    Mapping, 
    Optional, 
    Union, 
    Callable, 
    TypeVar, 
    Type, 
    Tuple, 
    cast,
    Sequence)
import asyncio
import json

class TaskManagerState(BaseState):
    """The state of the RoundRobinGroupChatManager."""

    message_thread: List[Dict[str, Any]] = []
    current_turn: int = 0
    is_paused: bool = False
    is_running: bool = False
    task_history: List[Task|Mapping[str, Any]] = []


class TaskGroupChatManager(DrSaiBaseGroupChatRunner):

    component_provider_override = "drsai.TaskGroupChatManager"

    def __init__(
        self,
        name: str,
        self_id: str,
        max_turns: int,
        participant_instances: Dict[str, ChatAgent],
        output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination],
        termination_condition: TerminationCondition,
        model_client: HepAIChatCompletionClient = None,
        messages_history: List[BaseChatMessage] = [],
        sequential_message_types: List[GroupChatEvent] = [
            GroupChatStart, # handle start messages
            GroupChatAgentResponse, # handle agent responses
            GroupChatMessage, # handle GroupChat system messages
            GroupChatPause, # handle pause messages
            GroupChatResume, # handle resume messages
            GroupChatTermination, # handle termination messages
            GroupChatError, # handle error messages
            GroupChatReset, # handle reset messages
            GroupChatRequestPublish, # handle request publish messages
        ],
        emit_team_events: bool = False,
        run_time_deamon: BaseRunTimeDeamon | None = None,
        model_context: ChatCompletionContext | None = None,
    ):
        super().__init__(
            name = name,
            self_id = self_id,
            max_turns = max_turns,
            participant_instances = participant_instances,
            output_message_queue = output_message_queue,
            termination_condition = termination_condition,
            model_client = model_client,
            messages_history = messages_history,
            sequential_message_types = sequential_message_types,
            emit_team_events = emit_team_events,
        )

        self._run_time_deamon: BaseRunTimeDeamon = run_time_deamon
        if self._run_time_deamon is None:
            raise ValueError("run_time_deamon must be provided")
        self._task_systemmessage = SystemMessage(content=f"""You are a task manager assistant. Your particpants' infomation is as follows:\n {self._participant_name_to_descriptions}
你需要根据用户的需求和你的particpants功能描述，讲用户的任务进行拆解，制定计划，按照如下的json格式输出。
{[
    {
        "task_content": "实现用户需求的任务第一步计划具体内容",
        "operator": "实现该任务的participant名称"
    },
    {
        "task_content": "实现用户需求的任务第二步计划具体内容",
        "operator": "实现该任务的participant名称"
    }
]}

案例：                                
用户要求：查询opendrsai的相关功能
你的输出应该是：
{[
    {
        "task_content": "查询opendrsai的相关信息",
        "operator": "searcher"
    },
    {
        "task_content": "总结回复用户关于opendrsai的相关信息",
        "operator": "writer"
    }
]}                              
"""
        )
        if model_context is not None:
                self._model_context = model_context
        else:
            self._model_context = UnboundedChatCompletionContext()
        
        if self._messages_history:
            asyncio.create_task(self._add_messages_to_context(self._model_context, self._messages_history))
        
        self._result_json: List[Dict[str, Any]] = []
    
    @staticmethod
    async def _add_messages_to_context(
        model_context: ChatCompletionContext,
        messages: Sequence[BaseChatMessage],
    ) -> None:
        """
        Add incoming messages to the model context.
        """
        for msg in messages:
            if isinstance(msg, HandoffMessage):
                for llm_msg in msg.context:
                    await model_context.add_message(llm_msg)
            await model_context.add_message(msg.to_model_message())

    async def _log_groupchat_message(self, message: Union[BaseAgentEvent | BaseChatMessage | GroupChatTermination]) -> None:
        await self._output_message_queue.put(message)


    @handle_group_chat_event
    async def handle_start(self, message: GroupChatStart, cancellation_token: CancellationToken | None = None) -> None:
        
        try:
            self._add_messages_to_context(self._model_context, message.messages)
            all_messages = await self._model_context.get_messages()
            result: CreateResult|None = None 
            async for chunk in self._model_client.create_stream(
                messages = all_messages,
                cancellation_token = cancellation_token,
                json_output=True,
            ):
                if isinstance(chunk, str):
                    await self._log_groupchat_message(ModelClientStreamingChunkEvent(source=self._name, content=chunk))
                elif isinstance(chunk, CreateResult):
                    result = chunk
                else:
                    raise ValueError(f"Unexpected chunk type: {type(chunk)}")
            self._result_json = json.loads(result.content)
            self._run_time_deamon.send_message(
                message = GroupChatAgentResponse(
                    TextMessage(source=self._name, content=json.dumps(self._result_json))),
                recipient_id = self._self_id,
                recipient_type = GroupChatAgentResponse,
            )
        except Exception as e:
            error = SerializableException(error=str(e))
            termination_event = GroupChatTermination(
                message=StopMessage(content="An error occurred in the group chat.", source=self._name), error=error
            )
            await self._log_groupchat_message(termination_event)
            return
        
    @handle_group_chat_event
    async def handle_agent_response(self, message: GroupChatAgentResponse, cancellation_token: CancellationToken | None = None) -> None:
        pass
    
    @handle_group_chat_event
    async def handle_group_chat_message(self, message: GroupChatMessage, cancellation_token: CancellationToken | None = None) -> None:
        """Handle a group chat message by appending the content to its output message queue."""
        await self._log_groupchat_message(message.message)
    
    @handle_group_chat_event
    async def handle_group_chat_error(self, message: GroupChatError, cancellation_token: CancellationToken | None = None) -> None:
        """Handle a group chat error by logging the error and signaling termination."""
        error = message.error
        termination_event = GroupChatTermination(
            message=StopMessage(content="An error occurred in the group chat.", source=self._name), error=error
        )
        await self._log_groupchat_message(termination_event)

    @handle_group_chat_event
    async def handle_reset(self, message: GroupChatReset, cancellation_token: CancellationToken | None = None) -> None:
        """Reset the group chat manager. Calling :meth:`reset` to reset the group chat manager
        and clear the message thread."""
        await self.reset()

    @handle_group_chat_event
    async def handle_pause(self, message: GroupChatPause, cancellation_token: CancellationToken | None = None) -> None:
        """Pause the group chat manager. This is a no-op in the base class."""
        pass

    @handle_group_chat_event
    async def handle_resume(self, message: GroupChatResume, cancellation_token: CancellationToken | None = None) -> None:
        """Resume the group chat manager. This is a no-op in the base class."""
        pass

    async def select_speaker(self, thread: List[BaseAgentEvent | BaseChatMessage]) -> str:
        """Select a speaker from the participants and return the
        topic type of the selected speaker."""
        pass
    
    async def publish_messages_to_participants(
            self, 
            messages: List[BaseChatMessage], 
            speaker_name: str, 
            cancellation_token: CancellationToken | None = None) -> None:
        """Select a speaker from the participants and return the
        topic type of the selected speaker."""
        pass

    async def reset(self) -> None:
        """Reset the team and all its participants to its initial state."""
        pass

    async def pause(self) -> None:
        """Pause the team and all its participants. This is useful for
        pausing the :meth:`autogen_agentchat.base.TaskRunner.run` or
        :meth:`autogen_agentchat.base.TaskRunner.run_stream` methods from
        concurrently, while keeping them alive."""
        pass

    async def resume(self) -> None:
        """Resume the team and all its participants from a pause after
        :meth:`pause` was called."""
        pass

    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the team."""
        pass

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the team."""
        pass

    async def validate_group_state(self, messages: List[BaseChatMessage] | None) -> None:
        """Validate the state of the group chat given the start messages.
        This is executed when the group chat manager receives a GroupChatStart event.

        Args:
            messages: A list of chat messages to validate, or None if no messages are provided.
        """
        pass

    def _to_config(self):
        pass


# class TaskGroupChatConfig(BaseModel):
#     """The declarative configuration RoundRobinGroupChat."""

#     participants: List[ComponentModel]
#     termination_condition: ComponentModel | None = None
#     max_turns: int | None = None
#     task_history: List[Task|Mapping[str, Any]] = []
#     emit_team_events: bool = False


# class TaskGroupChat(DrSaiGroupChat, Component[TaskGroupChatConfig]):

#     component_config_schema = TaskGroupChatConfig
#     component_description = "A group chat that manages tasks."
#     component_type = "team"
#     component_provider_override = "drsai.TaskGroupChat"

#     def __init__(
#         self,
#         participants: List[ChatAgent],
#         termination_condition: TerminationCondition | None = None,
#         max_turns: int | None = None,
#         runtime: AgentRuntime | None = None,
#         custom_message_types: List[type[BaseAgentEvent | BaseChatMessage]] | None = None,
#         emit_team_events: bool = False,
#     ) -> None:
#         super().__init__(
#             participants,
#             group_chat_manager_name="TaskGroupChatManager",
#             group_chat_manager_class=TaskGroupChatManager,
#             termination_condition=termination_condition,
#             max_turns=max_turns,
#             runtime=runtime,
#             custom_message_types=custom_message_types,
#             emit_team_events=emit_team_events,
#         )