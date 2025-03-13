from pipelines.hepai_pipeline import Pipeline
import os
from utils.drsai.request_drsai import PersistentVariable, current_directory
user_name = "admin@localhost"
PersistentVariable_obj = PersistentVariable(os.path.join(current_directory, f"persistent_variable/persistent_variable_{user_name}.pkl"))      
import json, sys

if __name__ == '__main__':

    pipeline = Pipeline()
    user_message = input("Please input your message for a new conversation: ")
    model_id = "drsai"
    messages = [{'role': 'user', 'content': f"{user_message}"}]
    for i in range(20):
        session_info: dict = PersistentVariable_obj.get("session_info", {})
        if session_info:
            stream_status = session_info['3f9fdeca-6ace-4123-90f8-ca988a1e52a1'].get("stream_status", "thread_start")
            if stream_status in ["thread_start", "run_start", "run_close"]:
                user_message = input("Please input your message for a new conversation: ")
                messages.append({'role': 'user', 'content': f"{user_message}"})
        else:
            user_message = input("Please input your message for a new conversation: ")
            messages.append({'role': 'user', 'content': f"{user_message}"})
        user_message = messages[-1]['content']
        body = {'stream': True, 
                'model': 'hepai_pipeline', 
                'messages': messages, 
                'user': {'name': 'admin@localhost', 
                        'id': '1f26bab4-d7b2-4732-b065-b6f820000258', 
                        'email': 'admin@localhost', 
                        'role': 'admin'}, 
                'metadata': {'chat_id': '3f9fdeca-6ace-4123-90f8-ca988a1e52a1', 
                            'message_id': '51ca131c-1c4f-457a-b338-66551ec7fcf9', 
                            'session_id': 'Qd_zbV8LbFmfI6QSAAAT', 
                            'valves': None}}
        headers = {'host': 'localhost:9098', 
                'authorization': 'Bearer Hi-dzlghzmQQanaYwwAvRbGmybCbZbSVTiFvZJQghhyRMrVZnV', 
                'content-type': 'application/json', 
                'accept': '*/*', 
                'accept-encoding': 'gzip, deflate', 
                'user-agent': 'Python/3.11 aiohttp/3.10.2', 
                'content-length': '238'}
        res = pipeline.pipe(user_message = user_message, messages = messages, model_id = model_id, body = body, headers = headers)
        if isinstance(res, str):
            sys.stdout.write(res)
            sys.stdout.flush()
        elif res is None:
            pass
        else:
            messagedelta = ''
            input_message_flag = False
            for message_sse in res:
                # print(f"message: {message_sse}")
                messagechunk = json.loads(message_sse.split(":", 1)[1].strip())
                messagedelta += messagechunk["choices"][0]["delta"]["content"]
                sys.stdout.write(messagechunk["choices"][0]["delta"]["content"])
                sys.stdout.flush()
                
                if messagechunk["choices"][0]["finish_reason"] == "ASK_USER":
                    input_message = input("Please input your message: ")
                    input_message_flag = True
            messages.append({'role': 'bot', 'content': messagedelta})
            if input_message_flag:
                messages.append({'role': 'user', 'content': input_message})
        print("\n\n")
    


    