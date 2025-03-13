import requests
import json
import os, sys, time, re
import hepai
from hepai import HepAI
from typing import List, Dict, Union, Optional
import asyncio
import pickle
# 文件名
# FILENAME = 'persistent_variable.pkl'
import os, base64
current_file_path = os.path.abspath(__file__)
current_directory = os.path.dirname(current_file_path)

from openai.types.beta import Thread
from openai.types.beta.threads import (
    Run,
    Text,
    Message,
    ImageFile,
    TextDelta,
    MessageDelta,
    MessageContent,
    MessageContentDelta,
)
from openai.types.beta.threads.runs import RunStep, ToolCall, RunStepDelta, ToolCallDelta
from openai.types.beta.assistant_stream_event import(
    ThreadCreated,
    ThreadRunCreated,
    ThreadRunQueued,
    ThreadRunInProgress,
    ThreadRunStepCreated,
    ThreadRunStepInProgress,
    ThreadMessageCreated,
    ThreadMessageInProgress,
    ThreadMessageDelta,
    ThreadMessageCompleted, # ThreadMessageCompleted.contentcontent.value包含了所有的聊天记录
    ThreadRunStepCompleted,
    ThreadRunCompleted,
    ThreadRunIncomplete

)

# drsai api
# base_url = os.getenv("API_URL", "http://localhost:42808/v1")
base_url = "http://localhost:42801/v1"
# assert base_url , 'Please set API_URL environment variable, such as: set `API_URL="http://localhost:42801"` in ~/.bashrc'

class PersistentVariable:
    def __init__(self, filename:str = None):
        self.filename = filename
        self.data = {}
        self.load()

    def load(self):
        if os.path.exists(self.filename):
            # 检查文件是否为空
            if os.path.getsize(self.filename) > 0:
                with open(self.filename, 'rb') as f:
                    try:
                        self.data = pickle.load(f)
                    except EOFError:
                        self.data = {}  # 如果文件为空，则默认为空字典
            else:
                self.data = {}  # 文件为空时，默认为空字典
        else:
            self.data = {}  # 文件不存在时，默认为空字典

    def save(self):
        with open(self.filename, 'wb') as f:
            pickle.dump(self.data, f)

    def get(self, key:str, default=None):
        return self.data.get(key, default)
    
    def set(self, key:str, value):
            self.data[key] = value
            self.save()

    def delete(self, key:str):
        if key in self.data:
            del self.data[key]
            self.save()
    def clear(self):
        self.data = {}
        self.save()

# PersistentVariable_obj = PersistentVariable()


# Set client
def set_client(api_key):
    proxy = os.getenv("HTTP_PROXY")
    if proxy in ['', "None", 'null', "NULL", "NONE"]:
        proxy = None
    client = HepAI(
        base_url=base_url, 
        # base_url = 'http://192.168.32.148:42801/v1',
        # base_url = 'https://aiapi.ihep.ac.cn/v1',
        api_key=api_key, 
        max_retries=0,
        proxy=proxy)
    return client
# api_key = os.environ.get('HEPAI_API_KEY', None)
# client = set_client(api_key = api_key)

# 前端到后端的设置
def set_assistant_metadata(**kwargs):
    settings = kwargs.pop("settings", {})
    chat_type = kwargs.pop("chat_type", "BESIII AI")
    api_key = kwargs.pop("api_key", None)

    # Agent mode
    metadata = {"chat_type": "BESIII AI"} if chat_type == "BESIII AI" else {"chat_type": "Personal assistant"}

    # 通过metadata传递api_key
    
    metadata['api_key'] = api_key

    # 通过metadata传递groupchat 配置
    metadata['human_reaction_time'] = settings['human_reaction_time'] if settings.get('human_reaction_time') else False
    if metadata['human_reaction_time']:
        metadata['human_reaction_time'] = settings.get('human_reaction_time', 20)

    # 通过metadata传递agent 配置
    metadata['file_search'] = settings['file_search'] if settings.get('file_search') else False
    if metadata['file_search']:
        metadata["similarity_top_k"] = settings.get("similarity_top_k", 10)
        metadata["score_limit"] = settings.get("score_limit", 0.5)
    metadata["functions"] = settings.get("functions", "Groupchat")
    # ["Groupchat", "Charm/HepAI_Assistant", "Code_Interpreter", "Arxiv_search", "Editor", "Worker"] 
    metadata["worker_name"] = settings.get("worker_name", None) 

    return metadata

def create_assistant(client:HepAI = None, 
                     assistant_name:str = "HepAI Assistant", 
                     assistant_description:str = None,
                     temperature:float = 0.5,
                     top_p:float = 1.0,
                     assistant_instructions:str = "You are a personal math tutor. Write and run code to answer math questions.",
                     model_name:str = "openai/gpt-4o-mini",
                     tools:list = [],
                     tool_resources:dict = {},
                     metadata:dict = {}):
    client.beta.assistants.create(
        name=assistant_name,
        description=assistant_description,
        instructions=assistant_instructions,
        temperature=temperature,
        top_p=top_p,
        tools=tools, # 默认没有工具
        tool_resources=tool_resources,
        model=model_name,
        metadata=metadata,
    )
    assistants = client.beta.assistants.list(order="desc", limit="100").data

    assistants[0].model_dump()

    return assistants

def update_assistant(client:HepAI = None, 
                     assistant_id:str = None, 
                     assistant_name:str = "HepAI Assistant", 
                     assistant_description:str = None,
                     temperature:float = 0.5,
                     top_p:float = 1.0,
                     assistant_instructions:str = "You are a personal math tutor. Write and run code to answer math questions.",
                     model_name:str = "openai/gpt-4o-mini",
                     tools:list = [],
                     tool_resources:dict = {},
                     metadata:dict = {}):
    assistant = client.beta.assistants.update(
            assistant_id=assistant_id,
            name=assistant_name,
            instructions=assistant_instructions,
            description=assistant_description,
            temperature=temperature,
            top_p=top_p,
            tools=tools,
            model=model_name,
            tool_resources=tool_resources,
            metadata=metadata,
        )
    return assistant

def create_thread(client:HepAI = None, ):
    thread = client.beta.threads.create()
    return thread

def create_thread_curl(url:str, headers:dict, data:dict, timeout:int = 300):
    try:
        response = requests.post(url, headers=headers, data=json.dumps(data), timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        raise Exception(f"Error creating thread: {e}")

def update_thread(client:HepAI = None, thread_id:str = None, metadata:dict = {}):
    thread = client.beta.threads.update(
                thread_id=thread_id, 
                metadata=metadata
                )
    return thread


def create_file_ids(client:HepAI = None, 
                files:list[str] = [], ):
    files_ids = []
    for file in files:
        try:
            files_ids.append(client.files.create(file=open(files, "rb"), purpose="assistants").id)
        except Exception as e:
            raise Exception(f"Error uploading files: {e}")
    return files_ids
def image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
    return encoded_string

def create_vector_store(client:HepAI = None, 
                        vector_store_name:str = "math_vector_store"):
    vector_store = client.beta.vector_stores.create(
                name= vector_store_name)
    return vector_store

def create_files_in_vector_store(client:HepAI = None, 
                vector_store_id:str = None, 
                files_ids:List[str] = None, 
                ):
    try:
        for file_id in files_ids:
            client.beta.vector_stores.files.create(
                vector_store_id=vector_store_id, file_id=file_id)
        return True
    except Exception as e:
        raise Exception(f"Error adding files to vector store: {e}")


def create_message(client:HepAI = None, 
                   thread_id:str = None, 
                   content: List[dict] = None, 
                   attachments:dict = {}):
    message = client.beta.threads.messages.create(
                thread_id=thread_id,
                role="user",
                content=content, 
                attachments=attachments)
    return message




############################################################################################
# 以下为前端到后端的接口
#####
def get_assistant_metadata(api_key:str, 
                         chat_type:str = "BESIII AI", 
                         settings:dict = {}):
    # prompt: messages的最后一条消息
    # 设置前端变量
    chat_type = "BESIII AI"
    settings = {
        "file_search": True,  
        "similarity_top_k": 10, 
        "score_limit": 0.6, 
        "human_reaction_time": 20,
        "functions": "DataAgent", #"Groupchat", # "WorkerAgent",  # "FunctionAgent", # 
        # ["Groupchat", "Charm/HepAI_Assistant", "Code_Interpreter", "Arxiv_search", "Editor", "Worker"]
        # "worker_name": "Worker/DataWorker"
        "worker_name": 'hepai/dataworker'
        }
    return set_assistant_metadata(api_key=api_key, 
                                  chat_type=chat_type, 
                                  settings=settings
                                      ) 

def create_message_round(api_key:str, 
                         client:HepAI, 
                         prompt:str,
                         metadata:dict = {}):
    # prompt: messages的最后一条消息
    # 设置前端变量
    chat_type = "BESIII AI"
    settings = {
        "file_search": True, 
        "similarity_top_k": 10, 
        "score_limit": 0.5, 
        "human_reaction_time": 20,
        "functions": "Groupchat", 
        # ["Groupchat", "Charm/HepAI_Assistant", "Code_Interpreter", "Arxiv_search", "Editor", "Worker"]
        # "worker_name": "Worker/tomobank_test"
        }
    metadata = set_assistant_metadata(api_key=api_key, 
                                      chat_type=chat_type, 
                                      settings=settings
                                      )
    # 创建assistant
    assistants = create_assistant(client = client, 
                     assistant_name = "HepAI Assistant", 
                     assistant_instructions = "You are a personal math tutor. Write and run code to answer math questions.",
                     model_name = "openai/gpt-4o-mini",
                     metadata = metadata)
    assistant_id = assistants[0].id
    print(f"Assistant created with id: {assistant_id}")
    # 创建线程
    thread = create_thread(client = client)
    thread_id = thread.id
    print(f"Thread created with id: {thread_id}")
    # 创建初始消息
    init_message = create_message(client = client, 
                   thread_id = thread_id, 
                   content = [{"type": "text", "text": f"{prompt}"}], 
                #    content = [{"type": "text", "text": "I want the data of tomobank/datasets/Dynamics"}],
                   attachments = {})
    print(f"Initial message: {init_message}")
    return thread_id, assistant_id

def handle_message(client:HepAI,
                   thread_id:str, 
                   assistant_id:str, 
                   model_id:str,
                   defualt_response:str = "Sorry, There is no answer from Dr.Sai."
                   ):

    stream_status_list = ["thread_start", "run_start", "run_restart", "run_step_start", "message", "ask_user_input", "run_close", "run_step_close"]

    iter_lines = list()

    # 这里创建了一个run
    with client.beta.threads.runs.stream(
        thread_id=thread_id,
        assistant_id=assistant_id   
        ) as stream:

            for event in stream:
                if isinstance(event, ThreadMessageCreated): # 记录消息产生
                    message_id:str = event.data.id
                if isinstance(event, ThreadMessageDelta):
                    chatcompletionchunk = {
                        "id":"chatcmpl-123",
                        "object":"chat.completion.chunk",
                        "created":1694268190,
                        "model":model_id, 
                        "system_fingerprint": "fp_44709d6fcb", 
                        "usage": None,
                        "choices":[{"index":0,
                                    "delta":{"content":"", "function_call": None, "role": None, "tool_calls": None},
                                    "logprobs":None,
                                    "finish_reason":None}] # 非None或者stop字段会触发前端askuser
                        } 
                    # 兼容Tester本地路径图像输出
                    if event.data.delta.content[0].type == "image_url":
                        image_urls: List[str] = event.data.delta.content[0].image_url.url # list of urls
                        pdf_urls: List[str] = event.data.delta.content[0].image_url.pdf_url
                        text = event.data.delta.content[0].image_url.text
                        try:
                            if image_urls:
                                for image_url in image_urls:
                                    text += f"![Image](data:image;base64,{image_to_base64(image_url)})"
                            if pdf_urls:
                                for pdf_url in pdf_urls:
                                    text += f"![Image](data:image;base64,{image_to_base64(pdf_url)})"
                            chatcompletionchunk["choices"][0]["delta"]["content"] = text
                        except Exception as e:
                            print(f"Error converting image to base64: {e}")
                            chatcompletionchunk["choices"][0]["delta"]["content"] = text+"[Image Error]"

                    else:
                        try:
                            textchunk = event.data.delta.content[0].text.value
                            chatcompletionchunk["choices"][0]["delta"]["content"] = textchunk
                            # sys.stdout.write(textchunk)
                            # sys.stdout.flush()
                            # print(f"\nReceived messagedelta event: {event}\n")
                            # 前端要求输入
                            match = re.search(r'\[ST\]Ask human input for (\d+)s\[END\]', textchunk)
                            if match: 
                                chatcompletionchunk["choices"][0]["finish_reason"] = "ASK_USER"
                                human_prompt = f"Please input for {match.group(1)} seconds:"
                                chatcompletionchunk["choices"][0]["delta"]["content"] = human_prompt
                            # base64图像输入
                            match = re.search(r'\[ST\]Image input for image_base64: (.+?)\[END\]', textchunk)
                            if match: 
                                # test = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAABIJJREFUeF7tnE1oVFccxc978z1GUz+qRqqbIKQlJIhNIIW2ohgpWih2U3EhSLAgpRZqu0xpNgUttAvJooRAodJVq6KiCSQVpXURQQLSihIFLUX7gTWN85mZJ/OexLw3xpnMNPXccrIbct9w7vm9c//3f2+I9c/AMgf6oXHAEhAaFq4QAeHiISBkPAREQNgcINOjGiIgZA6QyVFCBITMATI5SoiAkDlAJkcJERAyB8jkKCECQuYAmRwlREDIHCCTo4QICJkDZHKUEAEhc4BMjhIiIGQOkMlRQgSEzAEyOUqIgJA5QCZHCREQMgfI5CghAkLmAJkcoxMS3/oNwuveeGxpfgrZsU+R/2WQzObq5RgLxH7+ZSQ2D8BqWOubbeH2MNLDu6p3gGyksUCiHb2Itu4H7IjPUif9OzLn30Ph1xEyq6uTYyyQxPZTCK3ucmfppO/CijYCoTjgFJG/+jWyPx2szgGyUUYCCTe/jXjXISD2nGtn4dZZ2CvaYCXXuJ+L964idXIbkJ8is7uyHCOBxF75HJGWPYBlA4UscuNfuGkJrXndm7HBxd04INaSZiS6j8JuXO8tV6nfkDm3H6GVGxHd8JG3bJVSY2hxNw5I5KUexDp6gfAiz/g7F5E+vQPBXZepxd04IInubxFa2+0tTcU8clf6kRvrcz/6+hJDi7tRQEJNryK+qX+meDtTt5Ee7UHxj0sukMiLexHr+ASINHi87l9Heng3nMmJytWUZIRRQIK9R7BOBOsLChnkLh9GbvxLErsryzAKSPKtUdjL271ZTT9AdqwP+Z8HfLP07cAMLO7GAAn2HnMtR8FxphV3Y4DEN32FcPPO0n8DKW12kb92FNkLB564BiR3nIG9qtP7nWHF3QggZbUh+zcyFz/G9MR3TwQSrDUmFXcjgETbP/A1fcW/xpE6vnnOCll2EmxQcTcCyNN6j7mo+J6Z1UBW3uc82xH0QEIvbEH8tSOwEivrcyp7D5kfP8T0zRP1fc8CP00PJNbZh0jru4AVrs8KQ4o7N5BIA5LbT8Je3lYfjEdPm1DcqYGE1+9CvOszILLY28Gm7rhdt5O7XxUgO9mEaNv7M/cmJnTu1ED8vUdtR+q+7t6A4k4LxF6xAYktg7Aa1nlpqHHrWnb3XqGHqSp6CziIFkiw93CmbiE9shfFPy/Py47gCXGpy5+e+B6Zc/vm9T3/1WBaILP/iME9S7xxDJkfemryJdiTOJM3kBp6h/JYnhJIWe9R5x158Jax1uWvprdhng9RAgkeode7XS07CyMu7nxASr3Hm0Owl7Y8ereefrJb7QsYhAzS4k4HJHgN+28ZF7wnYS3udECqfeP/r+MEhIysgAgImQNkcpQQASFzgEyOEiIgZA6QyVFCBITMATI5SoiAkDlAJkcJERAyB8jkKCECQuYAmRwlREDIHCCTo4QICJkDZHKUEAEhc4BMjhIiIGQOkMlRQgSEzAEyOUqIgJA5QCZHCREQMgfI5CghAkLmAJkcJURAyBwgk6OECAiZA2RylBABIXOATI4SQgbkIQ35igNGcmHBAAAAAElFTkSuQmCC'
                                # chatcompletionchunk["choices"][0]["delta"]["content"] = f"![Image](data:image;base64,{test})\n"
                                chatcompletionchunk["choices"][0]["delta"]["content"] = f"![Image](data:image;base64,{match.group(1)})\n"
                        except Exception as e:
                            print(f"Error converting ThreadMessageDelta: {e}")
                            chatcompletionchunk["choices"][0]["delta"]["content"] = f"Error converting ThreadMessageDelta: {e}"

                    iter_lines.append(chatcompletionchunk)
                    yield f"data: {json.dumps(chatcompletionchunk)}\n\n"

                # if isinstance(event, ThreadRunStepCompleted): 
                #     pass
                if isinstance(event, ThreadRunCompleted): 
                    if iter_lines:
                        iter_lines[-1]["choices"][0]["finish_reason"] = 'stop'
                       
    stream.until_done()

def update_human_message(client:HepAI, 
                         thread_id:str,
                         message_id:str,
                         assistant_id:str,  
                         model_id:str, 
                         user_input:str,
                         ):
    metadata_human_input = {}
    metadata_human_input['ask_human_input'] = False
    metadata_human_input["human_input"]= user_input 
    update_message = client.beta.threads.messages.update(
        message_id = message_id,
        thread_id=thread_id, 
        metadata= metadata_human_input 
        )

    return handle_message(client = client,
                   thread_id = thread_id,
                   assistant_id = assistant_id, 
                   model_id = model_id,
                   defualt_response = f"Human input: {metadata_human_input}")
    
    
if __name__ == '__main__':
    pass                  
