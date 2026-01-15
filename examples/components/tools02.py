from drsai import CancellationToken
from drsai.modules.baseagent import (
    DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
    CodeBlock
)
from drsai.modules.baseagent import CodeExecutorAgent

from drsai import Console
from pathlib import Path
import venv

async def test_local_executor():
    work_dir = Path("/home/xiongdb/drsai_dev/examples/components/tmp/coding")
    work_dir.mkdir(exist_ok=True)

    venv_dir = work_dir / ".venv"
    venv_builder = venv.EnvBuilder(with_pip=True)
    venv_builder.create(venv_dir)
    venv_context = venv_builder.ensure_directories(venv_dir)

    local_executor = LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)
    code_result = await local_executor.execute_code_blocks(
        code_blocks=[
            CodeBlock(language="bash", code="pip install pypdf pdf2image"),
        ],
        cancellation_token=CancellationToken(),
    )
    print(code_result)

async def test_code_executor_agent():

    work_dir = Path("/home/xiongdb/drsai_dev/examples/components/tmp/coding")
    work_dir.mkdir(exist_ok=True)

    venv_dir = work_dir / ".venv"
    venv_builder = venv.EnvBuilder(with_pip=True)
    venv_builder.create(venv_dir)
    venv_context = venv_builder.ensure_directories(venv_dir)

    local_executor = LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)

    code_executor_agent = CodeExecutorAgent(
        name="coder_agent",
        code_executor=local_executor,
    )
    await Console(code_executor_agent.run_stream(task="```python\nprint('hello world')```"))
if __name__ == '__main__':
    import asyncio
    # asyncio.run(test())
    asyncio.run(test_code_executor_agent())
