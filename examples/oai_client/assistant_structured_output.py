import sys
import os
try:
    import drsai
except ImportError:
    current_file_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_file_path)
    drsai_path = os.path.abspath(os.path.join(current_directory, "../../"))
    sys.path.append(drsai_path)


from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, run_hepai_worker, run_backend
import os, json
import asyncio
from pydantic import BaseModel

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
def create_agent() -> AssistantAgent:
    
    class Step(BaseModel):
        explanation: str
        output: str

    class MathReasoning(BaseModel):
        steps: list[Step]
        final_answer: str
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
        # api_key=os.environ.get("HEPAI_API_KEY"),
        
    )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return AssistantAgent(
        name="weather_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
        output_content_type = MathReasoning,
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
    )


async def main():

    drsaiapp = DrSaiAPP(agent_factory=create_agent)
    stream =  drsaiapp.a_start_chat_completions(
        messages=[
        {"role": "system", "content": "You are a helpful math tutor. Guide the user through the solution step by step."},
        {"role": "user", "content": "how can I solve 8x + 7 = -23"}
    ],
        stream=True,)

    async for message in stream:
        oai_json = json.loads(message.split("data: ")[1])
        textchunck = oai_json["choices"][0]["delta"]["content"]
        if textchunck:
            sys.stdout.write(textchunck)
            sys.stdout.flush()
    print()


if __name__ == "__main__":
    asyncio.run(main())
    from drsai import run_console, run_backend, run_hepai_worker, run_openwebui, run_pipelines,run_drsai_app
    # asyncio.run(run_console(agent_factory=create_agent, task="What is the weather in New York?"))
    # asyncio.run(run_backend(agent_factory=create_agent))
    # asyncio.run(run_hepai_worker(agent_factory=create_agent))
    # asyncio.run(run_backend(agent_factory=create_agent, enable_openwebui_pipeline=True))