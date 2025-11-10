from autogen_core import (
    DefaultTopicId,
    MessageContext,
    RoutedAgent,
    SingleThreadedAgentRuntime,
    default_subscription,
    message_handler,
)
from dataclasses import dataclass
import asyncio

@dataclass
class MyMessage:
    content: str


# The agent is subscribed to the default topic.
@default_subscription
class MyAgent(RoutedAgent):
    @message_handler
    async def handle_my_message(self, message: MyMessage, ctx: MessageContext) -> None:
        print(f"Received message: {message.content}")


async def main() -> None:
    # Create a runtime and register the agent
    runtime = SingleThreadedAgentRuntime()
    await MyAgent.register(runtime, "my_agent", lambda: MyAgent("My agent"))

    # Start the runtime.
    runtime.start()
    # Publish a message to the default topic that the agent is subscribed to.
    await runtime.publish_message(MyMessage("Hello, world!"), DefaultTopicId())
    # Wait for the message to be processed and then stop the runtime.
    await runtime.stop_when_idle()


asyncio.run(main())