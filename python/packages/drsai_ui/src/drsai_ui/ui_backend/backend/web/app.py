# api/app.py
import os
import yaml
from dotenv import load_dotenv
load_dotenv()
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Any

# import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from ...version import VERSION
from .config import settings
from .deps import cleanup_managers, init_managers
from .initialization import AppInitializer
from .routes import (
    plans,
    runs,
    sessions,
    settingsroute,
    teams,
    validation,
    ws,
    agent_mode,
    files,
    agent_worker,
    models,
)
import httpx
from fastapi.responses import HTMLResponse

# Initialize application - will be set in lifespan
app_file_path = os.path.dirname(os.path.abspath(__file__))
initializer = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Lifecycle manager for the FastAPI application.
    Handles initialization and cleanup of application resources.
    """

    try:
        # Initialize AppInitializer here to ensure env vars are loaded
        global initializer
        initializer = AppInitializer(settings, app_file_path)

        # Mount static file directories now that initializer is ready
        app.mount(
            "/files",
            StaticFiles(directory=initializer.static_root, html=True),
            name="files",
        )
        app.mount("/", StaticFiles(directory=initializer.ui_root, html=True), name="ui")

        # Load the config if provided
        config: dict[str, Any] = {}
        config_file = os.environ.get("_CONFIG")
        if config_file:
            with open(config_file, "r") as f:
                config = yaml.safe_load(f)

        # Initialize managers (DB, Connection, Team)
        await init_managers(
            initializer.database_uri,
            initializer.config_dir,
            initializer.app_root,
            os.environ["INTERNAL_WORKSPACE_ROOT"],
            os.environ["EXTERNAL_WORKSPACE_ROOT"],
            os.environ["INSIDE_DOCKER"] == "1",
            config,
        )

        # Any other initialization code
        logger.info(
            f"Application startup complete. Navigate to http://{os.environ.get('_HOST', '127.0.0.1')}:{os.environ.get('_PORT', '8081')}"
        )

    except Exception as e:
        logger.error(f"Failed to initialize application: {str(e)}")
        raise

    yield  # Application runs here

    # Shutdown
    try:
        logger.info("Cleaning up application resources...")
        await cleanup_managers()
        logger.info("Application shutdown complete")
    except Exception as e:
        logger.error(f"Error during shutdown: {str(e)}")


# Create FastAPI application
app = FastAPI(lifespan=lifespan, debug=True)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://drsai.ihep.ac.cn",
        "https://drsai.ihep.ac.cn",
        "https://aitest.ihep.ac.cn",
     ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create API router with version and documentation
api = FastAPI(
    root_path="/api",
    title="DrSai-UI API",
    version=VERSION,
    description="DrSai-UI API is an application to interact with web agents.",
    docs_url="/docs" if settings.API_DOCS else None,
)

# Include all routers with their prefixes
api.include_router(
    sessions.router,
    prefix="/sessions",
    tags=["sessions"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    plans.router,
    prefix="/plans",
    tags=["plans"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    runs.router,
    prefix="/runs",
    tags=["runs"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    teams.router,
    prefix="/teams",
    tags=["teams"],
    responses={404: {"description": "Not found"}},
)


api.include_router(
    ws.router,
    prefix="/ws",
    tags=["websocket"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    validation.router,
    prefix="/validate",
    tags=["validation"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    settingsroute.router,
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found"}},
)

# 添加的新路由

api.include_router(
    agent_mode.router,
    prefix="/agentmode",
    tags=["agentmode"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    files.router,
    prefix="/files",
    tags=["files"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    agent_worker.router,
    prefix="/agentworker",
    tags=["agentworker"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    models.router,
    prefix="/models",
    tags=["models"],
    responses={404: {"description": "Not found"}},
)

# Version endpoint


@api.get("/version")
async def get_version():
    """Get API version"""
    return {
        "status": True,
        "message": "Version retrieved successfully",
        "data": {"version": VERSION},
    }


# Health check endpoint


@api.get("/health")
async def health_check():
    """API health check endpoint"""
    return {
        "status": True,
        "message": "Service is healthy",
    }

# 加载vnc api
from .vnc_router import router as vnc_router
api.include_router(vnc_router, prefix="/vncapi", tags=["vnc"])

# Note: Static files will be mounted in lifespan after initializer is ready

# Mount API router
app.mount("/api", api)


# 加载统一认证模块
SERVICE_MODE = os.getenv("SERVICE_MODE", None)
if SERVICE_MODE == "PROD":
    from ....drsai_adapter.sso.ihep_sso_router import router as ihep_sso_router
    from ....drsai_adapter.sso.ihep_sso_router import oauth_config
    from starlette.middleware.sessions import SessionMiddleware
    app.add_middleware(SessionMiddleware, secret_key=oauth_config.meddleware_secret)
    app.include_router(ihep_sso_router, prefix="/umt", tags=["umt"])

# Error handlers



@app.exception_handler(500)
async def internal_error_handler(_request: Request, exc: Exception):
    logger.error(f"Internal error: {str(exc)}")
    return {
        "status": False,
        "message": "Internal server error",
        "detail": str(exc) if settings.API_DOCS else "Internal server error",
    }


def create_app() -> FastAPI:
    """
    Factory function to create and configure the FastAPI application.
    Useful for testing and different deployment scenarios.
    """
    return app
