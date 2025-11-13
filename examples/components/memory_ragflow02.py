from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from autogen_core._component_config import Component, ComponentLoader
from typing import Dict, Any
import os
from dotenv import load_dotenv
load_dotenv()

RAGFLOW_URL = os.getenv('RAGFLOW_URL')
RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')

# 
def create_ragflow_memory_01(config: RAGFlowMemoryConfig) -> RAGFlowMemory:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return RAGFlowMemory(config)

def dump_ragflow_memory_component(ragflow_memory: RAGFlowMemory) -> Dict[str, Any]:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return ragflow_memory.dump_component().model_dump()

def create_ragflow_memory_from_config(component_config: Dict[str, Any]) -> RAGFlowMemory:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return ComponentLoader.load_component(component_config)

if __name__ == '__main__':
    # create a RAGFlowMemory instance
    config = RAGFlowMemoryConfig(
        name="ragflow_memory_01",
        RAGFLOW_URL=RAGFLOW_URL,
        RAGFLOW_TOKEN=RAGFLOW_TOKEN,)
    
    ## create a RAGFlowMemory instance
    ragflow_memory = create_ragflow_memory_01(config)
    print(ragflow_memory)
    ## dump the RAGFlowMemory component
    component_dump = dump_ragflow_memory_component(ragflow_memory)
    print(component_dump)
    ## create a RAGFlowMemory instance from the dumped component
    ragflow_memory_from_dump = create_ragflow_memory_from_config(component_dump)
    print(ragflow_memory_from_dump)
    print("RAGFlowMemory instance created from dumped component successfully.")
    ## test the RAGFlowMemory instance
 