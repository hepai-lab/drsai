from typing import List, Dict, Callable
from autogen_core.models import ChatCompletionClient, LLMMessage
from autogen_core import CancellationToken
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory

def load_hai_rag_memory(memory_functions_config: dict) -> Callable:
    '''
    加载memory_functions
    '''
    worker_name = memory_functions_config.get("worker_name", None)
    api_key = memory_functions_config.get("api_key", None)
    base_url = memory_functions_config.get("base_url", "https://aiapi.ihep.ac.cn/apiv2")
    rag_config = memory_functions_config.get("rag_config", {})
    # TODO: 目前只支持last_message
    try:
        from hepai import HRModel
        async def memory_functions(
            memory_messages: List[Dict[str, str]], 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,
            **kwargs,
            ) -> List[Dict[str, str]]|List[LLMMessage]:
            model = HRModel.connect(
                name=worker_name,
                base_url=base_url,
                api_key=api_key
                )
            query = memory_messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
            rag_config.update({"content": query})
            # 检索结果格式：[{"text": "xxx", "score": 0.5}, {"text": "yyy", "score": 0.3}] 
            results: List[dict] = model.interface(
                **rag_config,
                )
            retrieve_txt = ""
            for index, result in enumerate(results):
                retrieve_txt += f"Ref {index+1}: \n{result['text']}\n"

            last_txt = f"\n\nPlease provide closely related answers based on the reference materials provided below. Ensure that your response is closely integrated with the content of the reference materials to provide appropriate and well-supported answers.\nThe reference materials are: {retrieve_txt}."
            memory_messages[-1]["content"] += last_txt
            return memory_messages
        return memory_functions
    except ImportError:
        raise ImportError("please install <hepai> package")
    except Exception as e:
        raise e


def load_RAGFlow_memory(memory_functions_config: dict) -> Callable:
    '''
    加载RAGFlow的memory_functions
    '''
    config: dict = memory_functions_config.get("config", {})
    try:
        async def memory_functions(
            memory_messages: List[Dict[str, str]], 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,
            **kwargs,
            ) -> List[Dict[str, str]]|List[LLMMessage]:
            
            api_key = config.pop("api_key", None)
            base_url = config.pop("base_url", "https://aiapi.ihep.ac.cn/apiv2")
            ragflow_memory = RAGFlowMemory(base_url, api_key)
            results = ragflow_memory.retrieve_chunks_by_content(**config)
            chunks = results.get("chunks", [])
            retrieve_txt = ""
            for index, result in enumerate(chunks):
                retrieve_txt += f"Ref {index+1}: \n{result['content']}\n"

            last_txt = f"\n\nPlease provide closely related answers based on the reference materials provided below. Ensure that your response is closely integrated with the content of the reference materials to provide appropriate and well-supported answers.\nThe reference materials are: {retrieve_txt}."
            memory_messages[-1]["content"] += last_txt
            return memory_messages
        return memory_functions
    except Exception as e:
        raise e

def load_remote_memory(memory_functions_config: dict) -> Callable:
    '''
    加载远程memory_functions
    传入：memory_messages, **config
    返回：memory_messages
    '''
    ...

async def load_memory_function(memory_functions_config: dict) -> Callable:
    '''
    加载memory_functions的工厂函数
    '''
    memory_function_type = memory_functions_config.get("type", None)
    if memory_function_type == "RAGFlow":
        return load_RAGFlow_memory(memory_functions_config)
    elif memory_function_type == "HAIRAG":
        return load_hai_rag_memory(memory_functions_config)
    elif memory_function_type == "remote":
        return load_remote_memory(memory_functions_config)
    else:
        raise ValueError("memory_functions_config should contain a valid type")