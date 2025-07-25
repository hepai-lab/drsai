from hepai import HRModel
import os, json, sys
from hepai.tools.get_woker_functions import get_worker_sync_functions, get_worker_async_functions
import asyncio

api_key = os.environ.get("HEPAI_API_KEY")
chat_id = "22578926-f5e3-48ef-873b-13a8fe7ca3e4"
funcs = get_worker_sync_functions(
    name="hepai/drsai", 
    api_key=api_key,
    # base_url="https://aiapi.ihep.ac.cn/apiv2"
    base_url="http://0.0.0.0:42806/apiv2"
    )
# print([f.__name__ for f in funcs])
funcs_map = {f.__name__: f for f in funcs}

async def test_agent_status():

    # 创建一个并行的协程任务，在30s后中止对话
    async def cancel_dialog():
        await asyncio.sleep(5)
        # await besiii_agent.close()
        print("cancel dialog")
        result = funcs_map['pause'](chat_id=chat_id)
        print(result)
    # monitor_pause_task = asyncio.create_task(cancel_dialog())

    # resume
    result = funcs_map['resume'](chat_id=chat_id)
    print(result)

    loop = asyncio.get_running_loop()
    stream = funcs_map['a_chat_completions'](
        messages = [{"role": "user", "content": "帮我测量psi(4260) -> K+ K- [J/psi -> e+ e-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（ee）的不变质量。先规划后执行。"}],
        # messages = [{"role": "user", "content": "hi"}],
        # messages = [{"role": "user", "content": "Write a short poem about the fall season."}],
        api_key = api_key,
        stream=True,
        chat_id = chat_id,
        user_info = {"name": "xiongdb", "email": "xiongdb@ihep.ac.cn"}
    )
    
    def consume():
        for chunk in stream:
            # print(chunk)
            # oai_json = json.loads(chunk)
            textchunck = chunk["choices"][0]["delta"]["content"]
            if textchunck:
                sys.stdout.write(textchunck)
                sys.stdout.flush()
    await loop.run_in_executor(None, consume)


async def test_agent_pause():
    result = funcs_map['pause'](chat_id = chat_id)
    print(result)

if __name__ == '__main__':
    asyncio.run(test_agent_status())
    # asyncio.run(test_agent_pause())
