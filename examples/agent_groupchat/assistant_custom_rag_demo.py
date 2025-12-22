from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.components.tool import (
    CancellationToken,
)
from drsai.modules.baseagent import DrSaiAgent, LLMMessage
from drsai.backend import run_worker, run_console, DrSaiAPP
import os, json, sys
import asyncio
from typing import List, Dict
# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent() -> DrSaiAgent:

    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key=os.environ.get("HEPAI_API_KEY"),
    )


    # Define a simple rag-demo for the assistant.
    async def rag_demo(
            messages: List[Dict], 
            llm_messages: List[LLMMessage], 
            model_client: HepAIChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,
            **kwargs
            ):
        query = messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
        retrieve_txt = "1. Humans will be destroyed by AI in 2050;\n2. Humans are destroyed by AI due to their arrogance and conceit."
        last_txt = f"""The following are some reference materials, and you must refer to these materials to answer the question:\n{retrieve_txt}. My question is: {query}"""
        messages[-1]["content"] = last_txt
        return messages



    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return DrSaiAgent(
        name="weather_agent",
        model_client=model_client,
        memory_function=rag_demo,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[{"content":"Why will humans be destroyed", "role":"user"}],
        stream=True,
        use_api_key_mode = "frontend",  # Use frontend API key mode
        api_key = os.environ.get("HEPAI_API_KEY"),
        )

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()


if __name__ == "__main__":
    # asyncio.run(main())
    asyncio.run(run_console(agent_factory=create_agent, task="Why will humans be destroyed"))
    # asyncio.run(run_backend(
    #     agent_factory=create_agent, 
    #     port = 42805, 
    #     enable_openwebui_pipeline=True, 
    #     history_mode = "backend",
    #     use_api_key_mode = "backend")
    #     )