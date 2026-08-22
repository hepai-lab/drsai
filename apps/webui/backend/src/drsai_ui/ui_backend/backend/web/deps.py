# api/deps.py
import hashlib
import logging
from contextlib import contextmanager
from typing import Any, Dict, Optional
from pathlib import Path
from fastapi import HTTPException, Request, status, Depends

from ..database import DatabaseManager
from .config import settings
from .managers.connection import WebSocketManager

logger = logging.getLogger(__name__)

# Global manager instances
_db_manager: Optional[DatabaseManager] = None
_websocket_manager: Optional[WebSocketManager] = None

# Context manager for database sessions


@contextmanager
def get_db_context():
    """Provide a transactional scope around a series of operations."""
    if not _db_manager:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database manager not initialized",
        )
    try:
        yield _db_manager
    except Exception as e:
        logger.error(f"Database operation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from e


# Dependency providers


async def get_db() -> DatabaseManager:
    """Dependency provider for database manager"""
    if not _db_manager:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database manager not initialized",
        )
    return _db_manager


async def get_websocket_manager() -> WebSocketManager:
    """Dependency provider for connection manager"""
    if not _websocket_manager:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Connection manager not initialized",
        )
    return _websocket_manager


# Manager initialization and cleanup


def _seed_default_users(db: DatabaseManager) -> None:
    from ..datamodel.db import Userinfo, UserRole

    accounts = [
        (settings.DEFAULT_ADMIN_USER, settings.DEFAULT_ADMIN_PASSWORD, True),
        (settings.DEFAULT_DEV_USER,   settings.DEFAULT_DEV_PASSWORD,   False),
    ]
    for user_id, password, is_admin in accounts:
        if not user_id or not password:
            continue
        resp = db.get(Userinfo, filters={"user_id": user_id})
        if resp.status and resp.data:
            continue
        db.upsert(Userinfo(user_id=user_id, password=hashlib.sha256(password.encode()).hexdigest()))
        db.upsert(UserRole(user_id=user_id, is_admin=is_admin))
        logger.info(f"Seeded default user: {user_id} (admin={is_admin})")


def _seed_default_tags(db: DatabaseManager) -> None:
    """Seed initial skill tags if the table is empty."""
    from ..datamodel.db import SkillTag

    existing = db.get(SkillTag, return_json=False)
    if existing.status and existing.data:
        return  # Already seeded

    default_tags = [
        "计算中心服务", "自动化", "代码开发", "科研",
        "办公", "LHAASO", "JUNO", "HEPS", "CSNS", "ALICPT",
    ]
    for i, name in enumerate(default_tags):
        db.upsert(SkillTag(name=name, sort_order=i))
    logger.info(f"Seeded {len(default_tags)} default skill tags")


async def init_managers(
    database_uri: str,
    config_dir: Path,
    app_root: Path,
    internal_workspace_root: str,
    external_workspace_root: str,
    inside_docker: bool,
    config: Dict[str, Any],
) -> None:
    """Initialize all manager instances"""
    global _db_manager, _websocket_manager, _team_manager

    logger.info("Initializing managers...")

    try:
        # Initialize database manager
        _db_manager = DatabaseManager(engine_uri=database_uri, base_dir=app_root)
        _db_manager.initialize_database(auto_upgrade=settings.UPGRADE_DATABASE)
        _seed_default_users(_db_manager)

        from .authz import bootstrap_platform_admins

        bootstrap_platform_admins(_db_manager)

        # Seed default skill tags if none exist
        _seed_default_tags(_db_manager)

        # init default team config
        await _db_manager.import_teams_from_directory(
            config_dir, settings.DEFAULT_USER_ID, check_exists=True
        )

        # Initialize connection manager
        _websocket_manager = WebSocketManager(
            db_manager=_db_manager,
            internal_workspace_root=Path(internal_workspace_root),
            external_workspace_root=Path(external_workspace_root),
            inside_docker=inside_docker,
            config=config,
        )
        logger.info("Connection manager initialized")


    except Exception as e:
        logger.error(f"Failed to initialize managers: {str(e)}")
        await cleanup_managers()  # Cleanup any partially initialized managers
        raise


async def cleanup_managers() -> None:
    """Cleanup and shutdown all manager instances"""
    global _db_manager, _websocket_manager, _team_manager

    logger.info("Cleaning up managers...")


    # Cleanup connection manager first to ensure all active connections are closed
    if _websocket_manager:
        try:
            await _websocket_manager.cleanup()
        except Exception as e:
            logger.error(f"Error cleaning up connection manager: {str(e)}")
        finally:
            _websocket_manager = None

    # TeamManager doesn't need explicit cleanup since WebSocketManager handles it
    _team_manager = None

    # Cleanup database manager last
    if _db_manager:
        try:
            await _db_manager.close()
        except Exception as e:
            logger.error(f"Error cleaning up database manager: {str(e)}")
        finally:
            _db_manager = None

    logger.info("All managers cleaned up")


# Utility functions for dependency management


# Error handling for manager operations


class ManagerOperationError(Exception):
    """Custom exception for manager operation errors"""

    def __init__(self, manager_name: str, operation: str, detail: str):
        self.manager_name = manager_name
        self.operation = operation
        self.detail = detail
        super().__init__(f"{manager_name} failed during {operation}: {detail}")


# ── skill auth dependencies ───────────────────────────────────────────────────

from functools import wraps

from fastapi import Request


def require_skill_role(*roles: str):
    """Require the caller to have one of the given skill_roles.

    Injects ``request.state.user_id`` if not already set by a prior dependency,
    then checks ``Userinfo.meta.skill_role``.

    Usage::

        @router.post("/upload")
        async def upload(..., user_id: str = Depends(require_skill_role("admin", "contributor"))):
            ...
    """
    from .auth_source import get_skill_role
    from .deps import get_db as _raw_get_db

    async def dependency(request: Request, db=Depends(_raw_get_db)) -> str:
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            raise HTTPException(status_code=401, detail="Not authenticated")

        skill_role = get_skill_role(db, user_id)
        if skill_role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions: need {', '.join(roles)}, got {skill_role}",
            )
        return user_id

    return dependency


async def resolve_user_from_apikey(
    request: Request,
    db: "DatabaseManager | None" = None,
) -> str | None:
    """Resolve user_id from API key in Authorization header or ?api_key query param.

    Calls the external API key verification service. The service requires:
    - api_key query param: the user's API key (to look up)
    - Authorization header: the admin API key from HEPAI_APP_ADMIN_API_KEY env var
    """
    import os

    verify_url = os.getenv("DRSAI_UI_API_KEY_VERIFY_URL", "http://localhost:42551/apiv2/user")
    admin_api_key = os.getenv("HEPAI_APP_ADMIN_API_KEY", "")

    # Extract user's API key from Authorization header or query param
    auth = request.headers.get("Authorization", "")
    api_key: str | None = None

    if auth.startswith("bearer ") or auth.startswith("Bearer "):
        api_key = auth.split(" ", 1)[1]
    if not api_key:
        api_key = request.query_params.get("api_key")

    if not api_key:
        return None  # No API key present, caller decides whether that's ok

    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{verify_url}/get_user_info_by_key",
                params={"api_key": api_key},
                headers={"Authorization": f"Bearer {admin_api_key}"} if admin_api_key else {},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid API key")

        body = resp.json()
        user_id = None
        if isinstance(body, dict):
            user_id = body.get("email") or body.get("user_id") or body.get("userId")

        if not user_id:
            raise HTTPException(status_code=401, detail="Cannot resolve user from API key")

        # Store on request.state for downstream use
        request.state.user_id = user_id
        if db is not None:
            request.state.skill_role = None  # will be resolved by require_skill_role
        return user_id

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"API key verification failed: {e}")
        raise HTTPException(status_code=502, detail="API key verification service unavailable")


async def get_user_or_none(
    request: Request,
    db=Depends(get_db),
) -> str | None:
    """Resolve user_id from JWT or API key. Returns None if neither is present.

    Use this for endpoints that are optionally authenticated (e.g. public reads
    that may show extra info to logged-in users)."""
    # Try API key first (query param or header), then JWT
    try:
        uid = await resolve_user_from_apikey(request, db)
        if uid:
            return uid
    except HTTPException:
        pass  # Invalid API key, fall through

    # Try JWT Bearer token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        from ..drsai_adapter.sso.jwt import decode_jwt_token
        try:
            token = auth.split(" ", 1)[1]
            data = decode_jwt_token(token)
            if data.user_id:
                request.state.user_id = data.user_id
                return data.user_id
        except Exception:
            pass

    return None


def require_auth(*roles: str):
    """Require auth (API key or JWT) AND optionally a skill_role.

    Usage::

        @router.post("/upload")
        async def upload(..., user_id: str = Depends(require_auth("admin", "contributor"))):
            ...
    """
    from .auth_source import get_skill_role

    async def dependency(request: Request, db=Depends(get_db)) -> str:
        user_id = await resolve_user_from_apikey(request, db)
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required")

        if roles:
            skill_role = get_skill_role(db, user_id)
            if skill_role not in roles:
                raise HTTPException(
                    status_code=403,
                    detail=f"Insufficient permissions: need {', '.join(roles)}, got {skill_role}",
                )
        return user_id

    return dependency
