from .app_worker import DrSaiAPP

import os
from typing import Union
from fastapi import FastAPI
import uvicorn, asyncio
from autogen_agentchat.base import TaskResult
from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.ui import Console

from autogen_agentchat.messages import (
    # AgentEvent,
    ThoughtEvent,
    # ChatMessage,
    LLMMessage,
    TextMessage,
    UserMessage,
    HandoffMessage,
    ToolCallSummaryMessage,
    ToolCallRequestEvent,
    ToolCallExecutionEvent,
    ModelClientStreamingChunkEvent,
    # MultiModalMessage,
    # UserInputRequestedEvent,
)

from typing_extensions import Annotated
import typer
from typing import Optional
from pathlib import Path
import yaml

from drsai.backend.ui.ui_backend.version import VERSION
from drsai.backend.ui.ui_backend.version import APP_NAME as UI_APP_NAME
from drsai.backend.ui.ui_backend.backend.cli import (
    # ui, 
    get_env_file_path,)
from drsai.backend.ui.ui_backend.backend.web.app import app as ui_app
from drsai.agent_factory.load_agent import load_agent_factory_from_config
from drsai.agent_factory.magentic_one.check_docker import check_docker

here = Path(__file__).parent.resolve()

############################################
# Dr.Sai application
############################################

async def start_console(
        task: str,
        agent_factory: callable = None, 
        agent: AssistantAgent|BaseGroupChat = None, 
        **kwargs) -> Union[None, TaskResult]:
    """
    启动aotugen原生多智能体运行方式和多智能体逻辑
    args:
        task: str, 任务内容
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        agent: AssistantAgent|BaseGroupChat, 已创建的AssistantAgent/BaseGroupChat实例
        **kwargs: 其他参数
    """

    if agent is None:
        agent: AssistantAgent | BaseGroupChat = (
            await agent_factory() 
            if asyncio.iscoroutinefunction(agent_factory)
            else agent_factory()
        )

    stream = agent._model_client_stream if not isinstance(agent, BaseGroupChat) else agent._participants[0]._model_client_stream
    if stream:
        await Console(agent.run_stream(task=task))
        return 
    else:
        result:TaskResult = await agent.run(task=task)
        return result

async def run_console(agent_factory: callable, task: str, **kwargs) -> Union[None, TaskResult]:
    '''
    启动OpenAI-Style-API后端服务
    args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        task: str, 任务内容
        **kwargs: 其他参数
    '''

    result = await start_console(task=task, agent_factory=agent_factory, **kwargs)
    if result is not None:
        print(result)
        return result

async def run_backend(agent_factory: callable, **kwargs):
    '''
    启动OpenAI-Style-API后端服务
    args:
        agent_factory: 工厂函数，用于创建AssistantAgent/BaseGroupChat实例
        host: str = , "0.0.0.0" ,  # 后端服务host
        port: int = 42801,  # 后端服务port
        enable_openwebui_pipeline: bool = False,  # 是否启动openwebui pipelines
        pipelines_dir: str = None,  # openwebui pipelines目录
        history_mode: str = "backend",  # 历史消息的加载模式，可选值：backend、frontend 默认backend
        use_api_key_mode: str = "frontend",  # api key的使用模式，可选值：frontend、backend 默认frontend， 调试模式下建议设置为backend
    '''
    host: str =  kwargs.pop("host", "0.0.0.0")
    port: int =  kwargs.pop("port", 42801)
    os.environ['BACKEND_PORT'] = str(port)

    enable_pipeline: bool = kwargs.pop("enable_openwebui_pipeline", False)

    pipelines_dir = kwargs.pop("pipelines_dir", None)
    if pipelines_dir is not None:
        os.environ['PIPELINES_DIR'] = pipelines_dir
        pipelines_dir = os.getenv('PIPELINES_DIR')
        if not os.path.exists(pipelines_dir):
            print(f"PIPELINES_DIR {pipelines_dir} not exists!")
        else:
            print(f"Set PIPELINES_DIR to {pipelines_dir}")
    
    drsaiapp = DrSaiAPP(
        agent_factory = agent_factory,
        **kwargs
        )
    
    if enable_pipeline:
        from contextlib import asynccontextmanager
        # 通过Pipeline适配OpenWebUI
        from .owebui_pipeline.api import app as owebui_pipeline_app
        from .owebui_pipeline.api import lifespan as owebui_lifespan
        
        drsaiapp.app.mount("/pipelines", app=owebui_pipeline_app)
        main_lifespan = getattr(drsaiapp.app.router, "lifespan_context", None)

        # 创建组合生命周期上下文
        @asynccontextmanager
        async def combined_lifespan(app: FastAPI):
            # 执行主应用初始化（如果存在）
            if main_lifespan:
                async with main_lifespan(app):
                    # 执行子应用生命周期
                    async with owebui_lifespan(app):
                        yield
            else:
                # 仅执行子应用生命周期
                async with owebui_lifespan(app):
                    yield
        
        # 重写主应用生命周期
        drsaiapp.app.router.lifespan_context = combined_lifespan

    config = uvicorn.Config(
        app=drsaiapp.app,
        host=host,
        port=port,
        loop="asyncio"
    )
    server = uvicorn.Server(config)
    # 在现有事件循环中启动服务
    if enable_pipeline:
        print(f"Enable OpenWebUI pipelines: `http://{host}:{port}/pipelines` with API-KEY: `{owebui_pipeline_app.api_key}`")
    try:
        await server.serve()
    except asyncio.CancelledError:
        await server.shutdown()

############################################
# Dr.Sai-UI CLI application
############################################

app = typer.Typer()

@app.command()
def console(agent_config: Optional[str]= None):
    '''
    Run Agent in Console Mode

    args:
        agent_config: str, the path to the YAML configuration file used to create the Agent/GroupChat instance
    '''
    
    here_parent = Path(__file__).parent.parent.resolve()
    yaml_example = f"{here_parent}/configs/agent_config.yaml"

    if agent_config:
        # check if the agent_config file exists
        if not os.path.isfile(agent_config):
            typer.echo(f"Agent config file {agent_config} not found.")
            typer.echo(f"Please provide an Agent/GroupChat config file. Example config file: {yaml_example}")
            raise typer.Exit(1)
    else:
        typer.echo(f"Please provide an Agent/GroupChat config file. Example config file: {yaml_example}")
        raise typer.Exit(1)
    
    try:
        with open(agent_config, 'r') as file:
            config = yaml.safe_load(file)
            # print(config)
            agent_factory=load_agent_factory_from_config(config)
            userinput = input(">>>>> Enter your message: ")
            asyncio.run(start_console(task=userinput, agent_factory=agent_factory))

    except Exception as e:
        typer.echo(f"Error loading model configs: {e}", err=True)
        raise e


@app.command()
def backend(
    agent_config: Optional[str] = None,
    host: str = "0.0.0.0",
    port: int = 42801,
    enable_openwebui_pipeline: bool = True,
    pipelines_dir: str = None,
    history_mode: str = "backend",
    use_api_key_mode: str = "frontend",
):
    '''
    Run Agent in OpenAI-Style-API Backend Mode

    args:
        agent_config: str, 用于创建Agent/GroupChat实例的yaml配置文件地址
        host: str = , "0.0.0.0" ,  # 后端服务host
        port: int = 42801,  # 后端服务port
        enable_openwebui_pipeline: bool = False,  # 是否启动openwebui pipelines
        pipelines_dir: str = None,  # openwebui pipelines目录
        history_mode: str = "backend",  # 历史消息的加载模式，可选值：backend、frontend 默认backend
        use_api_key_mode: str = "frontend",  # api key的使用模式，可选值：frontend、backend 默认frontend， 调试模式下建议设置为backend
    '''
    here_parent = Path(__file__).parent.parent.resolve()
    yaml_example = f"{here_parent}/configs/agent_config.yaml"
    
    if agent_config:
        # check if the agent_config file exists
        if not os.path.isfile(agent_config):
            typer.echo(f"Agent config file {agent_config} not found.")
            typer.echo(f"Please provide an Agent/GroupChat config file. Example config file: {yaml_example}")
            raise typer.Exit(1)
    else:
        typer.echo(f"Please provide an Agent/GroupChat config file. Example config file: {yaml_example}")
        raise typer.Exit(1)
    
    try:
        with open(agent_config, 'r') as file:
            config = yaml.safe_load(file)
            # print(config)
            agent_factory=load_agent_factory_from_config(config)
            asyncio.run(run_backend(
                agent_factory=agent_factory,
                host=host,
                port=port,
                enable_openwebui_pipeline=enable_openwebui_pipeline,
                pipelines_dir=pipelines_dir,
                history_mode=history_mode,
                use_api_key_mode=use_api_key_mode,
                ))

    except Exception as e:
        typer.echo(f"Error loading model configs: {e}", err=True)
        raise typer.Exit(1)


@app.command()
def ui(
    host: str = "0.0.0.0",
    port: int = 8081,
    workers: int = 1,
    reload: Annotated[bool, typer.Option("--reload")] = False,
    docs: bool = True,
    appdir: str = str(Path.home() / ".drsai_ui"),
    database_uri: Optional[str] = None,
    upgrade_database: bool = False,
    agent_config: Optional[str] = None,
    rebuild_docker: Optional[bool] = False,
):
    """
    Run Dr.Sai-UI.

    Args:
        host (str, optional): Host to run the UI on. Defaults to 127.0.0.1 (localhost).
        port (int, optional): Port to run the UI on. Defaults to 8081.
        workers (int, optional): Number of workers to run the UI with. Defaults to 1.
        reload (bool, optional): Whether to reload the UI on code changes. Defaults to False.
        docs (bool, optional): Whether to generate API docs. Defaults to False.
        appdir (str, optional): Path to the app directory where files are stored. Defaults to None.
        database-uri (str, optional): Database URI to connect to. Defaults to None.
        agent_config (str, optional): Path to the config file. Defaults to `agent_config.yaml`.
        rebuild_docker: bool, optional: Rebuild the docker images. Defaults to False.
    """
    typer.echo(typer.style(f"Starting {UI_APP_NAME}", fg=typer.colors.GREEN, bold=True))

    if agent_config:
        # check if the agent_config file exists
        if not os.path.isfile(agent_config):
            typer.echo(f"Agent config file {agent_config} not found.")
            typer.echo(f"Please provide an Agent/GroupChat config file. Example config file: {yaml_example}")
            raise typer.Exit(1)
        
        try:
            with open(agent_config, 'r') as file:
                config = yaml.safe_load(file)
                Use_default_mode = config.get("Use_default_Agent_Groupchat_mode", False)

        except Exception as e:
            typer.echo(f"Error loading model configs: {e}", err=True)
            raise typer.Exit(1)
        
        # TODO: 补充更多选项需要的配置项
        if Use_default_mode in ["magentic-one"]:
            check_docker(rebuild_docker)
    else:
        here_parent = Path(__file__).parent.parent.resolve()
        yaml_example = f"{here_parent}/configs/agent_config.yaml"
        typer.echo(f"There is example agent_config file: {yaml_example}")
        # raise typer.Exit(1)

    typer.echo("Launching Web Application...")
    
    # Write configuration
    env_vars = {
        "_HOST": host,
        "_PORT": port,
        "_API_DOCS": str(docs),
    }

    if appdir:
        env_vars["_APPDIR"] = appdir
    if database_uri:
        env_vars["DATABASE_URI"] = database_uri
    if upgrade_database:
        env_vars["_UPGRADE_DATABASE"] = "1"

    env_vars["INSIDE_DOCKER"] = "0"
    env_vars["EXTERNAL_WORKSPACE_ROOT"] = appdir
    env_vars["INTERNAL_WORKSPACE_ROOT"] = appdir

    # If the config file is not provided, check for the default config file
    if not agent_config:
        if os.path.isfile("config.yaml"):
            agent_config = f"config.yaml"
        else:
            typer.echo("Config file not provided. Using default settings.")
    if agent_config:
        env_vars["_CONFIG"] = agent_config

    # Create temporary env file to share configuration with uvicorn workers
    env_file_path = get_env_file_path()
    with open(env_file_path, "w") as temp_env:
        for key, value in env_vars.items():
            temp_env.write(f"{key}={value}\n")
            
    uvicorn.run(
         # "drsai.backend.ui.ui_backend.backend.web.app:app",
        ui_app,
        host=host,
        port=port,
        workers=workers,
        reload=reload,
        reload_excludes=["**/alembic/*", "**/alembic.ini", "**/versions/*"]
        if reload
        else None,
        env_file=env_file_path,
    )

@app.command()
def version():
    """
    Print the version of the Dr.Sai-UI.
    """

    typer.echo(f"{UI_APP_NAME} version: {VERSION}")


def run():
    app()
    
if __name__ == "__main__":
    app()
    # run_ui(
    #     config=f"{here}/config.yaml",
    # )
    
