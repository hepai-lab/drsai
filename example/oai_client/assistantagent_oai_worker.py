try:
    import drsai
except ImportError:
    import sys
    sys.path.append("../../drsai")

from drsai import AssistantAgent, HepAIChatCompletionClient, DrSaiAPP, Run_DrSaiAPP, run_hepai_worker, run_backend
import os, json
import asyncio

from dataclasses import dataclass, field
from drsai.version import __version__
from typing import Union, Dict
from hepai import HModelConfig, HWorkerConfig

# Define a model client. You can use other model client that implements
# the `ChatCompletionClient` interface.
model_client = HepAIChatCompletionClient(
    model="openai/gpt-4o",
    # api_key=os.environ.get("HEPAI_API_KEY"),
)


# Define a simple function tool that the agent can use.
# For this example, we use a fake weather tool for demonstration purposes.
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."


# Define an AssistantAgent with the model, tool, system message, and reflection enabled.
# The system message instructs the agent via natural language.
agent = AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    tools=[get_weather],
    system_message="You are a helpful assistant.",
    reflect_on_tool_use=False,
    model_client_stream=True,  # Enable streaming tokens from the model client.
)

@dataclass
class DrSaiModelConfig(HModelConfig):
    name: str = field(default="hepai/drsai", metadata={"help": "Model's name"})
    permission: Union[str, Dict] = field(default=None, metadata={"help": "Model's permission, separated by ;, e.g., 'groups: all; users: a, b; owner: c', will inherit from worker permissions if not setted"})
    version: str = field(default="2.0", metadata={"help": "Model's version"})

@dataclass
class DrSaiWorkerConfig(HWorkerConfig):
    host: str = field(default="0.0.0.0", metadata={"help": "Worker's address, enable to access from outside if set to `0.0.0.0`, otherwise only localhost can access"})
    port: int = field(default=42801, metadata={"help": "Worker's port, default is None, which means auto start from `auto_start_port`"})
    auto_start_port: int = field(default=42801, metadata={"help": "Worker's start port, only used when port is set to `auto`"})
    route_prefix: str = field(default="/apiv2", metadata={"help": "Route prefix for worker"})
    # controller_address: str = field(default="https://aiapi001.ihep.ac.cn", metadata={"help": "The address of controller"})
    controller_address: str = field(default="http://localhost:42601", metadata={"help": "The address of controller"})
    
    controller_prefix: str = field(default="/apiv2", metadata={"help": "Controller's route prefix"})
    no_register: bool = field(default=True, metadata={"help": "Do not register to controller"})
    
    permissions: str = field(default='users: admin, zdzhang@ihep.ac.cn,ddf_free', metadata={"help": "Model's permissions, separated by ;, e.g., 'groups: default; users: a, b; owner: c'"})
    description: str = field(default='This is Dr.Sai multi agents system', metadata={"help": "Model's description"})
    author: str = field(default=None, metadata={"help": "Model's author"})
    daemon: bool = field(default=False, metadata={"help": "Run as daemon"})
    type: str = field(default="drsai", metadata={"help": "Worker's type"})
    debug: bool = field(default=True, metadata={"help": "Debug mode"})

if __name__ == '__main__':
    run_app = Run_DrSaiAPP(model_args=DrSaiModelConfig, worker_args=DrSaiWorkerConfig)
    asyncio.run(
        run_app.run_drsai(
            drsaiapp = DrSaiAPP(agent=agent)
            )
            )