from drsai.modules.baseagent import (
    DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
    CodeBlock
)
from drsai import CancellationToken
import asyncio

######
# 1. bash docker/build_container_python.sh
# 2. bash docker/run_docker_python.sh
######

WORKDIR="/home/xiongdb/drsai/examples/tools/docker/executor/tmp"

docker_executor = DockerCommandLineCodeExecutor(
    image="magentic-ui-python-env:latest",
    container_name="magentic-ui-python",
    work_dir=WORKDIR,
    stop_container=False

)

asyncio.run(docker_executor.start())
code_block = CodeBlock(
    code="""print("holle world")""",
    language="python"
)



result =asyncio.run(docker_executor.execute_code_blocks(
    code_blocks = [code_block],
    cancellation_token=CancellationToken()
))
print(result)