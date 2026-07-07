# api/app.py
import os
import re
import yaml
from dotenv import load_dotenv

from .routes import access_compat, admin_analytics, agent_mode, agent_worker, auth, docmaster, files, local_login, models, plans, runs, sessions, settingsroute, skills, teams, users, validation
load_dotenv()
from contextlib import asynccontextmanager
from pathlib import Path
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
    ws,
)
from ....drsai_adapter.sso.science_user_router import router as science_user_router
import httpx
from fastapi.responses import HTMLResponse, RedirectResponse

# Initialize application - will be set in lifespan
app_file_path = os.path.dirname(os.path.abspath(__file__))
initializer = None


def _normalize_ui_path_prefix(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return ""
    if not raw.startswith("/"):
        raw = f"/{raw}"
    return raw.rstrip("/")


def _detect_ui_path_prefix_from_build(ui_root: Path) -> str:
    index = ui_root / "index.html"
    if not index.is_file():
        return ""
    try:
        content = index.read_text(encoding="utf-8", errors="ignore")[:100_000]
    except OSError:
        return ""
    for pattern in (
        r'src="(/[^"/]+)/webpack-runtime',
        r'data-href="(/[^"/]+)/styles\.',
        r'href="(/[^"/]+)/styles\.',
    ):
        match = re.search(pattern, content)
        if match:
            return _normalize_ui_path_prefix(match.group(1))
    return ""


def _resolve_ui_path_prefix(ui_root: Path) -> str:
    env_prefix = _normalize_ui_path_prefix(
        os.getenv("GATSBY_PREFIX_PATH_VALUE") or os.getenv("PREFIX_PATH_VALUE") or ""
    )
    if env_prefix:
        return env_prefix
    return _detect_ui_path_prefix_from_build(ui_root)


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
        ui_path_prefix = _resolve_ui_path_prefix(initializer.ui_root)
        app.state.ui_path_prefix = ui_path_prefix
        ui_mount = ui_path_prefix or "/"
        app.mount(
            ui_mount,
            StaticFiles(directory=initializer.ui_root, html=True),
            name="ui",
        )
        if ui_path_prefix:
            logger.info(f"Serving UI under path prefix: {ui_path_prefix}")

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
        ui_url = getattr(app.state, "ui_path_prefix", "") or "/"
        logger.info(
            f"Application startup complete. Navigate to http://{os.environ.get('_HOST', '127.0.0.1')}:{os.environ.get('_PORT', '8081')}{ui_url}"
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


@app.middleware("http")
async def ui_path_prefix_redirects(request: Request, call_next):
    prefix = getattr(request.app.state, "ui_path_prefix", "")
    path = request.url.path
    if prefix and path in ("/", prefix):
        return RedirectResponse(url=f"{prefix}/")
    return await call_next(request)


# 允许外部系统通过 iframe 嵌入本站
# IFRAME_ALLOWED_ORIGINS: 空格分隔的允许来源，优先读环境变量，方便不同环境覆盖
# 例：IFRAME_ALLOWED_ORIGINS="https://portal.lssf.cas.cn https://other.cas.cn"
_IFRAME_ALLOWED_ORIGINS = os.getenv(
    "IFRAME_ALLOWED_ORIGINS",
    "https://user.heps.ihep.ac.cn https://drsaiv2.ihep.ac.cn https://drsai.ihep.ac.cn",
)

@app.middleware("http")
async def iframe_security_headers(request: Request, call_next):
    response = await call_next(request)
    frame_ancestors = f"'self' {_IFRAME_ALLOWED_ORIGINS}"
    response.headers["Content-Security-Policy"] = f"frame-ancestors {frame_ancestors}"
    if "x-frame-options" in response.headers:
        del response.headers["x-frame-options"]
    return response


# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://drsai.ihep.ac.cn",
        "https://drsai.ihep.ac.cn",
        "https://aitest.ihep.ac.cn",
     ],
    allow_origin_regex=(
        r"https?://("
        r"localhost"
        r"|127\.0\.0\.1"
        # DEV/容器/局域网：放行私网段 IP（10.x、192.168.x、172.16-31.x）访问，
        # 前端按浏览器 hostname 推导后端地址时需要它们通过 CORS。
        r"|10(\.\d{1,3}){3}"
        r"|192\.168(\.\d{1,3}){2}"
        r"|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}"
        # IHEP 公网段
        r"|202\.122(\.\d{1,3}){2}"
        r"|202\.38(\.\d{1,3}){2}"
        r"):\d+"
    ),
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

api.include_router(
    local_login.router,
    prefix="/umtlocal",
    tags=["umtlocal"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    auth.router,
    prefix="/auth",
    tags=["auth"],
    responses={401: {"description": "Unauthorized"}},
)

api.include_router(
    science_user_router,
    prefix="/auth/science-user",
    tags=["auth"],
    responses={401: {"description": "Unauthorized"}, 502: {"description": "CAS API error"}},
)

api.include_router(
    users.router,
    prefix="/users",
    tags=["users"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    access_compat.router,
    prefix="/orgs",
    tags=["access-compat"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    admin_analytics.router,
    prefix="/admin/analytics",
    tags=["admin-analytics"],
    responses={403: {"description": "Forbidden"}},
)

api.include_router(
    skills.router,
    prefix="/skills",
    tags=["skills"],
    responses={404: {"description": "Not found"}},
)

api.include_router(
    docmaster.router,
    prefix="/docmaster",
    tags=["docmaster"],
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
    # api.include_router(ihep_sso_router, prefix="/umt", tags=["umt"], responses={404: {"description": "Not found"}})

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
