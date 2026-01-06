from typing import Any, List, Mapping
import json
from autogen_core import AgentId,DefaultTopicId, MessageContext, event, rpc

from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, MessageFactory

from autogen_agentchat.base import Response
from autogen_agentchat.state import ChatAgentContainerState
from autogen_agentchat.teams._group_chat._events import (
    GroupChatAgentResponse,
    GroupChatError,
    GroupChatMessage,
    GroupChatPause,
    GroupChatRequestPublish,
    GroupChatReset,
    GroupChatResume,
    GroupChatStart,
    SerializableException,
)
from drsai.modules.managers.messages.groupchat_messages import (
    GroupChatAgentLongTask,
    GroupChatLazyInit,
    GroupChatClose
    )
from drsai.modules.managers.messages.agent_messages import (
    AgentLongTaskMessage,
    LongTaskQueryMessage,
    )
from drsai.modules.baseagent.drsaiagent import DrSaiAgent
from drsai.utils.utils import construct_task
from autogen_agentchat.teams._group_chat._sequential_routed_agent import SequentialRoutedAgent
from loguru import logger

class DrSaiChatAgentContainer(SequentialRoutedAgent):
    """A core agent class that delegates message handling to an
    :class:`autogen_agentchat.base.ChatAgent` so that it can be used in a
    group chat team.

    Args:
        parent_topic_type (str): The topic type of the parent orchestrator.
        output_topic_type (str): The topic type for the output.
        agent (ChatAgent): The agent to delegate message handling to.
        message_factory (MessageFactory): The message factory to use for
            creating messages from JSON data.
    """

    def __init__(
        self,
        parent_topic_type: str,
        output_topic_type: str,
        agent: DrSaiAgent,
        message_factory: MessageFactory,
        long_task_topic_type: str | None = None,
    ) -> None:
        super().__init__(
            description=agent.description,
            sequential_message_types=[
                GroupChatStart,
                GroupChatRequestPublish,
                GroupChatReset,
                GroupChatAgentResponse,
                GroupChatAgentLongTask,
            ],
        )
        self._parent_topic_type = parent_topic_type
        self._output_topic_type = output_topic_type
        self._agent = agent
        self._message_buffer: List[BaseChatMessage] = []
        self._message_factory = message_factory
        # 专门用于长任务通信的 topic
        self._long_task_topic_type = long_task_topic_type or f"{parent_topic_type}_long_task"

    @rpc
    async def handle_lazy_init(self, message: GroupChatLazyInit, ctx: MessageContext) -> None:
        """Handle a lazy_init event by resetting the agent."""
        await self._agent.lazy_init(ctx.cancellation_token)

    @event
    async def handle_start(self, message: GroupChatStart, ctx: MessageContext) -> None:
        """Handle a start event by appending the content to the buffer."""
        if message.messages is not None:
            for msg in message.messages:
                self._buffer_message(msg)

    @event
    async def handle_agent_response(self, message: GroupChatAgentResponse, ctx: MessageContext) -> None:
        """Handle an agent response event by appending the content to the buffer."""
        if message.agent_response.chat_message.source == "user_proxy" and \
            message.agent_response.chat_message.metadata.get("attached_files"):
                query=message.agent_response.chat_message.metadata.get("content")
                files=json.loads(message.agent_response.chat_message.metadata.get("attached_files"))
                messages_return = construct_task(
                        query=query, 
                        files=files,
                    )
                for msg in messages_return:
                    self._buffer_message(msg)
        else:
            self._buffer_message(message.agent_response.chat_message)
    
    @event
    async def handle_long_task(self, message: GroupChatAgentLongTask, ctx: MessageContext) -> None:
        """Handle Agent's long task."""
        cancellation_token = ctx.cancellation_token

        # Only support one long task query here
        try:
            request_message: LongTaskQueryMessage = message.message
            if isinstance(request_message, LongTaskQueryMessage):
                await self._log_message(request_message)
            else:
                raise ValueError("Invalid message type.")

            if request_message is None:
                raise ValueError("No long task query message found.")

            response: Response | None = None
            async for msg in self._agent._process_long_task_query(
                task=request_message,
                cancellation_token=cancellation_token,
            ):
                if isinstance(msg, Response):
                    response = msg
                    await self._log_message(msg.chat_message)
                    # if AgentLongTaskMessage, publish the message with long task to the long_task_topic
                    if isinstance(msg.chat_message, AgentLongTaskMessage):
                        await self.publish_message(
                            GroupChatAgentLongTask(message=msg.chat_message),
                            topic_id=DefaultTopicId(type=self._long_task_topic_type),
                            cancellation_token=cancellation_token,
                        )
                    else:
                        # if other general textmessage, publish the message to the group chat manager for next round
                        await self.publish_message(
                            GroupChatAgentResponse(agent_response=response),
                            topic_id=DefaultTopicId(type=self._parent_topic_type),
                            cancellation_token=ctx.cancellation_token,
                        )
                else:
                    await self._log_message(msg)

        except Exception as e:
            # Publish the error to the group chat.
            error_message = SerializableException.from_exception(e)
            await self.publish_message(
                GroupChatError(error=error_message),
                topic_id=DefaultTopicId(type=self._parent_topic_type),
                cancellation_token=ctx.cancellation_token,
            )
            # Raise the error to the runtime.
            raise

    @rpc
    async def handle_reset(self, message: GroupChatReset, ctx: MessageContext) -> None:
        """Handle a reset event by resetting the agent."""
        self._message_buffer.clear()
        await self._agent.on_reset(ctx.cancellation_token)

    @event
    async def handle_request(self, message: GroupChatRequestPublish, ctx: MessageContext) -> None:
        """Handle a content request event by passing the messages in the buffer
        to the delegate agent and publish the response."""
        try:
            # Pass the messages in the buffer to the delegate agent.
            response: Response | None = None
            async for msg in self._agent.on_messages_stream(self._message_buffer, ctx.cancellation_token):
                if isinstance(msg, Response):
                    await self._log_message(msg.chat_message)
                    response = msg
                else:
                    await self._log_message(msg)
            if response is None:
                raise ValueError(
                    "The agent did not produce a final response. Check the agent's on_messages_stream method."
                )
            # Publish the response to the group chat.
            self._message_buffer.clear()

            if msg.chat_message.source=="user_proxy":
                if msg.chat_message.metadata.get("user_request"):
                    msg.chat_message.content = msg.chat_message.metadata.get("content")

            if isinstance(response.chat_message, AgentLongTaskMessage):
                # 发布到专门的长任务 topic
                await self.publish_message(
                    GroupChatAgentLongTask(message=response.chat_message),
                    topic_id=DefaultTopicId(type=self._long_task_topic_type),
                    cancellation_token=ctx.cancellation_token,
                )
            else:
                await self.publish_message(
                    GroupChatAgentResponse(agent_response=response),
                    topic_id=DefaultTopicId(type=self._parent_topic_type),
                    cancellation_token=ctx.cancellation_token,
                )
        except Exception as e:
            # Publish the error to the group chat.
            error_message = SerializableException.from_exception(e)
            await self.publish_message(
                GroupChatError(error=error_message),
                topic_id=DefaultTopicId(type=self._parent_topic_type),
                cancellation_token=ctx.cancellation_token,
            )
            # Raise the error to the runtime.
            raise

    def _buffer_message(self, message: BaseChatMessage) -> None:
        if not self._message_factory.is_registered(message.__class__):
            raise ValueError(f"Message type {message.__class__} is not registered.")
        # Buffer the message.
        self._message_buffer.append(message)

    async def _log_message(self, message: BaseAgentEvent | BaseChatMessage) -> None:
        if not self._message_factory.is_registered(message.__class__):
            raise ValueError(f"Message type {message.__class__} is not registered.")
        # Log the message.
        await self.publish_message(
            GroupChatMessage(message=message),
            topic_id=DefaultTopicId(type=self._output_topic_type),
        )

    @rpc
    async def handle_pause(self, message: GroupChatPause, ctx: MessageContext) -> None:
        """Handle a pause event by pausing the agent."""
        if hasattr(self._agent, "pause"):
            await self._agent.pause(ctx.cancellation_token)
        else:
            await self._agent.on_pause(ctx.cancellation_token)

    @rpc
    async def handle_resume(self, message: GroupChatResume, ctx: MessageContext) -> None:
        """Handle a resume event by resuming the agent."""
        if hasattr(self._agent, "resume"):
            await self._agent.resume(ctx.cancellation_token)
        else:
            await self._agent.on_resume(ctx.cancellation_token)
    
    @rpc
    async def handle_close(self, message: GroupChatClose, ctx: MessageContext) -> None:
        """Handle a lazy_init event by resetting the agent."""
        await self._agent.close(ctx.cancellation_token)

    async def on_unhandled_message(self, message: Any, ctx: MessageContext) -> None:
        # raise ValueError(f"Unhandled message in agent container: {type(message)}")
        logger.warning(f"Unhandled message in agent container: {type(message)}")

    async def save_state(self) -> Mapping[str, Any]:
        agent_state = await self._agent.save_state()
        state = ChatAgentContainerState(
            agent_state=agent_state, message_buffer=[message.dump() for message in self._message_buffer]
        )
        return state.model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        container_state = ChatAgentContainerState.model_validate(state)
        self._message_buffer = []
        for message_data in container_state.message_buffer:
            message = self._message_factory.create(message_data)
            if isinstance(message, BaseChatMessage):
                self._message_buffer.append(message)
            else:
                raise ValueError(f"Invalid message type in message buffer: {type(message)}")
        await self._agent.load_state(container_state.agent_state)
