from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig
from autogen_core.memory import ListMemory, MemoryContent, MemoryMimeType, Memory
from autogen_core.model_context import (
    BufferedChatCompletionContext,
    UnboundedChatCompletionContext,
    TokenLimitedChatCompletionContext,
    HeadAndTailChatCompletionContext
    )

import os, sys
from pathlib import Path

from drsai import HepAIChatCompletionClient, AssistantAgent
from drsai import Console

async def get_weather(city: str, units: str = "imperial") -> str:
    if units == "imperial":
        return f"The weather in {city} is 73 °F and Sunny."
    elif units == "metric":
        return f"The weather in {city} is 23 °C and Sunny."
    else:
        return f"Sorry, I don't know the weather in {city}."
    
async def rag_memory():
    # Initialize ChromaDB memory with custom config
    chroma_user_memory = ChromaDBVectorMemory(
        config=PersistentChromaDBVectorMemoryConfig(
            collection_name="preferences",
            persistence_path=os.path.join(str(Path.home()), ".chromadb_autogen"),
            k=2,  # Return top  k results
            score_threshold=0.4,  # Minimum similarity score
        )
    )
    # a HttpChromaDBVectorMemoryConfig is also supported for connecting to a remote ChromaDB server

    # Add user preferences to memory
    await chroma_user_memory.add(
        MemoryContent(
            content="The weather should be in metric units",
            mime_type=MemoryMimeType.TEXT,
            metadata={"category": "preferences", "type": "units"},
        )
    )

    await chroma_user_memory.add(
        MemoryContent(
            content="Meal recipe must be vegan",
            mime_type=MemoryMimeType.TEXT,
            metadata={"category": "preferences", "type": "dietary"},
        )
    )

    model_client = HepAIChatCompletionClient(
        model="openai/gpt-4o",
    )

    # Create assistant agent with ChromaDB memory
    assistant_agent = AssistantAgent(
        name="assistant_agent",
        model_client=model_client,
        tools=[get_weather],
        memory=[chroma_user_memory],
    )

    stream = assistant_agent.run_stream(task="What is the weather in New York?")
    await Console(stream)

    await model_client.close()
    await chroma_user_memory.close()


async def load_components():
    chroma_user_memory = ChromaDBVectorMemory(
        config=PersistentChromaDBVectorMemoryConfig(
            collection_name="preferences",
            persistence_path=os.path.join(str(Path.home()), ".chromadb_autogen"),
            k=2,  # Return top  k results
            score_threshold=0.4,  # Minimum similarity score
        )
    )

    config = chroma_user_memory.dump_component()
    print(config)

    chroma_user_memory = Memory.load_component(config)
