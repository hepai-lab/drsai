"""
Cloud / GFS 云存储 API
"""

import os
import time
import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from datetime import datetime, timezone

from pathlib import Path

from ..deps import get_db
from ...datamodel.db import UserFiles
from .gfs_utils import (
    get_gfs_config,
    get_gfs_bucket_configs,
    ensure_jcli,
    _jcli_bin,
    pick_all_bucket_pairs,
    ensure_gfs_provisioned,
    refresh_gfs_config,
    _fetch_gfs_pairs_from_openapi,
    _save_gfs_config_internal,
    invalidate_gfs_config,
    GfsAccessDenied,
    gfs_get,
    gfs_ls,
    gfs_mv,
    gfs_put,
    gfs_rm,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Per-user TTL tracker for config refresh — prevents hammering the OpenAPI on
# every cloud_status call. TTL is controlled by GFS_CONFIG_REFRESH_SECONDS env
# var (default 60). Multi-worker deployments: each worker track independently
# (worst case N extra OpenAPI calls per interval — acceptable).
_last_refresh: dict[str, float] = {}



def _load_dotenv(path: str) -> bool:
    """Minimal .env loader — KEY=VALUE per line, no interpolation.

    Only sets variables that are NOT already in the environment, so
    explicit env vars always win over the file. Skips blank lines and
    comments. Strips optional single/double quotes around values.

    Returns True if the file existed and was readable (even if no new
    vars were loaded).
    """
    if not os.path.isfile(path):
        return False
    loaded = 0
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            # Strip inline comments (# ...) and optional quotes
            val = val.split("#", 1)[0].strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = val
                loaded += 1
    if loaded:
        logger.info(f"Loaded {loaded} env var(s) from {path}")
    return True


# If GFS_API_KEY isn't in the environment (PM2 / systemd / bare uvicorn),
# try common .env locations in order — first match wins.
if not os.getenv("GFS_API_KEY"):
    _appdir = os.getenv("_APPDIR", os.path.join(os.path.expanduser("~"), ".drsai_ui"))
    _cwd = os.getcwd()
    _here = Path(__file__).resolve().parent
    _candidates = [
        os.path.join(_appdir, ".env"),           # ~/.drsai_ui/.env
        os.path.join(_cwd, ".env"),              # PM2 cwd .env
        str(_here / ".env"),                     # cloud.py sibling .env
        str(_here.parent / ".env"),              # routes/ .env
    ]
    # Also walk up from cloud.py to catch project-root .env
    for _up in _here.parents:
        _cand = str(_up / ".env")
        if _cand not in _candidates:
            _candidates.append(_cand)

    logger.info(f"GFS_API_KEY unset — searching .env in: _APPDIR={_appdir!r} cwd={_cwd!r}")
    _found = None
    for _path in _candidates:
        if _load_dotenv(_path):
            _found = _path
            break
    if _found:
        logger.info(f"GFS .env loaded from {_found}")
    else:
        logger.warning(f"GFS .env not found in any of {len(_candidates)} candidate paths")

def _sanitize_env(key: str, default: str = "") -> str:
    """Like os.getenv, but strips trailing inline comments (# ...) and whitespace."""
    raw = os.getenv(key, default)
    return raw.split("#", 1)[0].strip() if raw else raw

GFS_OPENAPI_URL = _sanitize_env("GFS_OPENAPI_URL", "http://gfs.ihep.ac.cn:7800")
GFS_API_KEY = _sanitize_env("GFS_API_KEY", "")

# Diagnose GFS env at import time (once per worker)
logger.info(
    "GFS env vars at import: "
    f"GFS_OPENAPI_URL={GFS_OPENAPI_URL!r} "
    f"GFS_API_KEY={'SET' if GFS_API_KEY else 'UNSET'} "
    f"GFS_ENDPOINT={os.getenv('GFS_ENDPOINT', 'UNSET')!r} "
    f"GFS_AK={'SET' if os.getenv('GFS_AK') else 'UNSET'} "
    f"GFS_SK={'SET' if os.getenv('GFS_SK') else 'UNSET'} "
    f"GFS_BUCKET={'SET' if os.getenv('GFS_BUCKET') else 'UNSET'}"
)


# ── 模型 ──────────────────────────────────────────────────────────

class ProvisionRequest(BaseModel):
    user_id: str


class CloudStatusResponse(BaseModel):
    connected: bool
    mountPath: str
    lastSyncTime: Optional[str] = None
    syncing: bool = False
    bucket_name: Optional[str] = None
    access_key: Optional[str] = None
    buckets: Optional[List[dict]] = None


class CloudFileEntry(BaseModel):
    name: str
    path: str
    size: int = 0
    type: str = "file"
    suffix: Optional[str] = None
    syncStatus: str = "synced"
    updatedAt: Optional[str] = None
    bucket_name: Optional[str] = None
    children: Optional[List["CloudFileEntry"]] = None


class CloudTemplateEntry(BaseModel):
    name: str
    path: str
    description: Optional[str] = None
    suffix: str


class SendToAgentRequest(BaseModel):
    filePaths: List[str]
    sessionId: str


class ApplyTemplateRequest(BaseModel):
    templatePath: str
    sessionId: str


class FileUrlRequest(BaseModel):
    path: str


class PullToWorkspaceRequest(BaseModel):
    paths: List[str]
    user_id: str = ""


class MoveRequest(BaseModel):
    sourcePath: str
    targetDir: str


class CreateFolderRequest(BaseModel):
    parentPath: str
    name: str

class RenameRequest(BaseModel):
    oldPath: str
    newName: str


# ── helpers ───────────────────────────────────────────────────────

def _ok(data):
    return {"status": True, "data": data}

def _err(msg: str, status_code: int = 400):
    raise HTTPException(status_code=status_code, detail=msg)

def _gfs_openapi_headers():
    return {"Content-Type": "application/json", "X-API-Key": GFS_API_KEY}


def _parse_bucket_path(path: str, bucket_cfgs: list) -> tuple:
    """Determine which bucket a path belongs to.

    In multi-bucket mode, paths from the UI are prefixed with the bucket name
    (e.g. "my-bucket/subdir/file.txt"). This helper extracts the bucket prefix
    and returns the matching per-bucket cfg + the bucket-relative remainder.

    Returns (bucket_cfg_dict, relative_path). Falls back to the first bucket
    if no prefix matches (single-bucket or bare path).
    """
    if not bucket_cfgs:
        return ({}, path)
    if len(bucket_cfgs) == 1:
        return (bucket_cfgs[0], path.lstrip("/"))
    norm = path.lstrip("/")
    for bc in bucket_cfgs:
        bn = bc["bucket_name"]
        if bn and (norm == bn or norm.startswith(bn + "/")):
            rel = norm[len(bn):].lstrip("/")
            return (bc, rel)
    # No bucket prefix — default to first bucket
    return (bucket_cfgs[0], norm)


def _redact_secrets(obj):
    """Recursively redact secret_key / login_password / protocol_password values.
    Per OpenAPI docs: secret_key is sensitive and must not be logged in plaintext."""
    SENSITIVE = {"secret_key", "login_password", "protocol_password"}
    if isinstance(obj, dict):
        return {k: ("***" if k in SENSITIVE else _redact_secrets(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_secrets(x) for x in obj]
    return obj


def _save_gfs_config(db, user_id: str, gfs_config: dict) -> None:
    try:
        response = db.get(UserFiles, filters={"user_id": user_id}, return_json=False)
        if not response.status or not response.data:
            userfiles = UserFiles(user_id=user_id, files={})
        else:
            userfiles = response.data[0]
            if userfiles.files is None:
                userfiles.files = {}
        userfiles.files["gfs_config"] = gfs_config
        db.upsert(userfiles)
    except Exception as e:
        logger.error(f"Failed to save gfs_config for {user_id}: {e}")


# ── 接口 ──────────────────────────────────────────────────────────

@router.post("/provision", response_model=dict)
async def cloud_provision(req: ProvisionRequest, db=Depends(get_db)):
    """
    用 统一认证 email 作为 user_id，从 GFS OpenAPI 拉取该用户的现有 AKSK + bucket，
    并存储到 UserFiles.gfs_config。GFS 用户由中央系统预先开户，本接口只做查询，不创建。
    DEV 模式下若无 GFS_API_KEY，直接将环境变量凭证写入该用户的 DB 记录（免去 OpenAPI 调用）。
    """
    logger.info(f"POST /cloud/provision called for user_id={req.user_id!r}")

    if not req.user_id:
        _err("user_id 不能为空")

    endpoint = _sanitize_env("GFS_ENDPOINT", "https://fgws3-gfs.ihep.ac.cn")
    logger.info(f"GFS provision: endpoint={endpoint} api_key_set={bool(GFS_API_KEY)}")

    # ── DEV shortcut: no API key → seed from env vars ────────────────
    if not GFS_API_KEY:
        ak = os.getenv("GFS_AK", "")
        sk = os.getenv("GFS_SK", "")
        bucket_name = os.getenv("GFS_BUCKET", "")
        if not (ak and sk and bucket_name):
            _err("DEV 模式下未配置 GFS_AK / GFS_SK / GFS_BUCKET", 500)
        gfs_config = {
            "gfs_user_id": req.user_id,
            "endpoint": endpoint,
            "provisioned_at": int(time.time()),
            "buckets": [{
                "bucket_name": bucket_name,
                "access_key": ak,
                "secret_key": sk,
            }],
        }
        _save_gfs_config(db, req.user_id, gfs_config)
        return _ok({"endpoint": endpoint, "buckets": gfs_config["buckets"]})

    # ── Production: lookup-only against GFS OpenAPI ──────────────────
    # Users are pre-created in GFS by the central IHEP system; their 统一认证 email
    # IS the user_id in the GFS API. We never POST /v1/users from here — just
    # fetch their existing credentials and bucket by email.
    import httpx

    headers = _gfs_openapi_headers()
    credentials = []
    buckets = []
    user_id_field = req.user_id  # 统一认证 email, e.g. "haiuser01@ihep.ac.cn"

    async def _list_credentials(client) -> list:
        try:
            resp = await client.get(
                f"{GFS_OPENAPI_URL}/v1/users/{user_id_field}/credentials",
                headers=headers,
            )
        except httpx.HTTPError as e:
            logger.error(f"GFS credentials lookup failed for {req.user_id}: {e}")
            _err("无法连接 GFS 服务", 502)
        body = resp.json() if resp.content else {}
        logger.info(f"GFS get credentials (status={resp.status_code}): {_redact_secrets(body)}")
        if resp.status_code == 404:
            _err(f"GFS 系统中未找到该用户 ({req.user_id})，请联系管理员开户", 404)
        data = body.get("data", body) if isinstance(body, dict) else {}
        return data.get("items", []) if isinstance(data, dict) else []

    async def _mint_credential(client) -> bool:
        """Mint a fresh RW credential pair via POST /v1/users/{email}/credentials.
        Response body deliberately does NOT include AK/SK — caller re-lists."""
        try:
            resp = await client.post(
                f"{GFS_OPENAPI_URL}/v1/users/{user_id_field}/credentials",
                headers=headers,
                json={"permission": "rw"},
            )
        except httpx.HTTPError as e:
            logger.error(f"GFS credential mint HTTP error for {req.user_id}: {e}")
            return False
        if resp.status_code >= 400:
            logger.warning(
                f"GFS credential mint failed for {req.user_id} "
                f"(status={resp.status_code}, body={resp.text[:200]})"
            )
            return False
        body = resp.json() if resp.content else {}
        inner = body.get("code") if isinstance(body, dict) else None
        if inner not in (200, "200", None):
            logger.warning(f"GFS credential mint inner code={inner} for {req.user_id}")
            return False
        logger.info(f"GFS minted new RW credential for {req.user_id}")
        return True

    logger.info(
        f"GFS provision: looking up credentials for {user_id_field!r} "
        f"via {GFS_OPENAPI_URL}/v1/users/{user_id_field}/credentials"
    )

    async with httpx.AsyncClient(timeout=15) as client:
        credentials = await _list_credentials(client)
        logger.info(f"GFS provision: got {len(credentials)} credential(s) for {user_id_field!r}")

        # GET /v1/users/{email}/buckets → full bucket list
        try:
            logger.info(
                f"GFS provision: looking up buckets for {user_id_field!r} "
                f"via {GFS_OPENAPI_URL}/v1/users/{user_id_field}/buckets"
            )
            resp2 = await client.get(
                f"{GFS_OPENAPI_URL}/v1/users/{user_id_field}/buckets",
                headers=headers,
            )
            body2 = resp2.json() if resp2.content else {}
            logger.info(f"GFS get buckets (status={resp2.status_code}): {body2}")
            if resp2.status_code == 404:
                _err(f"GFS 系统中未找到该用户的存储桶 ({req.user_id})，请联系管理员", 404)
            data2 = body2.get("data", body2) if isinstance(body2, dict) else {}
            buckets = data2.get("items", []) if isinstance(data2, dict) else []
        except httpx.HTTPError as e:
            logger.error(f"GFS buckets lookup failed for {req.user_id}: {e}")
            _err("无法获取 GFS 存储桶信息", 502)

        logger.info(
            f"GFS provision: pairing {len(credentials)} cred(s) × {len(buckets)} bucket(s) "
            f"for {user_id_field!r}"
        )

        # Pair EVERY bucket with its best credential (multi-bucket support)
        pairs = pick_all_bucket_pairs(credentials, buckets, user_id_field)
        logger.info(
            f"GFS provision: pair result for {user_id_field!r} → "
            f"{len(pairs)}/{len(buckets)} bucket-credential pairs"
        )

        # User has buckets but no usable credential — mint one and retry once.
        # Covers fresh accounts (default bucket + zero AKSKs) and accounts where
        # every existing key is inactive/expired/RO.
        if not pairs and buckets:
            logger.info(
                f"GFS provision: no usable AK/SK for {user_id_field!r} "
                f"but {len(buckets)} bucket(s) exist — attempting credential mint"
            )
            if await _mint_credential(client):
                credentials = await _list_credentials(client)
                pairs = pick_all_bucket_pairs(credentials, buckets, user_id_field)

    if not pairs:
        logger.warning(
            f"GFS lookup incomplete for {req.user_id}: "
            f"no bucket-credential pairs (creds={len(credentials)} buckets={len(buckets)})"
        )
        _err(
            "未找到您的 GFS 访问密钥（AK/SK）。"
            "请前往 https://gfs.ihep.ac.cn/ 创建访问密钥并关联存储桶后重试。",
            400,
        )

    bucket_names = [p["bucket_name"] for p in pairs]
    logger.info(
        f"GFS provision: SUCCESS for {user_id_field!r} "
        f"buckets={bucket_names} endpoint={endpoint}"
    )
    gfs_config = {
        "gfs_user_id": user_id_field,
        "endpoint": endpoint,
        "provisioned_at": int(time.time()),
        "buckets": pairs,
    }
    _save_gfs_config(db, req.user_id, gfs_config)
    return _ok({"endpoint": endpoint, "buckets": pairs})


def _not_connected():
    """Shorthand for a disconnected CloudStatusResponse."""
    return _ok(CloudStatusResponse(
        connected=False,
        mountPath="",
        lastSyncTime=None,
    ).model_dump())


@router.get("/status", response_model=dict)
async def cloud_status(
    user_id: str = "",
    db=Depends(get_db),
):
    """检查用户 GFS 连接状态。

    每次都直接查询 GFS OpenAPI 验证凭据是否仍然存在：
    - 凭据非空 → 更新本地配置，返回 connected=True
    - 凭据为空 → 清除本地配置，返回 connected=False
    - OpenAPI 不可达 → 返回 connected=False
    """
    if not user_id:
        return _not_connected()

    cfg = get_gfs_config(db, user_id)
    if not cfg:
        if await ensure_gfs_provisioned(db, user_id):
            cfg = get_gfs_config(db, user_id)
    if not cfg:
        return _not_connected()

    # Always query OpenAPI directly — no caching
    source = "openapi"
    try:
        pairs, endpoint = await asyncio.wait_for(
            _fetch_gfs_pairs_from_openapi(user_id), timeout=5
        )
    except (asyncio.TimeoutError, Exception) as e:
        logger.warning(f"cloud_status: user={user_id} OpenAPI unreachable: {e} → disconnected")
        return _not_connected()

    if not pairs:
        # No credentials at all → disconnected
        logger.info(f"cloud_status: user={user_id} source={source} buckets=0 → disconnected")
        invalidate_gfs_config(db, user_id)
        return _not_connected()

    # Credentials exist → update local config
    new_config = {
        "gfs_user_id": user_id,
        "endpoint": endpoint,
        "provisioned_at": int(time.time()),
        "buckets": pairs,
    }
    try:
        _save_gfs_config_internal(db, user_id, new_config)
        cfg = new_config
    except Exception:
        pass  # save failed → keep using old config

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_list = [bc.get("bucket_name") for bc in bucket_cfgs]
    first_ak = bucket_cfgs[0].get("access_key", "") if bucket_cfgs else ""
    logger.info(
        f"cloud_status: user={user_id} source={source} "
        f"buckets={bucket_list} "
        f"access_key={'%s***' % first_ak[:8] if first_ak else 'NONE'}"
    )
    now = datetime.now(timezone.utc).isoformat()
    first_bucket = bucket_cfgs[0] if bucket_cfgs else {}
    return _ok(CloudStatusResponse(
        connected=True,
        mountPath="",
        lastSyncTime=now,
        bucket_name=first_bucket.get("bucket_name"),
        access_key=first_bucket.get("access_key"),
        buckets=[{"bucket_name": b["bucket_name"], "access_key": b["access_key"]} for b in bucket_cfgs],
    ).model_dump())


@router.get("/config", response_model=dict)
async def cloud_get_config(user_id: str, db=Depends(get_db)):
    """返回用户完整 GFS 配置（含 SK），用于设置页和 NetMount 引导。"""
    if not user_id:
        _err("user_id 不能为空")
    cfg = get_gfs_config(db, user_id)
    if not cfg:
        return _ok(None)
    return _ok(cfg)


@router.post("/refresh", response_model=dict)
async def cloud_refresh(user_id: str = "", db=Depends(get_db)):
    """刷新 GFS 配置（重新查询 OpenAPI 获取最新 bucket 列表）。"""
    if not user_id:
        _err("user_id 不能为空")
    cfg = get_gfs_config(db, user_id)
    if not cfg:
        if await ensure_gfs_provisioned(db, user_id):
            cfg = get_gfs_config(db, user_id)
    if not cfg:
        _err("未找到 GFS 配置", 404)

    refreshed = await refresh_gfs_config(db, user_id)
    if refreshed is not None:
        cfg = refreshed
        _last_refresh[user_id] = time.time()

    now = datetime.now(timezone.utc).isoformat()
    bucket_cfgs = get_gfs_bucket_configs(cfg)
    return _ok({
        "synced": True,
        "buckets": [bc.get("bucket_name") for bc in bucket_cfgs],
        "lastSyncTime": now,
    })


@router.get("/files", response_model=dict)
async def cloud_list_files(user_id: str = "", path: str = "", db=Depends(get_db)):
    """列出 GFS bucket 下指定路径的文件。"""
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        if await ensure_gfs_provisioned(db, user_id):
            cfg = get_gfs_config(db, user_id)
    if not cfg:
        logger.warning(
            f"cloud_list_files: no GFS config for user={user_id!r} "
            f"(GFS_ENABLED={os.getenv('GFS_ENABLED', 'unset')!r}), returning empty"
        )
        return _ok([])

    bucket_cfgs = get_gfs_bucket_configs(cfg)

    # Resolve bucket prefix from path (frontend sends "bucket-name/subdir").
    # When the path starts with a known bucket name, strip it and only query
    # that bucket. Also handles the legacy __bucket__<name> virtual prefix.
    actual_path = path
    if path.startswith("__bucket__"):
        target_bucket = path[len("__bucket__"):]
        bucket_cfgs = [bc for bc in bucket_cfgs if bc.get("bucket_name") == target_bucket]
        actual_path = ""
        logger.info(
            f"cloud_list_files: __bucket__ prefix → bucket={target_bucket!r} "
            f"actual_path={actual_path!r}"
        )
    else:
        # Check if path starts with a known bucket name (multi-bucket qualified)
        norm = path.lstrip("/")
        for bc in bucket_cfgs:
            bn = bc.get("bucket_name", "")
            if bn and (norm == bn or norm.startswith(bn + "/")):
                bucket_cfgs = [bc]
                actual_path = norm[len(bn):].lstrip("/")
                logger.info(
                    f"cloud_list_files: bucket prefix {bn!r} → "
                    f"actual_path={actual_path!r}"
                )
                break

    bucket_names = [bc.get("bucket_name", "?") for bc in bucket_cfgs]
    logger.info(f"cloud_list_files: user={user_id} path={path!r} buckets={bucket_names}")

    files: list = []
    multi = len(bucket_cfgs) > 1
    for bc in bucket_cfgs:
        bucket_name = bc.get("bucket_name", "")
        try:
            entries = gfs_ls(actual_path, bc)
        except GfsAccessDenied as e:
            logger.warning(f"cloud_list_files: access denied bucket={bucket_name!r}: {e}")
            continue
        if entries is None:
            logger.warning(f"cloud_list_files: gfs_ls failed for bucket={bucket_name!r}")
            continue
        for e in entries:
            name = e["name"]
            suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            display_path = f"{bucket_name}/{e['path']}" if multi and bucket_name else e["path"]
            files.append(CloudFileEntry(
                name=name,
                path=display_path,
                size=e["size"],
                suffix=suffix,
                type="directory" if e["is_dir"] else "file",
                bucket_name=bucket_name,
            ).model_dump())

    logger.info(f"cloud_list_files: returning {len(files)} entries for {user_id}")
    return _ok(files)


@router.get("/templates", response_model=dict)
async def cloud_list_templates(user_id: str = "", db=Depends(get_db)):
    """列出 GFS templates/ 目录下的模板文件。"""
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        if await ensure_gfs_provisioned(db, user_id):
            cfg = get_gfs_config(db, user_id)
    if not cfg:
        return _ok([])

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    templates: list = []
    for bc in bucket_cfgs:
        bucket_name = bc.get("bucket_name", "")
        try:
            entries = gfs_ls("templates", bc)
        except GfsAccessDenied as e:
            logger.warning(f"cloud_list_templates: access denied bucket={bucket_name!r}: {e}")
            continue
        if entries is None:
            continue
        for e in entries:
            if e["is_dir"]:
                continue
            name = e["name"]
            suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            templates.append(CloudTemplateEntry(
                name=name,
                path=e["path"],
                suffix=suffix,
            ).model_dump())
    return _ok(templates)


@router.post("/sync", response_model=dict)
async def cloud_sync(user_id: str, db=Depends(get_db)):
    """同步用户工作区到 GFS bucket（异步执行）。"""
    import asyncio
    from .gfs_utils import gfs_sync

    if not user_id:
        _err("user_id 不能为空")
    cfg = get_gfs_config(db, user_id)
    if not cfg:
        _err("未找到 GFS 配置", 404)

    # Resolve user workspace — try both DocMaster and myDrSai paths
    from drsai.configs.constant import FS_DIR
    possible_dirs = [
        Path(FS_DIR) / "workspace" / "runs" / user_id,
        Path(__file__).parents[8] / "examples" / "agent_groupchat" / "docmaster" / "workspace" / "runs" / user_id,
    ]
    local_dir = next((str(d) for d in possible_dirs if d.exists()), None)
    if not local_dir:
        return _ok({"synced": False, "reason": "workspace not found"})

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    # Sync to each bucket
    for bucket_cfg in bucket_cfgs:
        asyncio.ensure_future(
            __import__("asyncio").get_event_loop().run_in_executor(
                None, gfs_sync, local_dir, f"drsai/{user_id}/", bucket_cfg
            )
        )
    return _ok({"synced": True, "local_dir": local_dir, "buckets": [b["bucket_name"] for b in bucket_cfgs]})


@router.post("/send-to-agent", response_model=dict)
async def cloud_send_to_agent(req: SendToAgentRequest):
    """将选中文件路径发送给 Agent（TODO: 对接消息系统）。"""
    if not req.filePaths:
        _err("filePaths 不能为空")
    if not req.sessionId:
        _err("sessionId 不能为空")
    return _ok({"sent": len(req.filePaths)})


@router.post("/apply-template", response_model=dict)
async def cloud_apply_template(req: ApplyTemplateRequest, user_id: str = "", db=Depends(get_db)):
    """将模板从 GFS 拉取到工作区并返回本地路径（TODO: 注入对话）。"""
    import subprocess, tempfile
    from .gfs_utils import _jcli_bin

    if not req.templatePath:
        _err("templatePath 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, template_rel = _parse_bucket_path(req.templatePath, bucket_cfgs)

    jcli = _jcli_bin()
    if not jcli:
        ensure_jcli()
        jcli = _jcli_bin()
    if not jcli:
        _err("jcli 未安装", 500)

    tmp = tempfile.mkdtemp(prefix="gfs-template-")
    dest = f"{tmp}/{template_rel.split('/')[-1]}"
    cmd = [jcli, "-ak", bucket_cfg["access_key"], "-sk", bucket_cfg["secret_key"],
           "-endpoint", bucket_cfg["endpoint"], "-bucket", bucket_cfg["bucket_name"],
           "get", template_rel, dest]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0:
        _err(f"模板下载失败: {result.stderr.decode()}", 500)

    return _ok({"local_path": dest, "name": req.templatePath.split("/")[-1]})


@router.post("/file-url", response_model=dict)
async def cloud_get_file_url(req: FileUrlRequest, user_id: str = "", db=Depends(get_db)):
    """获取文件的 GFS 访问链接。"""
    if not req.path:
        _err("path 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)
    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, path_rel = _parse_bucket_path(req.path, bucket_cfgs)
    url = f"https://gfs.ihep.ac.cn/user/data/bucket/detail/{bucket_cfg['bucket_name']}?path={path_rel}"
    return _ok({"url": url, "bucket_name": bucket_cfg["bucket_name"]})


@router.post("/pull-to-workspace", response_model=dict)
async def cloud_pull_to_workspace(req: PullToWorkspaceRequest, db=Depends(get_db)):
    """
    将 GFS 文件下载到 DocMaster 工作区, 返回本地绝对路径。
    供右侧面板"发送给 Agent"使用。

    直接从 GFS 下载到 DocMaster 期望的 workspace/runs/<user>/ 路径下。
    """
    if not req.paths:
        _err("paths 不能为空")
    cfg = get_gfs_config(db, req.user_id) if req.user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)

    bucket_cfgs = get_gfs_bucket_configs(cfg)

    # DocMaster workspace root — files DocMaster expects to find live here
    docmaster_root = Path(__file__).parents[9] / "examples" / "agent_groupchat" / "docmaster" / "workspace" / "runs"
    user_dir = docmaster_root / (req.user_id or "default")
    user_dir.mkdir(parents=True, exist_ok=True)

    local_paths = []
    errors = []
    for remote_path in req.paths:
        bucket_cfg, rel = _parse_bucket_path(remote_path, bucket_cfgs)
        dest = user_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)

        # Download directly from GFS to the workspace
        if not gfs_get(rel, str(dest), bucket_cfg):
            errors.append({"path": remote_path, "error": "从 GFS 下载失败"})
            continue

        local_paths.append({
            "remote": remote_path,
            "local": str(dest),
            "name": dest.name,
        })

    return _ok({"files": local_paths, "errors": errors})


@router.get("/download")
async def cloud_download(
    path: str,
    background: BackgroundTasks,
    user_id: str = "",
    db=Depends(get_db),
):
    """Serve a file from GFS. Pulls latest version via jcli get before serving."""
    import mimetypes

    if not path:
        _err("path 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, path_rel = _parse_bucket_path(path, bucket_cfgs)

    name = path_rel.rstrip("/").split("/")[-1] or "file"

    import tempfile as _tempfile_mod
    _tmp_dir = _tempfile_mod.mkdtemp(prefix="gfs-dl-")
    _tmp_file = Path(_tmp_dir) / name
    ok = gfs_get(path_rel, str(_tmp_file), bucket_cfg)
    if not ok:
        logger.warning(f"[GFS download] pull failed for {path}")
        _err("文件不存在或下载失败", 404)

    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    background.add_task(_cleanup_temp_dir, _tmp_dir)
    return FileResponse(str(_tmp_file), media_type=mime, filename=name, headers=headers)


def _cleanup_temp_dir(tmp_dir: str) -> None:
    """Delete a temp directory tree (best-effort, no error on failure)."""
    import time as _time_mod
    _time_mod.sleep(5)  # let FileResponse finish streaming
    try:
        import shutil as _shutil_mod
        _shutil_mod.rmtree(tmp_dir, ignore_errors=True)
    except Exception:
        pass


def _sanitize_gfs_filename(name: str) -> str:
    """Normalize a filename for safe storage on GFS.

    jcli silently mis-handles some non-ASCII whitespace chars in S3 keys
    (notably U+00A0 NBSP) — `jcli get` reports success but writes no bytes.
    Word/PDF exports of Chinese docs frequently embed NBSP around punctuation,
    so we collapse every whitespace-class character (ASCII space, NBSP, ZWSP,
    ideographic space, tabs, etc.) into an underscore at upload time, and
    strip the BOM/zero-width-joiner runs that jcli also chokes on.

    Returns the cleaned filename. Empty result falls back to 'file'.
    """
    import re
    import unicodedata

    # Drop zero-width / formatting chars entirely
    cleaned = "".join(ch for ch in name if unicodedata.category(ch) not in ("Cf", "Cc"))
    # Collapse every Unicode whitespace run → single underscore
    cleaned = re.sub(r"\s+", "_", cleaned, flags=re.UNICODE)
    # Strip leading/trailing underscores and dots that confuse path handling
    cleaned = cleaned.strip("._")
    return cleaned or "file"


@router.post("/upload", response_model=dict)
async def cloud_upload(
    files: List[UploadFile] = File(...),
    user_id: str = "",
    dest_dir: str = "",
    db=Depends(get_db),
):
    """上传文件到 GFS。"""
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)
    if not files:
        _err("没有文件")

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, bucket_rel = _parse_bucket_path(dest_dir, bucket_cfgs)
    bucket_name = bucket_cfg.get("bucket_name", "")

    prefix = bucket_rel.strip("/")
    if prefix:
        prefix += "/"

    uploaded = []
    errors = []
    for f in files:
        if not f.filename:
            continue
        original_name = f.filename
        safe_name = _sanitize_gfs_filename(original_name)
        if safe_name != original_name:
            logger.info(f"GFS upload sanitized filename: {original_name!r} -> {safe_name!r}")
        remote_path = f"{prefix}{safe_name}"

        import tempfile
        tmp = None
        try:
            tmp = tempfile.NamedTemporaryFile(delete=False)
            while True:
                chunk = await f.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
            tmp.close()
            ok = gfs_put(tmp.name, remote_path, bucket_cfg)
            if not ok:
                errors.append({"name": safe_name, "error": "上传到 GFS 失败"})
                continue
        except Exception as e:
            errors.append({"name": safe_name, "error": f"上传失败: {str(e)[:200]}"})
            continue
        finally:
            if tmp:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

        uploaded.append({
            "name": safe_name,
            "remote_path": remote_path,
            "bucket_name": bucket_name,
            "original_name": original_name,
        })

    return _ok({"uploaded": uploaded, "errors": errors})




@router.post("/folder", response_model=dict)
async def cloud_create_folder(req: CreateFolderRequest, user_id: str = "", db=Depends(get_db)):
    """创建文件夹。parentPath: 父目录路径, name: 文件夹名"""
    parent_raw = req.parentPath.strip("/")
    name = req.name.strip()
    if not name:
        _err("name 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)
    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, parent_rel = _parse_bucket_path(parent_raw, bucket_cfgs)
    bucket_name = bucket_cfg.get("bucket_name", "")
    folder_path = f"{parent_rel}/{name}" if parent_rel else name
    # S3-compatible: create a zero-byte placeholder with trailing /
    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False)
    tmp.close()
    try:
        gfs_put(tmp.name, folder_path + "/", bucket_cfg)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    return _ok({"created": folder_path, "bucket_name": bucket_name})

@router.post("/rename", response_model=dict)
async def cloud_rename(req: RenameRequest, user_id: str = "", db=Depends(get_db)):
    """重命名文件/目录。oldPath: 原路径, newName: 新文件名"""
    old = req.oldPath
    new_name = req.newName.strip()
    if not old or not new_name:
        _err("oldPath 和 newName 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)
    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, old_rel = _parse_bucket_path(old, bucket_cfgs)
    bucket_name = bucket_cfg.get("bucket_name", "")
    # Compute new path: replace last component
    parts = old_rel.rsplit("/", 1)
    new_path = f"{parts[0]}/{new_name}" if len(parts) > 1 else new_name
    ok = gfs_mv(old_rel, new_path, bucket_cfg)
    if not ok:
        _err("重命名失败", 500)
    return _ok({"renamed": new_name, "to": new_path, "bucket_name": bucket_name})

@router.post("/move", response_model=dict)
async def cloud_move(req: MoveRequest, user_id: str = "", db=Depends(get_db)):
    """
    移动/重命名 GFS 文件或目录。
    sourcePath: 源路径 (如 outputs/foo.txt)
    targetDir:  目标目录 (如 "/" 或 some/folder)
    """
    source = req.sourcePath
    target = req.targetDir.strip("/")
    if not source:
        _err("sourcePath 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)
    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, source_rel = _parse_bucket_path(source, bucket_cfgs)
    bucket_name = bucket_cfg.get("bucket_name", "")

    # For target dir, also parse bucket prefix if present
    _, target_rel = _parse_bucket_path(target, bucket_cfgs)
    name = source_rel.rsplit("/", 1)[-1]
    dest = f"{target_rel}/{name}" if target_rel else name

    ok = gfs_mv(source_rel, dest, bucket_cfg)
    if not ok:
        _err("移动失败", 500)

    return _ok({"moved": True, "renamed": name, "to": dest, "bucket_name": bucket_name})

@router.delete("/files", response_model=dict)
async def cloud_delete(
    path: str,
    user_id: str = "",
    recursive: bool = False,
    db=Depends(get_db),
):
    """
    删除 GFS 文件/目录。

    Side-effect: if the deleted path is inside the template library
    (`模板库/<id>/...`), the corresponding catalog entry is also removed so
    the 模板库 panel doesn't keep showing a ghost card for a file that no
    longer exists.
    """
    if not path:
        _err("path 不能为空")
    cfg = get_gfs_config(db, user_id) if user_id else None
    if not cfg:
        _err("未找到 GFS 配置", 404)

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    bucket_cfg, path_rel = _parse_bucket_path(path, bucket_cfgs)
    bucket_name = bucket_cfg.get("bucket_name", "")

    ok = gfs_rm(path_rel, bucket_cfg, recursive)
    if not ok:
        logger.warning(f"gfs_rm failed for {bucket_name}/{path_rel}")

    # Reconcile the template catalog. If the deleted path lives under
    # 模板库/<template_id>/, drop that template from the user's catalog.yaml
    # so the right-panel listing matches reality. Best-effort — a failure
    # here shouldn't block the file delete from succeeding.
    try:
        norm = path.lstrip("/").rstrip("/")
        parts = norm.split("/")
        if len(parts) >= 2 and parts[0] == "模板库":
            template_id = parts[1]
            # Skip the special "catalog.yaml" key — it isn't a template dir
            if template_id and template_id != "catalog.yaml":
                _drop_template_from_catalog(user_id, template_id)
    except Exception as exc:
        logger.warning(f"template catalog reconcile failed for {user_id}/{path}: {exc}")

    return _ok({"deleted": path})


def _drop_template_from_catalog(user_id: str, template_id: str) -> None:
    """Remove `template_id` from the user's GFS template catalog. No-op if
    the user doesn't have GFS-backed templates or the entry isn't present."""
    # Lazy import — TemplateLibrarySkill lives in the DocMaster repo, only
    # reachable via the same file-load path the /docmaster/templates routes use.
    from .docmaster import _load_template_library_skill, _resolve_docmaster_dir
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        return
    workspace_dir = str(docmaster_dir / "workspace")
    skill = cls(workspace_dir=workspace_dir, user_id=user_id)
    # If the entry is in the catalog this will drop it (and clean up any
    # remaining GFS objects under 模板库/<id>/). If it's not there, the
    # skill returns success=False with a "not found" message — fine to ignore.
    result = skill.delete(template_id=template_id, user_id=user_id)
    if result.get("success"):
        logger.info(f"template catalog reconciled: removed {template_id} for {user_id}")
