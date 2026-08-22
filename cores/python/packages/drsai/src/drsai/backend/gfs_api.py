"""GFS cloud-storage REST routes for the desktop gateway.

Mirrors ``run_drsai_agent._build_gfs_tools`` client resolution (personal vs
admin) and wraps ``GfsUserClient`` for the Electron GFS 云盘 UI.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


def _as_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _gfs_enabled() -> bool:
    return _as_bool(os.getenv("DRSAI_GFS_ENABLED"), default=False) or _as_bool(
        os.getenv("GFS_ENABLED"),
        default=False,
    )


def _normalize_gfs_env_aliases() -> None:
    """Accept common alternate env names used in docs / local .env samples."""
    aliases = (
        ("GFS_OPENAPI_KEY", ("GFS_API_KEY",)),
        ("GFS_OPENAPI_BASE", ("GFS_OPENAPI_URL",)),
        ("GFS_S3_ENDPOINT", ("GFS_ENDPOINT",)),
    )
    for canonical, alts in aliases:
        if os.environ.get(canonical, "").strip():
            continue
        for alt in alts:
            value = os.environ.get(alt, "").strip()
            if value:
                os.environ[canonical] = value
                break


def _use_personal_mode() -> bool:
    _normalize_gfs_env_aliases()
    mode = (os.getenv("DRSAI_GFS_MODE") or "").strip().lower()
    has_personal = bool(
        os.getenv("GFS_ACCESS_KEY")
        and os.getenv("GFS_SECRET_KEY")
        and os.getenv("GFS_BUCKET")
    )
    has_admin = bool(os.getenv("GFS_OPENAPI_KEY") or os.getenv("GFS_API_KEY"))
    if mode == "personal":
        return True
    if mode == "admin":
        return False
    # Prefer personal when complete AKSK is present; otherwise admin OpenAPI.
    if has_personal:
        return True
    if has_admin:
        return False
    return has_personal


def _default_gfs_user_email() -> str | None:
    email = (os.getenv("GFS_USER_EMAIL") or "").strip()
    return email or None


def _resolve_gfs_client(user_id: str | None = None):
    """Return ``(client, error_message)``.

    ``client`` is ``None`` when GFS is disabled / unconfigured / unreachable.
    ``error_message`` is a short user-facing reason when client is missing.
    """
    _normalize_gfs_env_aliases()
    if not _gfs_enabled():
        return None, (
            "GFS 未启用。请在仓库根目录或 ~/.drsai/.env 中设置 DRSAI_GFS_ENABLED=true。"
        )

    try:
        if _use_personal_mode():
            from drsai.modules.managers.gfs import get_personal_user_client

            return (
                get_personal_user_client(
                    email=user_id or _default_gfs_user_email(),
                    healthcheck=False,
                ),
                None,
            )

        email = user_id or _default_gfs_user_email()
        if not email:
            return None, (
                "Admin 模式需要用户邮箱：设置 GFS_USER_EMAIL，或先登录桌面端。"
            )
        if not (os.getenv("GFS_OPENAPI_KEY") or os.getenv("GFS_API_KEY")):
            return None, (
                "Admin 模式缺少 GFS_OPENAPI_KEY。"
            )
        from drsai.modules.managers.gfs import GfsProvisioner

        return GfsProvisioner.get().get_user_client(email), None
    except Exception as exc:
        logger.warning("GFS client resolve failed: %s", exc)
        message = str(exc)
        if "timed out" in message.lower() or "timeout" in message.lower():
            return None, (
                "无法连接 GFS OpenAPI（超时）。请确认能访问 "
                f"{os.getenv('GFS_OPENAPI_BASE') or os.getenv('GFS_OPENAPI_URL') or 'http://gfs.ihep.ac.cn:7800'}，"
                "或改为 personal 模式并配置 GFS_ACCESS_KEY / GFS_SECRET_KEY / GFS_BUCKET。"
            )
        return None, f"GFS 凭证初始化失败：{message}"


def _object_to_dict(obj: Any) -> dict[str, Any]:
    return {
        "path": obj.path,
        "size": int(obj.size),
        "etag": obj.etag or "",
        "modifiedMs": int(obj.modified_ms),
        "isDir": bool(obj.is_dir),
    }


def _pick_user_id(
    body_user_id: str | None,
    header_user: str | None,
) -> str | None:
    for value in (body_user_id, header_user, _default_gfs_user_email()):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


class GfsListRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prefix: str | None = ""
    recursive: bool = False
    max_items: int | None = Field(default=None, alias="maxItems")
    user_id: str | None = Field(default=None, alias="userId")


class GfsPathRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str
    user_id: str | None = Field(default=None, alias="userId")


class GfsWriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str
    content: str
    content_type: str | None = Field(default=None, alias="contentType")
    user_id: str | None = Field(default=None, alias="userId")


class GfsUploadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    local_path: str = Field(alias="localPath")
    remote_path: str = Field(alias="remotePath")
    user_id: str | None = Field(default=None, alias="userId")


class GfsDownloadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    remote_path: str = Field(alias="remotePath")
    local_path: str = Field(alias="localPath")
    user_id: str | None = Field(default=None, alias="userId")


class GfsShareUrlRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str
    ttl_minutes: int = Field(default=60, alias="ttlMinutes")
    response_content_type: str | None = Field(default=None, alias="responseContentType")
    user_id: str | None = Field(default=None, alias="userId")


def _require_client(user_id: str | None):
    client, error = _resolve_gfs_client(user_id)
    if client is None:
        raise HTTPException(
            status_code=503,
            detail=error
            or "GFS is not configured. Set DRSAI_GFS_ENABLED and GFS credentials in ~/.drsai/.env.",
        )
    return client


def register_gfs_routes(app: FastAPI) -> None:
    """Attach ``/v1/gfs/*`` endpoints to the gateway app."""

    @app.get("/v1/gfs/health")
    async def gfs_health(
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        """Probe GFS credentials. Always 200 so the desktop can distinguish
        'gateway reachable but unconfigured' from transport failures."""
        _normalize_gfs_env_aliases()
        mode = "personal" if _use_personal_mode() else "admin"
        if not _gfs_enabled():
            return {
                "ok": False,
                "mode": mode,
                "reason": "GFS 未启用。请设置 DRSAI_GFS_ENABLED=true。",
            }
        client, error = _resolve_gfs_client(x_opendrsai_user)
        if client is None:
            return {"ok": False, "mode": mode, "reason": error or "GFS 未配置。"}
        try:
            ok = bool(client.healthcheck())
            if ok:
                return {"ok": True, "mode": mode, "bucket": client.bucket}
            return {
                "ok": False,
                "mode": mode,
                "bucket": client.bucket,
                "reason": "S3 探活失败，请检查 AK/SK、bucket 与网络是否可达 GFS_S3_ENDPOINT。",
            }
        except Exception as exc:
            logger.warning("GFS healthcheck error: %s", exc)
            return {
                "ok": False,
                "mode": mode,
                "bucket": getattr(client, "bucket", None),
                "reason": f"S3 探活异常：{exc}",
            }

    @app.post("/v1/gfs/list")
    async def gfs_list(
        req: GfsListRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        user_id = _pick_user_id(req.user_id, x_opendrsai_user)
        client = _require_client(user_id)
        prefix = req.prefix or ""
        try:
            items = client.list_dir(
                prefix,
                recursive=bool(req.recursive),
                max_items=req.max_items,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("GFS list failed")
            raise HTTPException(status_code=502, detail=f"GFS list failed: {exc}") from exc
        truncated = bool(req.max_items and len(items) >= req.max_items)
        return {
            "items": [_object_to_dict(item) for item in items],
            "prefix": prefix,
            "truncated": truncated,
        }

    @app.post("/v1/gfs/stat")
    async def gfs_stat(
        req: GfsPathRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        try:
            return _object_to_dict(client.head(req.path))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=404, detail=f"GFS object not found: {exc}") from exc

    @app.post("/v1/gfs/read")
    async def gfs_read(
        req: GfsPathRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        try:
            content = client.read_text(req.path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS read failed: {exc}") from exc
        return {"path": req.path, "content": content}

    @app.post("/v1/gfs/write")
    async def gfs_write(
        req: GfsWriteRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        try:
            etag = client.write_text(
                req.path,
                req.content,
                content_type=req.content_type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS write failed: {exc}") from exc
        return {"path": req.path, "etag": etag}

    @app.post("/v1/gfs/upload")
    async def gfs_upload(
        req: GfsUploadRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        if not os.path.isfile(req.local_path):
            raise HTTPException(status_code=400, detail=f"Local file not found: {req.local_path}")
        try:
            client.upload_file(req.local_path, req.remote_path)
            size = os.path.getsize(req.local_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS upload failed: {exc}") from exc
        return {"path": req.remote_path, "size": size}

    @app.post("/v1/gfs/download")
    async def gfs_download(
        req: GfsDownloadRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        try:
            client.download_file(req.remote_path, req.local_path)
            size = os.path.getsize(req.local_path) if os.path.isfile(req.local_path) else 0
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS download failed: {exc}") from exc
        return {"localPath": req.local_path, "size": size}

    @app.post("/v1/gfs/delete")
    async def gfs_delete(
        req: GfsPathRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        try:
            client.delete(req.path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS delete failed: {exc}") from exc
        return {"path": req.path}

    @app.post("/v1/gfs/share-url")
    async def gfs_share_url(
        req: GfsShareUrlRequest,
        x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
    ):
        client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
        ttl_minutes = max(1, int(req.ttl_minutes or 60))
        try:
            url = client.presign_get(
                req.path,
                ttl_sec=ttl_minutes * 60,
                response_content_type=req.response_content_type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GFS share-url failed: {exc}") from exc
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        return {"url": url, "expiresAt": expires_at.isoformat()}
