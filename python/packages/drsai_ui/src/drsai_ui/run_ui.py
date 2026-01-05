
import os
import uvicorn
import asyncio
from typing_extensions import Annotated
import typer
from typing import Optional
from pathlib import Path
import yaml

from .ui_backend.version import VERSION
from .ui_backend.version import APP_NAME as UI_APP_NAME
# from .ui_backend.backend.cli import (
#     # ui, 
#     get_env_file_path,)
# from .agent_factory.magentic_one.check_docker import check_docker
from .agent_factory.load_agent import a_load_agent_factory_from_config

from drsai.backend.run import run_backend, start_console

here = Path(__file__).parent.resolve()

yaml_example = f"{here}/configs/agent_config.yaml"

def get_env_file_path(app_dir: str = os.path.join(os.path.expanduser("~"), ".drsai_ui")):
    # app_dir = os.path.join(os.path.expanduser("~"), ".drsai_ui")
    if not os.path.exists(app_dir):
        os.makedirs(app_dir, exist_ok=True)
    return os.path.join(app_dir, "temp_env_vars.env")

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
            agent_factory=asyncio.run(a_load_agent_factory_from_config(config))
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
            agent_factory=asyncio.run(a_load_agent_factory_from_config(config))
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
            from .agent_factory.magentic_one.check_docker import check_docker
            check_docker(rebuild_docker)
    else:
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
    env_file_path = get_env_file_path(app_dir=appdir)
    with open(env_file_path, "w") as temp_env:
        for key, value in env_vars.items():
            temp_env.write(f"{key}={value}\n")
    
    from .ui_backend.backend.web.app import app as ui_app
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