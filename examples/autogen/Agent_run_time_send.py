import asyncio
from dataclasses import dataclass
from autogen_core import AgentId, MessageContext, RoutedAgent, SingleThreadedAgentRuntime, message_handler

@dataclass
class MyMessage:
    content: str

class MyAgent(RoutedAgent):
    @message_handler
    async def handle_my_message(self, message: MyMessage, ctx: MessageContext) -> None:
        print(f"Received message: {message.content}")

async def main() -> None:
    # Create a runtime and register the agent
    runtime = SingleThreadedAgentRuntime()
    await MyAgent.register(runtime, "my_agent", lambda: MyAgent("My agent"))

    # Start the runtime, send a message and stop the runtime
    runtime.start()
    await runtime.send_message(MyMessage("Hello, world!"), recipient=AgentId("my_agent", "default"))
    await runtime.stop()


asyncio.run(main())
