"""GFS cloud-storage routes for ``desktop_gateway``.

Personal credentials can be entered in the desktop GFS UI on first use and are
persisted under ``$DRSAI_HOME/.env`` (dev: ``~/.drsai-dev/.env``). Saving also
syncs ``cli_config.json["gfs"]`` so Agent GFS tools load the same credentials.
Closing GFS from the UI clears both stores.

Routes are mounted by ``desktop_gateway.app`` via ``gfs.router()``.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("drsai.desktop_gateway.gfs")

# 用户创建 Access/Secret Key 的门户；UI 首次引导会打开此地址
GFS_PORTAL_URL = "https://gfs.ihep.ac.cn/"
# 仅读写这些键，避免污染用户 $DRSAI_HOME/.env 里的其它配置
_GFS_ENV_KEY_RE = re.compile(
    r"^(DRSAI_GFS_ENABLED|DRSAI_GFS_MODE|GFS_[A-Z0-9_]+)$"
)


def _as_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _gfs_enabled() -> bool:
    return _as_bool(os.getenv("DRSAI_GFS_ENABLED"), default=False) or _as_bool(
        os.getenv("GFS_ENABLED"),
        default=False,
    )


def _drsai_home() -> Path:
    """Resolve desktop data home (``DRSAI_HOME`` / ``~/.drsai``)."""
    raw = (os.environ.get("DRSAI_HOME") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".drsai"


def _gfs_home_env_path() -> Path:
    """个人 GFS 密钥文件路径：``$DRSAI_HOME/.env``。"""
    return _drsai_home() / ".env"


def _parse_env_assignments(text: str) -> dict[str, str]:
    """从 .env 文本中解析 GFS 相关键值（忽略注释与其它键）。"""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not _GFS_ENV_KEY_RE.match(key):
            continue
        value = value.strip().strip('"').strip("'")
        out[key] = value
    return out


def _bootstrap_gfs_env_from_home(*, overwrite: bool = False) -> None:
    """Load GFS keys from ``$DRSAI_HOME/.env`` into ``os.environ``.

    By default only fills missing keys so process/repo env still wins.
    When ``overwrite`` is true (after UI save), home file values win.
    """
    path = _gfs_home_env_path()
    if not path.is_file():
        return
    try:
        assignments = _parse_env_assignments(path.read_text(encoding="utf-8"))
    except OSError as exc:
        logger.warning("Failed to read GFS home env %s: %s", path, exc)
        return
    for key, value in assignments.items():
        if overwrite or not os.environ.get(key, "").strip():
            os.environ[key] = value


def _upsert_gfs_home_env(updates: dict[str, str]) -> Path:
    """Merge ``updates`` into ``$DRSAI_HOME/.env``（只动 GFS 键，保留其它行）。"""
    path = _gfs_home_env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_lines: list[str] = []
    if path.is_file():
        try:
            existing_lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            existing_lines = []

    keys = set(updates)
    kept: list[str] = []
    for line in existing_lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.partition("=")[0].strip()
            if key in keys:
                continue  # 旧值由下方 updates 块覆盖
        kept.append(line)

    # Drop trailing blank lines before appending our block
    while kept and not kept[-1].strip():
        kept.pop()
    if kept and kept[-1].strip():
        kept.append("")
    kept.append("# GFS personal credentials (managed by desktop GFS setup)")
    for key, value in updates.items():
        kept.append(f"{key}={value}")
    kept.append("")
    path.write_text("\n".join(kept), encoding="utf-8")
    return path


_GFS_MANAGED_ENV_KEYS = (
    "DRSAI_GFS_ENABLED",
    "GFS_ENABLED",
    "DRSAI_GFS_MODE",
    "GFS_ACCESS_KEY",
    "GFS_SECRET_KEY",
    "GFS_BUCKET",
    "GFS_USER_EMAIL",
    "GFS_ENDPOINT",
    "GFS_S3_ENDPOINT",
)


def _remove_gfs_keys_from_home_env() -> Path:
    """Strip managed GFS keys from ``$DRSAI_HOME/.env`` (keep unrelated lines)."""
    path = _gfs_home_env_path()
    if not path.is_file():
        return path
    try:
        existing_lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return path

    managed = set(_GFS_MANAGED_ENV_KEYS)
    kept: list[str] = []
    skip_next_blank_after_marker = False
    for line in existing_lines:
        stripped = line.strip()
        if stripped.startswith("# GFS personal credentials"):
            skip_next_blank_after_marker = True
            continue
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.partition("=")[0].strip()
            if key in managed or _GFS_ENV_KEY_RE.match(key):
                continue
        if skip_next_blank_after_marker and not stripped:
            skip_next_blank_after_marker = False
            continue
        skip_next_blank_after_marker = False
        kept.append(line)

    while kept and not kept[-1].strip():
        kept.pop()
    path.write_text(("\n".join(kept) + ("\n" if kept else "")), encoding="utf-8")
    return path


def _clear_gfs_os_environ() -> None:
    for key in _GFS_MANAGED_ENV_KEYS:
        os.environ.pop(key, None)


def _mask_secret(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    if len(text) <= 4:
        return "***"
    return f"***{text[-4:]}"


def _live_cli_config_path() -> Path:
    """Resolve ``cli_config.json`` from the current ``DRSAI_HOME`` (not import-time)."""
    from drsai.version import __appname__

    home = os.environ.get("DRSAI_HOME") or str(Path.home() / f".{__appname__}")
    return Path(home).expanduser() / "configs" / "cli_config.json"


def _sync_gfs_cli_config(
    *,
    enabled: bool,
    access_key: str = "",
    secret_key: str = "",
    bucket: str = "",
    email: str = "",
    s3_endpoint: str = "",
    clear: bool = False,
) -> str | None:
    """Keep ``cli_config.json["gfs"]`` in sync so agent GFS tools can load.

    Writes the live ``$DRSAI_HOME/configs/cli_config.json`` path (same file
    ``create_agent`` re-reads). Import-time ``CLI_CONFIG_PATH`` can point at a
    different home if the package was imported before Desktop set ``DRSAI_HOME``.

    Returns the config path when available.
    """
    path = _live_cli_config_path()
    try:
        cfg: dict[str, Any] = {}
        if path.is_file():
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                cfg = loaded
        if clear or not enabled:
            if "gfs" in cfg:
                del cfg["gfs"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            return str(path)
        cfg["gfs"] = {
            "enabled": True,
            "mode": "personal",
            "access_key": access_key,
            "secret_key": secret_key,
            "bucket": bucket,
            "email": email or "",
            "s3_endpoint": s3_endpoint or "https://fgws3-gfs.ihep.ac.cn",
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return str(path)
    except Exception as exc:
        logger.warning("GFS cli_config sync failed: %s", exc)
        return str(path)


async def _evict_agents_for_gfs_tool_refresh() -> None:
    """Drop cached Agents so the next turn rebuilds tools from cli_config.

    Desktop keeps one Agent per (user, session). GFS tools are attached at
    ``create_agent`` time; without eviction, toggling GFS off would leave old
    chats with live ``gfs_*`` tools while new chats correctly have none.

    Evict **all** sessions, not only ``effective_user_id()``: GFS config is
    process-wide, and config save/clear requests historically only sent the
    gateway instance token (offline ``local``), which never matched the OIDC
    subject used for chat Agents — so same-dialog tools survived the toggle.
    """
    try:
        from drsai.backend.desktop_gateway import _state

        n = await _state.agent_manager().evict_all()
        logger.info("GFS tool refresh: evicted %s cached agent(s)", n)
    except Exception as exc:
        logger.warning("GFS agent cache eviction skipped: %s", exc)


def _personal_credentials_complete() -> bool:
    """个人模式：Access / Secret / Bucket 三者齐全才算可连。"""
    return bool(
        os.getenv("GFS_ACCESS_KEY", "").strip()
        and os.getenv("GFS_SECRET_KEY", "").strip()
        and os.getenv("GFS_BUCKET", "").strip()
    )


def _needs_setup() -> bool:
    """True when the desktop UI should show the first-run credential form."""
    _normalize_gfs_env_aliases()
    if _gfs_enabled() and _personal_credentials_complete():
        return False
    if _gfs_enabled() and (
        os.getenv("GFS_OPENAPI_KEY", "").strip() or os.getenv("GFS_API_KEY", "").strip()
    ):
        # Admin 模式已由环境变量配好，无需个人表单
        return False
    return True


def _normalize_gfs_env_aliases() -> None:
    """Accept common alternate env names used in docs / local .env samples."""
    aliases = (
        ("GFS_OPENAPI_KEY", ("GFS_API_KEY",)),
        ("GFS_OPENAPI_BASE", ("GFS_OPENAPI_URL",)),
        ("GFS_S3_ENDPOINT", ("GFS_ENDPOINT",)),
        ("GFS_ENDPOINT", ("GFS_S3_ENDPOINT",)),
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
            "GFS 未启用。请在桌面端「云盘（GFS）」页面填写密钥，"
            "或打开 https://gfs.ihep.ac.cn/ 创建访问密钥。"
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


class GfsConfigSaveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    access_key: str = Field(alias="accessKey")
    secret_key: str = Field(alias="secretKey")
    bucket: str
    email: str | None = None
    endpoint: str | None = None


class GfsUploadContentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    remote_path: str = Field(alias="remotePath")
    content_base64: str = Field(alias="contentBase64")
    content_type: str | None = Field(default=None, alias="contentType")
    user_id: str | None = Field(default=None, alias="userId")


class GfsMkdirRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    parent_path: str = Field(default="", alias="parentPath")
    name: str
    user_id: str | None = Field(default=None, alias="userId")


class GfsRenameRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str
    new_name: str = Field(alias="newName")
    is_dir: bool = Field(default=False, alias="isDir")
    user_id: str | None = Field(default=None, alias="userId")


class GfsMoveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_path: str = Field(alias="sourcePath")
    target_dir: str = Field(default="", alias="targetDir")
    is_dir: bool = Field(default=False, alias="isDir")
    user_id: str | None = Field(default=None, alias="userId")


api = APIRouter(tags=["gfs"])


def _require_client(user_id: str | None):
    client, error = _resolve_gfs_client(user_id)
    if client is None:
        raise HTTPException(
            status_code=503,
            detail=error
            or "GFS is not configured. Open 云盘（GFS） and enter credentials from https://gfs.ihep.ac.cn/.",
        )
    return client


def _public_config_status(*, include_credentials: bool = False) -> dict[str, Any]:
    # 回填表单时以 home .env 为准，避免进程里残留的旧环境变量干扰
    _bootstrap_gfs_env_from_home(overwrite=include_credentials)
    _normalize_gfs_env_aliases()
    needs = _needs_setup()
    mode = "personal" if _use_personal_mode() else "admin"
    access_key = (os.getenv("GFS_ACCESS_KEY") or "").strip() or None
    secret_key = (os.getenv("GFS_SECRET_KEY") or "").strip() or None
    cli_config_path: str | None = None
    try:
        from drsai.backend.cli import config as cli_config
        cli_config_path = str(cli_config.CLI_CONFIG_PATH)
    except Exception:
        cli_config_path = None
    status: dict[str, Any] = {
        "configured": not needs and _gfs_enabled(),
        "enabled": _gfs_enabled(),
        "needsSetup": needs,
        "mode": mode,
        "bucket": (os.getenv("GFS_BUCKET") or "").strip() or None,
        "email": (os.getenv("GFS_USER_EMAIL") or "").strip() or None,
        "endpoint": (
            os.getenv("GFS_S3_ENDPOINT")
            or os.getenv("GFS_ENDPOINT")
            or "https://fgws3-gfs.ihep.ac.cn"
        ).strip(),
        "portalUrl": GFS_PORTAL_URL,
        "homeEnvPath": str(_gfs_home_env_path()),
        "cliConfigPath": cli_config_path,
        "accessKeyMasked": _mask_secret(access_key),
        "secretKeyMasked": _mask_secret(secret_key),
    }
    if include_credentials:
        # 优先读磁盘上的 .env，保证「配置密钥」回显的是用户上次保存值
        file_vals = {}
        path = _gfs_home_env_path()
        if path.is_file():
            try:
                file_vals = _parse_env_assignments(path.read_text(encoding="utf-8"))
            except OSError:
                file_vals = {}
        status["accessKey"] = (
            (file_vals.get("GFS_ACCESS_KEY") or os.getenv("GFS_ACCESS_KEY") or "").strip()
            or None
        )
        status["secretKey"] = (
            (file_vals.get("GFS_SECRET_KEY") or os.getenv("GFS_SECRET_KEY") or "").strip()
            or None
        )
        status["bucket"] = (
            (file_vals.get("GFS_BUCKET") or status["bucket"] or "").strip()
            or None
        )
        status["email"] = (
            (file_vals.get("GFS_USER_EMAIL") or status["email"] or "").strip()
            or None
        )
        status["accessKeyMasked"] = _mask_secret(status.get("accessKey"))
        status["secretKeyMasked"] = _mask_secret(status.get("secretKey"))
    return status


# 模块加载时补齐缺失的 GFS 环境变量（不覆盖进程里已有值）
_bootstrap_gfs_env_from_home(overwrite=False)


@api.get("/v1/gfs/config")
async def gfs_config_get():
    """读取 GFS 配置状态；含密钥回显，供桌面端表单使用。"""
    return _public_config_status(include_credentials=True)


@api.post("/v1/gfs/config")
async def gfs_config_save(req: GfsConfigSaveRequest):
    """保存个人密钥到 $DRSAI_HOME/.env，同步 cli_config.json，写入 os.environ 并做 S3 探活。"""
    access_key = (req.access_key or "").strip()
    secret_key = (req.secret_key or "").strip()
    bucket = (req.bucket or "").strip()
    email = (req.email or "").strip()
    endpoint = (req.endpoint or "").strip() or "https://fgws3-gfs.ihep.ac.cn"
    if not access_key or not secret_key or not bucket:
        raise HTTPException(
            status_code=400,
            detail="请填写 Access Key、Secret Key 和完整桶名。",
        )

    updates = {
        "DRSAI_GFS_ENABLED": "true",
        "GFS_ENABLED": "true",
        "DRSAI_GFS_MODE": "personal",
        "GFS_ACCESS_KEY": access_key,
        "GFS_SECRET_KEY": secret_key,
        "GFS_BUCKET": bucket,
        "GFS_ENDPOINT": endpoint,
        "GFS_S3_ENDPOINT": endpoint,
    }
    if email:
        updates["GFS_USER_EMAIL"] = email

    path = _upsert_gfs_home_env(updates)
    # 立即生效，无需重启 gateway 进程
    for key, value in updates.items():
        os.environ[key] = value
    _normalize_gfs_env_aliases()
    _sync_gfs_cli_config(
        enabled=True,
        access_key=access_key,
        secret_key=secret_key,
        bucket=bucket,
        email=email,
        s3_endpoint=endpoint,
    )

    client, error = _resolve_gfs_client(email or None)
    if client is None:
        raise HTTPException(
            status_code=400,
            detail=error or "凭证已保存，但无法初始化 GFS 客户端。",
        )
    try:
        ok = bool(client.healthcheck())
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"凭证已保存，但 S3 探活失败：{exc}",
        ) from exc
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=(
                "凭证已保存，但 S3 探活失败。请核对 Access Key / Secret Key / "
                "桶名，并确认能访问 GFS 端点。"
            ),
        )

    logger.info("GFS personal config saved to %s (bucket=%s)", path, bucket)
    await _evict_agents_for_gfs_tool_refresh()
    status = _public_config_status()
    status["ok"] = True
    status["bucket"] = client.bucket
    status["message"] = f"已保存并连接成功（{client.bucket}）"
    return status


@api.delete("/v1/gfs/config")
async def gfs_config_clear():
    """关闭 GFS：清除 $DRSAI_HOME/.env 中的 GFS 键、cli_config.json["gfs"] 与进程环境变量。"""
    home_path = _remove_gfs_keys_from_home_env()
    _clear_gfs_os_environ()
    cli_path = _sync_gfs_cli_config(enabled=False, clear=True)
    await _evict_agents_for_gfs_tool_refresh()
    logger.info("GFS config cleared (home=%s, cli=%s)", home_path, cli_path)
    status = _public_config_status(include_credentials=True)
    status["ok"] = True
    status["enabled"] = False
    status["configured"] = False
    status["needsSetup"] = True
    status["message"] = "已关闭 GFS 并清除本地配置。"
    return status


@api.get("/v1/gfs/health")
async def gfs_health(
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    """桌面端连接状态；``needsSetup`` 为 true 时 UI 展示首次配置表单。"""
    _bootstrap_gfs_env_from_home(overwrite=False)
    _normalize_gfs_env_aliases()
    mode = "personal" if _use_personal_mode() else "admin"
    if _needs_setup():
        return {
            "ok": False,
            "mode": mode,
            "needsSetup": True,
            "portalUrl": GFS_PORTAL_URL,
            "reason": (
                "尚未配置 GFS 密钥。请打开 https://gfs.ihep.ac.cn/ "
                "创建访问密钥后在此填写。"
            ),
        }
    if not _gfs_enabled():
        return {
            "ok": False,
            "mode": mode,
            "needsSetup": True,
            "portalUrl": GFS_PORTAL_URL,
            "reason": "GFS 未启用。请在云盘页面填写 GFS 密钥。",
        }
    client, error = _resolve_gfs_client(x_opendrsai_user)
    if client is None:
        return {
            "ok": False,
            "mode": mode,
            "needsSetup": _needs_setup(),
            "portalUrl": GFS_PORTAL_URL,
            "reason": error or "GFS 未配置。",
        }
    try:
        ok = bool(client.healthcheck())
        if ok:
            return {
                "ok": True,
                "mode": mode,
                "bucket": client.bucket,
                "needsSetup": False,
                "portalUrl": GFS_PORTAL_URL,
            }
        return {
            "ok": False,
            "mode": mode,
            "bucket": client.bucket,
            "needsSetup": False,
            "portalUrl": GFS_PORTAL_URL,
            "reason": "S3 探活失败，请检查 AK/SK、bucket 与网络是否可达 GFS_S3_ENDPOINT。",
        }
    except Exception as exc:
        logger.warning("GFS healthcheck error: %s", exc)
        return {
            "ok": False,
            "mode": mode,
            "bucket": getattr(client, "bucket", None),
            "needsSetup": False,
            "portalUrl": GFS_PORTAL_URL,
            "reason": f"S3 探活异常：{exc}",
        }


@api.post("/v1/gfs/list")
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


@api.post("/v1/gfs/stat")
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


@api.post("/v1/gfs/read")
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


@api.post("/v1/gfs/write")
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


@api.post("/v1/gfs/upload")
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


@api.post("/v1/gfs/upload-content")
async def gfs_upload_content(
    req: GfsUploadContentRequest,
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    """Electron 选文件无本地 path 时：前端传 base64，网关写对象。"""
    client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
    try:
        payload = base64.b64decode(req.content_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 content: {exc}") from exc
    try:
        etag = client.write_bytes(
            req.remote_path,
            payload,
            content_type=req.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS upload failed: {exc}") from exc
    return {"path": req.remote_path, "size": len(payload), "etag": etag}


@api.post("/v1/gfs/upload-browser")
async def gfs_upload_browser(
    file: UploadFile = File(...),
    remote_path: str = Form(..., alias="remote_path"),
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    client = _require_client(x_opendrsai_user)
    data = await file.read()
    try:
        etag = client.write_bytes(
            remote_path,
            data,
            content_type=file.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS upload failed: {exc}") from exc
    return {"path": remote_path, "size": len(data), "etag": etag}


@api.post("/v1/gfs/download")
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


@api.post("/v1/gfs/delete")
async def gfs_delete(
    req: GfsPathRequest,
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
    try:
        path = req.path or ""
        if path.endswith("/"):
            client.delete_prefix(path)
        else:
            client.delete(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS delete failed: {exc}") from exc
    return {"path": req.path}


@api.post("/v1/gfs/mkdir")
async def gfs_mkdir(
    req: GfsMkdirRequest,
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
    name = (req.name or "").strip()
    if not name or "/" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid folder name")
    parent = (req.parent_path or "").strip().strip("/")
    folder_path = f"{parent}/{name}" if parent else name
    try:
        created = client.mkdir(folder_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS mkdir failed: {exc}") from exc
    return {"path": created, "name": name}


@api.post("/v1/gfs/rename")
async def gfs_rename(
    req: GfsRenameRequest,
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
    try:
        to_path = client.rename(req.path, req.new_name, is_dir=bool(req.is_dir))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS rename failed: {exc}") from exc
    return {"path": to_path, "name": req.new_name.strip()}


@api.post("/v1/gfs/move")
async def gfs_move(
    req: GfsMoveRequest,
    x_opendrsai_user: str | None = Header(default=None, alias="X-OpenDrSai-User"),
):
    client = _require_client(_pick_user_id(req.user_id, x_opendrsai_user))
    source = (req.source_path or "").strip()
    if not source:
        raise HTTPException(status_code=400, detail="sourcePath is required")
    target = (req.target_dir or "").strip().strip("/")
    name = source.rstrip("/").rsplit("/", 1)[-1]
    dest = f"{target}/{name}" if target else name
    try:
        to_path = client.move(source, dest, is_dir=bool(req.is_dir))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GFS move failed: {exc}") from exc
    return {"path": to_path, "name": name}


@api.post("/v1/gfs/share-url")
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


def router() -> APIRouter:
    """供 ``desktop_gateway.app`` 挂载的 GFS 路由表。"""
    return api
