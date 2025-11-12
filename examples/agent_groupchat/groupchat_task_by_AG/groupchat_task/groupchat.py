import asyncio
import uuid
from typing import Any, AsyncGenerator, Callable, Dict, List, Mapping, Sequence

from autogen_core import (
    AgentId,
    AgentRuntime,
    AgentType,
    CancellationToken,
    ComponentBase,
    SingleThreadedAgentRuntime,
    TypeSubscription,
)
from pydantic import BaseModel, ValidationError

from autogen_agentchat.base import ChatAgent, TaskResult, Team, TerminationCondition
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    MessageFactory,
    ModelClientStreamingChunkEvent,
    StopMessage,
    StructuredMessage,
    TextMessage,
)
from autogen_agentchat.state import BaseState, TeamState
from autogen_agentchat.teams._group_chat._chat_agent_container import ChatAgentContainer
from autogen_agentchat.teams._group_chat._events import (
    GroupChatPause,
    GroupChatReset,
    GroupChatResume,
    GroupChatStart,
    GroupChatTermination,
    SerializableException,
)
from autogen_agentchat.teams._group_chat._sequential_routed_agent import SequentialRoutedAgent
from drsai.modules.groupchat.drsai_base_agent_container import DrSaiChatAgentContainer
from drsai.modules.managers.messages.agent_messages import AgentLogEvent, TaskEvent, DrSaiMessageFactory
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.groupchat.drsai_base_group_chat import DrSaiBaseGroupChat
from .groupchat_manager import RoundRobinManagerState, RoundLongTaskGroupChatManager

class TaskGroupChat(DrSaiBaseGroupChat):

    def __init__(
        self,
        participants: List[ChatAgent],
        group_chat_manager_name: str = "RoundLongTaskGroupChatManager",
        group_chat_manager_class: type[SequentialRoutedAgent] = RoundLongTaskGroupChatManager,
        termination_condition: TerminationCondition | None = None,
        max_turns: int | None = None,
        runtime: AgentRuntime | None = None,
        custom_message_types: List[type[BaseAgentEvent | BaseChatMessage]] | None = None,
        emit_team_events: bool = False,
        db_manager: DatabaseManager|None = None,
        **kwargs: Any
    ):
        super().__init__(
            participants = participants,
            group_chat_manager_name = group_chat_manager_name,
            group_chat_manager_class = group_chat_manager_class,
            termination_condition = termination_condition,
            max_turns = max_turns,
            runtime = runtime,
            custom_message_types = custom_message_types,
            emit_team_events = emit_team_events,
            db_manager = db_manager,
            **kwargs
        )

    def _create_group_chat_manager_factory(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: List[str],
        participant_names: List[str],
        participant_descriptions: List[str],
        output_message_queue: asyncio.Queue[
            BaseAgentEvent | BaseChatMessage | GroupChatTermination
        ],
        termination_condition: TerminationCondition | None,
        max_turns: int | None,
        message_factory: DrSaiMessageFactory,
    ) -> Callable[[], RoundLongTaskGroupChatManager]:
        def _factory() -> RoundLongTaskGroupChatManager:
            return RoundLongTaskGroupChatManager(
                name,
                group_topic_type,
                output_topic_type,
                participant_topic_types,
                participant_names,
                participant_descriptions,
                output_message_queue,
                termination_condition,
                max_turns,
                message_factory,
                db_manager=self._db_manager,
                long_task_topic_type=self._long_task_topic_type,
            )

        return _factory
    
    async def _init(self, runtime: AgentRuntime) -> None:
        # Constants for the group chat manager.
        group_chat_manager_agent_type = AgentType(self._group_chat_manager_topic_type)

        # Register participants.
        # Use the participant topic type as the agent type.
        for participant, agent_type in zip(self._participants, self._participant_topic_types, strict=True):
            # Register the participant factory.
            await DrSaiChatAgentContainer.register(
                runtime,
                type=agent_type,
                factory=self._create_participant_factory(
                    self._group_topic_type,
                    self._output_topic_type,
                    participant,
                    self._message_factory,
                    self._long_task_topic_type,
                ),
            )
            # Add subscriptions for the participant.
            # The participant should be able to receive messages from its own topic.
            await runtime.add_subscription(TypeSubscription(topic_type=agent_type, agent_type=agent_type))
            # The participant should be able to receive messages from the group topic.
            await runtime.add_subscription(TypeSubscription(topic_type=self._group_topic_type, agent_type=agent_type))
            if participant.name == "Web_agent":
                # The participant should be able to receive messages from the long task topic.
                await runtime.add_subscription(
                    TypeSubscription(topic_type=self._long_task_topic_type, agent_type=agent_type)
                )

        # Register the group chat manager.
        await self._base_group_chat_manager_class.register(
            runtime,
            type=group_chat_manager_agent_type.type,
            factory=self._create_group_chat_manager_factory(
                name=self._group_chat_manager_name,
                group_topic_type=self._group_topic_type,
                output_topic_type=self._output_topic_type,
                participant_names=self._participant_names,
                participant_topic_types=self._participant_topic_types,
                participant_descriptions=self._participant_descriptions,
                output_message_queue=self._output_message_queue,
                termination_condition=self._termination_condition,
                max_turns=self._max_turns,
                message_factory=self._message_factory,
            ),
        )
        # Add subscriptions for the group chat manager.
        # The group chat manager should be able to receive messages from the its own topic.
        await runtime.add_subscription(
            TypeSubscription(
                topic_type=self._group_chat_manager_topic_type, agent_type=group_chat_manager_agent_type.type
            )
        )
        # The group chat manager should be able to receive messages from the group topic.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._group_topic_type, agent_type=group_chat_manager_agent_type.type)
        )
        # The group chat manager will relay the messages from output topic to the output message queue.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._output_topic_type, agent_type=group_chat_manager_agent_type.type)
        )
        # The group chat manager should be able to receive messages from the long task topic.
        await runtime.add_subscription(
            TypeSubscription(topic_type=self._long_task_topic_type, agent_type=group_chat_manager_agent_type.type)
        )

        self._initialized = True