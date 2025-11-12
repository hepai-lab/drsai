import asyncio

from typing import Any, List, Sequence, Mapping, Dict, cast

from autogen_core import DefaultTopicId, MessageContext, event, rpc

from autogen_agentchat.base import ChatAgent, TaskResult, TerminationCondition, Response
from autogen_agentchat.messages import (
    BaseAgentEvent, 
    AgentEvent, 
    BaseChatMessage, 
    ChatMessage, 
    MessageFactory,
    ModelClientStreamingChunkEvent, 
    SelectSpeakerEvent,
    StopMessage,
    TextMessage)
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
from drsai.modules.managers.messages.groupchat_messages import (
    GroupChatAgentLongTask,
    GroupChatLazyInit,
    GroupChatClose
    )
from drsai.modules.groupchat.drsai_base_groupchat_manager import DrSaiBaseGroupChatManager
from drsai.modules.components.task_manager.base_task_system import TaskStatus
from drsai.modules.managers.messages.agent_messages import (
    AgentLongTaskMessage, 
    LongTaskQueryMessage,
    DrSaiMessageFactory,
    )
from drsai.modules.managers.database import DatabaseManager

from loguru import logger
from autogen_agentchat.state import BaseState, TeamState

class RoundRobinManagerState(BaseState):
    """The state of the RoundRobinGroupChatManager."""
    type: str = "RoundRobinManagerState"
    version: str = "0.1.0"
    message_thread: List[Dict[str, Any]] = []
    current_turn: int = 0
    next_speaker_index: int = 0
    is_paused: bool = False

class RoundLongTaskGroupChatManager(DrSaiBaseGroupChatManager):
    """Base class for a group chat manager that manages a group chat with multiple participants.

    It is the responsibility of the caller to ensure:
    - All participants must subscribe to the group chat topic and each of their own topics.
    - The group chat manager must subscribe to the group chat topic.
    - The agent types of the participants must be unique.
    - For each participant, the agent type must be the same as the topic type.

    Without the above conditions, the group chat will not function correctly.
    """

    def __init__(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[BaseAgentEvent | BaseChatMessage | GroupChatTermination],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: MessageFactory,
        emit_team_events: bool = False,
        db_manager: DatabaseManager = None,
        long_task_topic_type: str|None = None,
    ):
        super().__init__(
            name=name,
            group_topic_type=group_topic_type,
            output_topic_type=output_topic_type,
            participant_topic_types=participant_topic_types,
            participant_names=participant_names,
            participant_descriptions=participant_descriptions,
            output_message_queue=output_message_queue,
            termination_condition=termination_condition,
            max_turns=max_turns,
            message_factory=message_factory,
            emit_team_events=emit_team_events,
            db_manager=db_manager,
            long_task_topic_type=long_task_topic_type,
        )

        self._next_speaker_index = 0

    @rpc
    async def handle_lazy_init(self, message: GroupChatLazyInit, ctx: MessageContext) -> None:
        """Handle the lazy_init for a group chat."""
        pass

    @rpc
    async def handle_start(self, message: GroupChatStart, ctx: MessageContext) -> None:
        """Handle the start of a group chat by selecting a speaker to start the conversation."""

        # Check if the conversation has already terminated.
        if self._is_paused:
            return
        
        if (
            self._termination_condition is not None
            and self._termination_condition.terminated
        ):
            early_stop_message = StopMessage(
                content="The group chat has already terminated.", source=self._name
            )
            await self._signal_termination(early_stop_message)
            return

        assert message is not None and message.messages is not None

        # Send message to all agents with initial user message
        await self.publish_message(
            GroupChatStart(messages=message.messages),
            topic_id=DefaultTopicId(type=self._group_topic_type),
            cancellation_token=ctx.cancellation_token,
        )

        # Add messages to thread
        for m in message.messages:
            self._message_thread.append(m)

        # Select a speaker to start/continue the conversation
        speaker_name_future = asyncio.ensure_future(self.select_speaker(self._message_thread))
        # Link the select speaker future to the cancellation token.
        ctx.cancellation_token.link_future(speaker_name_future)
        speaker_name = await speaker_name_future
        if speaker_name not in self._participant_name_to_topic_type:
            raise RuntimeError(f"Speaker {speaker_name} not found in participant names.")
        await self._log_speaker_selection(speaker_name)

        # send request to next speaker
        await self.publish_message(
            GroupChatRequestPublish(),
            topic_id=DefaultTopicId(
                type=self._participant_name_to_topic_type[speaker_name]
            ),
            cancellation_token=ctx.cancellation_token,
        )

    async def update_message_thread(self, messages: Sequence[BaseAgentEvent | BaseChatMessage]) -> None:
        self._message_thread.extend(messages)

    @event
    async def handle_long_task(self, message: GroupChatAgentLongTask, ctx: MessageContext) -> None:
        """Handle Agent's long task."""

        if self._is_paused:
            return

        long_task_message: AgentLongTaskMessage | LongTaskQueryMessage = message.message

        # handle agent long task response
        if isinstance(long_task_message, AgentLongTaskMessage):
            if long_task_message.task_status == TaskStatus.in_progress.value:
                await asyncio.sleep(10)
                query_message = LongTaskQueryMessage(
                    source=self._name,
                    content = long_task_message.query_arguments,
                    tool_name=long_task_message.tool_name,
                    query_arguments=long_task_message.query_arguments,
                )
                # 发布到专门的长任务 topic,只有对应的 agent 能接收
                await self.publish_message(
                    GroupChatAgentLongTask(message=query_message),
                    topic_id=DefaultTopicId(type=self._long_task_topic_type),
                    cancellation_token=ctx.cancellation_token,
                )
            else:
                await self.publish_message(
                    GroupChatAgentResponse(agent_response=Response(chat_message = long_task_message, )),
                    topic_id=DefaultTopicId(type=self._group_topic_type),
                    cancellation_token=ctx.cancellation_token,
                )

    @event
    async def handle_agent_response(self, message: GroupChatAgentResponse, ctx: MessageContext) -> None:
        try:
            if self._is_paused:
                return
        
            delta: List[BaseChatMessage] = []
            if message.agent_response.inner_messages is not None:
                for inner_message in message.agent_response.inner_messages:
                    delta.append(inner_message)  # type: ignore
                    self._message_thread.append(inner_message)  # type: ignore

            # Add the agent's response to the thread
            self._message_thread.append(message.agent_response.chat_message)
            delta.append(message.agent_response.chat_message)

            is_terminated = await self._apply_termination_condition(delta, increment_turn_count=True)
            if is_terminated:
                return

            # Select a speaker to start/continue the conversation
            speaker_name_future = asyncio.ensure_future(self.select_speaker(self._message_thread))
            # Link the select speaker future to the cancellation token.
            ctx.cancellation_token.link_future(speaker_name_future)
            next_speaker = await speaker_name_future
            if next_speaker not in self._participant_name_to_topic_type:
                raise RuntimeError(f"Speaker {next_speaker} not found in participant names.")
            await self._log_speaker_selection(next_speaker)

            # send request to next speaker
            await self.publish_message(
                GroupChatRequestPublish(),
                topic_id=DefaultTopicId(
                    type=self._participant_name_to_topic_type[next_speaker]
                ),
                cancellation_token=ctx.cancellation_token,
            )
        except Exception as e:
            # Handle the exception and signal termination with an error.
            error = SerializableException.from_exception(e)
            await self._signal_termination_with_error(error)
            # Raise the exception to the runtime.
            raise

    async def _apply_termination_condition(
        self, delta: Sequence[BaseAgentEvent | BaseChatMessage], increment_turn_count: bool = False
    ) -> bool:
        """Apply the termination condition to the delta and return True if the conversation should be terminated.
        It also resets the termination condition and turn count, and signals termination to the caller of the team."""
        if self._termination_condition is not None:
            stop_message = await self._termination_condition(delta)
            if stop_message is not None:
                # Reset the termination conditions and turn count.
                await self._termination_condition.reset()
                self._current_turn = 0
                # Signal termination to the caller of the team.
                await self._signal_termination(stop_message)
                # Stop the group chat.
                return True
        if increment_turn_count:
            # Increment the turn count.
            self._current_turn += 1
        # Check if the maximum number of turns has been reached.
        if self._max_turns is not None:
            if self._current_turn >= self._max_turns:
                stop_message = StopMessage(
                    content=f"Maximum number of turns {self._max_turns} reached.",
                    source=self._name,
                )
                # Reset the termination conditions and turn count.
                if self._termination_condition is not None:
                    await self._termination_condition.reset()
                self._current_turn = 0
                # Signal termination to the caller of the team.
                await self._signal_termination(stop_message)
                # Stop the group chat.
                return True
        return False

    async def _log_speaker_selection(self, speaker_name: str) -> None:
        """Log the selected speaker to the output message queue."""
        select_msg = SelectSpeakerEvent(content=[speaker_name], source=self._name)
        if self._emit_team_events:
            await self.publish_message(
                GroupChatMessage(message=select_msg),
                topic_id=DefaultTopicId(type=self._output_topic_type),
            )
            await self._output_message_queue.put(select_msg)

    async def _signal_termination(self, message: StopMessage) -> None:
        termination_event = GroupChatTermination(message=message)
        # Log the early stop message.
        await self.publish_message(
            termination_event,
            topic_id=DefaultTopicId(type=self._output_topic_type),
        )
        # Put the termination event in the output message queue.
        await self._output_message_queue.put(termination_event)

    async def _signal_termination_with_error(self, error: SerializableException) -> None:
        termination_event = GroupChatTermination(
            message=StopMessage(content="An error occurred in the group chat.", source=self._name), error=error
        )
        # Log the termination event.
        await self.publish_message(
            termination_event,
            topic_id=DefaultTopicId(type=self._output_topic_type),
        )
        # Put the termination event in the output message queue.
        await self._output_message_queue.put(termination_event)

    @event
    async def handle_group_chat_message(self, message: GroupChatMessage, ctx: MessageContext) -> None:
        """Handle a group chat message by appending the content to its output message queue."""
        await self._output_message_queue.put(message.message)

    @event
    async def handle_group_chat_error(self, message: GroupChatError, ctx: MessageContext) -> None:
        """Handle a group chat error by logging the error and signaling termination."""
        await self._signal_termination_with_error(message.error)

    @rpc
    async def handle_reset(self, message: GroupChatReset, ctx: MessageContext) -> None:
        """Reset the group chat manager. Calling :meth:`reset` to reset the group chat manager
        and clear the message thread."""
        await self.reset()

    @rpc
    async def handle_pause(self, message: GroupChatPause, ctx: MessageContext) -> None:
        """Pause the group chat manager. This is a no-op in the base class."""
        await self.pause()

    @rpc
    async def handle_resume(self, message: GroupChatResume, ctx: MessageContext) -> None:
        """Resume the group chat manager. This is a no-op in the base class."""
        await self.resume()

    
    async def validate_group_state(self, messages: List[BaseChatMessage] | None) -> None:
        """Validate the state of the group chat given the start messages.
        This is executed when the group chat manager receives a GroupChatStart event.

        Args:
            messages: A list of chat messages to validate, or None if no messages are provided.
        """
        pass

    
    async def select_speaker(
        self, thread: List[BaseAgentEvent | BaseChatMessage]
    ) -> str:
        """Select a speaker from the participants in a round-robin fashion."""
        if self._is_paused:
            # If paused, let the user speak next
            for name in self._participant_names:
                if name == "user_proxy":
                    return name
            # If no user_proxy found, continue with round-robin

        current_speaker_index = self._next_speaker_index
        self._next_speaker_index = (current_speaker_index + 1) % len(
            self._participant_names
        )
        current_speaker = self._participant_names[current_speaker_index]
        return current_speaker

    async def save_state(self) -> Mapping[str, Any]:
        state = RoundRobinManagerState(
            message_thread=[
                cast(Dict[str, Any], message.dump()) for message in self._message_thread
            ],
            current_turn=0,
            next_speaker_index=0,
            is_paused=False,
        )
        return state.model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        round_robin_state = RoundRobinManagerState.model_validate(state)
        self._message_thread = [
            self._message_factory.create(message)
            for message in round_robin_state.message_thread
        ]
        self._current_turn = round_robin_state.current_turn
        self._next_speaker_index = round_robin_state.next_speaker_index
        self._is_paused = round_robin_state.is_paused

    async def pause(self) -> None:
        """Pause the group chat manager."""
        logger.info(f"Pausing RoundRobinGroupChatManager...")
        self._is_paused = True

    async def resume(self) -> None:
        """Resume the group chat manager."""
        self._is_paused = False

    async def close(self) -> None:
        """Close any resources."""
        self._is_paused = True
        logger.info(f"Closing RoundRobinGroupChatManager...")

    async def reset(self) -> None:
        """Reset the group chat manager."""
        self._current_turn = 0
        self._message_thread.clear()
        if self._termination_condition is not None:
            await self._termination_condition.reset()
        self._next_speaker_index = 0
        self._is_paused = False

    async def on_unhandled_message(self, message: Any, ctx: MessageContext) -> None:
        # raise ValueError(f"Unhandled message in group chat manager: {type(message)}")
        logger.warning(f"Unhandled message in group chat manager: {type(message)}")
