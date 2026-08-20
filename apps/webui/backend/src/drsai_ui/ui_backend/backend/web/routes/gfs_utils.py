"""
GFS utility functions — jcli wrapper used by cloud.py and files.py.

All functions are fire-and-forget safe: they log failures but never raise,
so a GFS error never breaks a user's conversation or upload.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Dict

def _gfs_log(logger: logging.Logger, level: str, step: str, user_id: str = "", **fields):
    """Emit a single-line JSON log entry for GFS connection steps.
    Always includes 'gfs_step' so logs can be grepped/filtered easily."""
    record = {"gfs_step": step}
    if user_id:
        record["user_id"] = user_id
    record.update(fields)
    msg = json.dumps(record, ensure_ascii=False)
    getattr(logger, level)(msg)

logger = logging.getLogger(__name__)

# ── jcli setup ───────────────────────────────────────────────────────────────

def _jcli_bin() -> Optional[str]:
    """Return path to jcli binary, or None if not found."""
    home_bin = Path.home() / "bin" / "jcli"
    if home_bin.exists():
        return str(home_bin)
    found = shutil.which("jcli")
    return found


def ensure_jcli() -> bool:
    """
    Download jcli to ~/bin/jcli if not already present.
    Returns True if jcli is available after this call.
    """
    if _jcli_bin():
        return True
    bin_dir = Path.home() / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    dest = bin_dir / "jcli"
    url = "https://file-ocloud.ihep.ac.cn/jcli/amd64/jcli"
    try:
        result = subprocess.run(
            ["wget", "-q", url, "-O", str(dest)],
            timeout=30,
            capture_output=True,
        )
        if result.returncode == 0:
            dest.chmod(0o755)
            logger.info(f"jcli installed to {dest}")
            return True
        logger.error(f"jcli download failed: {result.stderr.decode()}")
        return False
    except Exception as e:
        logger.error(f"jcli install error: {e}")
        return False


# ── credential helpers ────────────────────────────────────────────────────────

def gfs_config_from_env() -> Optional[Dict[str, str]]:
    """Read GFS credentials from environment variables (dev/test mode)."""
    ak = os.getenv("GFS_AK")
    sk = os.getenv("GFS_SK")
    bucket = os.getenv("GFS_BUCKET")
    endpoint = os.getenv("GFS_ENDPOINT", "https://fgws3-gfs.ihep.ac.cn")
    if ak and sk and bucket:
        return {"access_key": ak, "secret_key": sk, "bucket_name": bucket, "endpoint": endpoint}
    return None


def _upgrade_gfs_config(cfg: dict, user_id: str = "") -> dict:
    """Auto-upgrade old single-bucket config format to new multi-bucket format.
    Old: {bucket_name, access_key, secret_key, endpoint, gfs_user_id, ...}
    New: {gfs_user_id, endpoint, buckets: [{bucket_name, access_key, secret_key}, ...]}"""
    if "buckets" in cfg and isinstance(cfg["buckets"], list):
        # Validate: every item must be a dict with bucket_name/access_key/secret_key
        valid = all(
            isinstance(b, dict) and b.get("bucket_name") and b.get("access_key") and b.get("secret_key")
            for b in cfg["buckets"]
        )
        if valid:
            return cfg
        # Intermediate format: buckets is a list of strings (bucket names only).
        # Upgrade using the AK/SK from top-level fields or env, shared across all buckets.
        if all(isinstance(b, str) for b in cfg["buckets"]):
            ak = cfg.get("access_key") or os.getenv("GFS_AK", "")
            sk = cfg.get("secret_key") or os.getenv("GFS_SK", "")
            if ak and sk:
                logger.info(
                    f"Upgrading string-based buckets list to multi-bucket format for user={user_id}: "
                    f"{cfg['buckets']}"
                )
                return {
                    "gfs_user_id": cfg.get("gfs_user_id", user_id),
                    "endpoint": cfg.get("endpoint", "https://fgws3-gfs.ihep.ac.cn"),
                    "provisioned_at": cfg.get("provisioned_at"),
                    "buckets": [
                        {"bucket_name": b, "access_key": ak, "secret_key": sk}
                        for b in cfg["buckets"]
                    ],
                }
        # Malformed buckets list (neither dicts nor all-strings) — drop it
        logger.warning(f"Dropping malformed buckets list for user={user_id}: {cfg['buckets']!r}")
        cfg = {k: v for k, v in cfg.items() if k != "buckets"}
    if cfg.get("access_key") and cfg.get("secret_key") and cfg.get("bucket_name"):
        logger.info(f"Upgrading old-style gfs_config to multi-bucket format for user={user_id}")
        return {
            "gfs_user_id": cfg.get("gfs_user_id", user_id),
            "endpoint": cfg.get("endpoint", "https://fgws3-gfs.ihep.ac.cn"),
            "provisioned_at": cfg.get("provisioned_at"),
            "buckets": [{
                "bucket_name": cfg["bucket_name"],
                "access_key": cfg["access_key"],
                "secret_key": cfg["secret_key"],
            }],
        }
    return cfg


def gfs_config_from_userfiles(db_manager, user_id: str) -> Optional[dict]:
    """Read GFS credentials stored in UserFiles.files['gfs_config'] for a user.
    Returns multi-bucket format with auto-upgrade for old single-bucket configs."""
    try:
        from ...datamodel.db import UserFiles
        response = db_manager.get(UserFiles, filters={"user_id": user_id}, return_json=False)
        if not response.status or not response.data:
            logger.info(f"gfs_config_from_userfiles: no UserFiles row for {user_id}")
            return None
        userfiles = response.data[0]
        if not userfiles.files:
            logger.info(f"gfs_config_from_userfiles: UserFiles.files is empty for {user_id}")
            return None
        cfg = userfiles.files.get("gfs_config")
        if not isinstance(cfg, dict):
            logger.info(f"gfs_config_from_userfiles: gfs_config is not a dict for {user_id}: {type(cfg)}")
            return None
        logger.info(
            f"gfs_config_from_userfiles: raw config for {user_id} keys={list(cfg.keys())} "
            f"has_buckets={'buckets' in cfg} bucket_count={len(cfg.get('buckets', [])) if isinstance(cfg.get('buckets'), list) else 'N/A'}"
        )
        cfg = _upgrade_gfs_config(cfg, user_id)
        bucket_count = len(cfg.get("buckets", [])) if isinstance(cfg.get("buckets"), list) else 0
        logger.info(f"gfs_config_from_userfiles: upgraded config for {user_id} buckets={bucket_count}")
        if "buckets" in cfg and isinstance(cfg["buckets"], list) and len(cfg["buckets"]) > 0:
            return cfg
        logger.warning(f"gfs_config_from_userfiles: no valid buckets after upgrade for {user_id}")
        return None
    except Exception as e:
        logger.error(f"gfs_config_from_userfiles error: {e}")
        return None


def get_gfs_config(db_manager, user_id: str) -> Optional[dict]:
    """
    Resolve GFS config for a user in multi-bucket format.
    Returns {gfs_user_id, endpoint, buckets: [{bucket_name, access_key, secret_key}, ...]}
    Old single-bucket configs are auto-upgraded on read.
    """
    if os.getenv("GFS_ENABLED", "").lower() not in ("1", "true", "yes"):
        return None
    if not user_id:
        return None
    return gfs_config_from_userfiles(db_manager, user_id)


def get_gfs_bucket_configs(cfg: dict) -> list:
    """Extract per-bucket config dicts from a gfs_config (multi or old format).
    Each returned dict has {bucket_name, access_key, secret_key, endpoint}
    — the exact shape expected by _run_jcli and jcli helpers."""
    logger.info(f"get_gfs_bucket_configs: input keys={list(cfg.keys())} has_buckets={'buckets' in cfg}")
    endpoint = cfg.get("endpoint", "https://fgws3-gfs.ihep.ac.cn")
    if "buckets" in cfg and isinstance(cfg["buckets"], list):
        result = []
        for b in cfg["buckets"]:
            if not isinstance(b, dict):
                logger.warning(f"Skipping non-dict bucket entry: {b!r}")
                continue
            if not (b.get("bucket_name") and b.get("access_key") and b.get("secret_key")):
                logger.warning(f"Skipping incomplete bucket entry: {b!r}")
                continue
            result.append({
                "bucket_name": b["bucket_name"],
                "access_key": b["access_key"],
                "secret_key": b["secret_key"],
                "endpoint": endpoint,
            })
        logger.info(f"get_gfs_bucket_configs: extracted {len(result)} bucket config(s): {[r['bucket_name'] for r in result]}")
        return result
    # Fallback: old single-bucket format (should not happen after upgrade, but be safe)
    if cfg.get("bucket_name"):
        return [{"bucket_name": cfg["bucket_name"],
                 "access_key": cfg.get("access_key", ""),
                 "secret_key": cfg.get("secret_key", ""),
                 "endpoint": endpoint}]
    return []


def _cred_is_active(cred: dict) -> bool:
    """A credential is usable if its status is 'active' or unset.
    Some older entries in GFS lack the field entirely; treat those as active."""
    status = cred.get("status")
    return status in (None, "", "active")


def _cred_actions(cred: dict) -> list:
    """Flatten every Actions list across a credential's resources entries.
    Both casings (`Actions` / `actions`) appear in the wild."""
    actions: list = []
    for r in cred.get("resources") or []:
        actions.extend(r.get("Actions") or r.get("actions") or [])
    return actions


def _cred_is_writable(cred: dict) -> bool:
    """True if a credential is explicitly RW or has empty resources (full
    permissions in GFS practice). Read-only creds are explicit: actions is
    non-empty and lacks 'Write'."""
    actions = _cred_actions(cred)
    if not actions:
        return True
    return "Write" in actions


def pick_aksk_bucket_pair(credentials: list, buckets: list, user_id: str) -> tuple:
    """
    Pick a matched (access_key, secret_key, bucket_name) triple from a user's
    GFS credentials and buckets.

    GFS exposes two credential shapes:

    * **Full-access** — `resources` is missing or empty. The cred is valid
      against every bucket the user owns; caller chooses the bucket. The
      OpenAPI returns this when an admin-minted key has no scoping clause
      (the common case for `POST /credentials` results too).
    * **Scoped** — `resources[].Bucket` (or `Path: "/buckets/<name>"`) names
      the specific bucket the cred is authorized for. Using a scoped AK
      against a different bucket triggers `服务端拒绝` (real case: juzy's
      AK[0] is for xiandaodata but DB stored it paired with juziying).

    Selection priority:
      1. Full-access cred + bucket whose short_name matches the email
         local-part (the default-bucket convention: user `teama` → bucket
         `20001-teama`).
      2. Scoped cred whose resources match a bucket whose short_name matches
         the email local-part.
      3. Scoped cred matching any bucket in API order.
      4. Full-access cred + buckets[0] (caller has no signal, take the first).
      5. Fallback: first writable usable cred + buckets[0] — best-effort.

    Filtering: inactive credentials are dropped up front, and writable creds
    are preferred over read-only ones (some accounts carry both an old RO key
    and a new RW key — picking the RO one breaks every upload).

    Returns (access_key, secret_key, bucket_name) or (None, None, None) if
    inputs are empty or no usable credential exists.
    """
    if not credentials or not buckets:
        return (None, None, None)

    usable = [c for c in credentials if _cred_is_active(c) and c.get("access_key") and c.get("secret_key")]
    if not usable:
        logger.warning(
            f"GFS pair selection: no active credential among {len(credentials)} for {user_id}"
        )
        return (None, None, None)

    # Partition usable creds by scope.
    full_access = [c for c in usable if not (c.get("resources") or [])]
    full_access_writable = [c for c in full_access if _cred_is_writable(c)]
    pref_full_access = full_access_writable or full_access

    # Build bucket_name -> best scoped credential, preferring writable.
    # NB: the PDF docs say `Bucket` + `Path: "/buckets/X"`, but the live API
    # returns just `Path` containing the bare bucket name (e.g. "20192-juziying").
    # Read both for forward-compat: prefer `Bucket` if present, else strip the
    # /buckets/ prefix from `Path`.
    bucket_to_cred: dict = {}
    for cred in usable:
        for r in cred.get("resources") or []:
            bname = r.get("Bucket")
            if not bname:
                path = r.get("Path", "")
                bname = path.split("/buckets/", 1)[-1] if "/buckets/" in path else path
            if not bname:
                continue
            existing = bucket_to_cred.get(bname)
            if existing is None or (not _cred_is_writable(existing) and _cred_is_writable(cred)):
                bucket_to_cred[bname] = cred

    local_part = user_id.split("@", 1)[0].lower() if "@" in user_id else user_id.lower()

    # 1. Full-access cred + short-name-matching bucket
    if pref_full_access:
        for b in buckets:
            if b.get("short_name", "").lower() == local_part:
                cred = pref_full_access[0]
                return (cred.get("access_key"), cred.get("secret_key"), b.get("bucket_name"))

    # 2. Scoped cred matching short-name-matching bucket
    for b in buckets:
        if b.get("short_name", "").lower() == local_part:
            bname = b.get("bucket_name")
            if bname in bucket_to_cred:
                cred = bucket_to_cred[bname]
                return (cred.get("access_key"), cred.get("secret_key"), bname)

    # 3. Scoped cred matching any bucket in API order
    for b in buckets:
        bname = b.get("bucket_name")
        if bname in bucket_to_cred:
            cred = bucket_to_cred[bname]
            return (cred.get("access_key"), cred.get("secret_key"), bname)

    # 4. Full-access cred + buckets[0] (no short-name signal — first bucket)
    if pref_full_access:
        cred = pref_full_access[0]
        return (cred.get("access_key"), cred.get("secret_key"), buckets[0].get("bucket_name"))

    # 5. Fallback — no scoped cred matched, no full-access cred either.
    # Last resort: any writable usable cred + buckets[0].
    fallback = next((c for c in usable if _cred_is_writable(c)), usable[0])
    logger.warning(
        f"GFS pair selection: no credential resources matched any bucket for {user_id}; "
        f"falling back to first usable cred + buckets[0]"
    )
    return (fallback.get("access_key"), fallback.get("secret_key"), buckets[0].get("bucket_name"))


def pick_all_bucket_pairs(credentials: list, buckets: list, user_id: str) -> list:
    """
    Like pick_aksk_bucket_pair but returns ALL valid (bucket_name, access_key,
    secret_key) pairs — one per bucket. Uses the same 5-tier priority per bucket.

    Returns list of {bucket_name, access_key, secret_key} dicts.
    """
    if not credentials or not buckets:
        return []

    usable = [c for c in credentials if _cred_is_active(c) and c.get("access_key") and c.get("secret_key")]
    if not usable:
        logger.warning(f"GFS all-pairs selection: no active credential among {len(credentials)} for {user_id}")
        return []

    full_access = [c for c in usable if not (c.get("resources") or [])]
    full_access_writable = [c for c in full_access if _cred_is_writable(c)]
    pref_full_access = full_access_writable or full_access

    # Build bucket_name -> best scoped credential
    bucket_to_cred: dict = {}
    for cred in usable:
        for r in cred.get("resources") or []:
            bname = r.get("Bucket")
            if not bname:
                path = r.get("Path", "")
                bname = path.split("/buckets/", 1)[-1] if "/buckets/" in path else path
            if not bname:
                continue
            existing = bucket_to_cred.get(bname)
            if existing is None or (not _cred_is_writable(existing) and _cred_is_writable(cred)):
                bucket_to_cred[bname] = cred

    result = []
    for b in buckets:
        bname = b.get("bucket_name")
        if not bname:
            continue
        # Scoped cred matching this bucket
        if bname in bucket_to_cred:
            cred = bucket_to_cred[bname]
            result.append({"bucket_name": bname, "access_key": cred["access_key"], "secret_key": cred["secret_key"]})
            continue
        # Full-access cred
        if pref_full_access:
            cred = pref_full_access[0]
            result.append({"bucket_name": bname, "access_key": cred["access_key"], "secret_key": cred["secret_key"]})
            continue
        # Fallback
        fallback = next((c for c in usable if _cred_is_writable(c)), usable[0] if usable else None)
        if fallback:
            result.append({"bucket_name": bname, "access_key": fallback["access_key"], "secret_key": fallback["secret_key"]})

    logger.info(f"GFS all-pairs: matched {len(result)}/{len(buckets)} buckets for {user_id}")
    return result


async def _fetch_gfs_pairs_from_openapi(user_id: str) -> tuple:
    """Query GFS OpenAPI for the user's current credential→bucket pairs.

    Shared by ensure_gfs_provisioned (initial setup) and refresh_gfs_config
    (periodic re-check). Returns (pairs: list, endpoint: str) on success,
    or (None, None) on any failure. Pairs are [{bucket_name, access_key,
    secret_key}, ...] — the same shape stored in gfs_config.buckets.

    Never raises. Logs every step via _gfs_log for diagnostics."""
    import httpx

    gfs_api_key = os.getenv("GFS_API_KEY") or os.getenv("GFS_OPENAPI_KEY")
    if not gfs_api_key:
        _gfs_log(logger, "warning", "fetch_pairs_skipped", user_id,
                 reason="no GFS_API_KEY set")
        return (None, None)

    endpoint = os.getenv("GFS_ENDPOINT", "https://fgws3-gfs.ihep.ac.cn")
    gfs_openapi_url = os.getenv("GFS_OPENAPI_URL", "http://gfs.ihep.ac.cn:7800")
    headers = {"Content-Type": "application/json", "X-API-Key": gfs_api_key}
    credentials = []
    buckets = []

    def _extract_items(body: dict, ctx: str) -> Optional[list]:
        if not isinstance(body, dict):
            return None
        inner_code = body.get("code")
        if inner_code not in (200, "200"):
            _gfs_log(logger, "warning", f"fetch_{ctx}_inner_error", user_id,
                     inner_code=inner_code, message=body.get("message"))
            return None
        data = body.get("data")
        if not isinstance(data, dict):
            return []
        items = data.get("items")
        return items if isinstance(items, list) else []

    async def _list_credentials(client) -> Optional[list]:
        url = f"{gfs_openapi_url}/v1/users/{user_id}/credentials"
        _gfs_log(logger, "info", "fetch_list_credentials", user_id, url=url)
        try:
            resp = await client.get(url, headers=headers)
        except httpx.HTTPError as e:
            _gfs_log(logger, "error", "fetch_credentials_http_error", user_id, error=str(e))
            return None
        _gfs_log(logger, "info", "fetch_credentials_response", user_id,
                 status=resp.status_code)
        if resp.status_code == 404:
            _gfs_log(logger, "warning", "fetch_credentials_not_found", user_id,
                     reason="user not found in GFS system (404)")
            return None
        if resp.status_code != 200:
            _gfs_log(logger, "warning", "fetch_credentials_failed", user_id,
                     status=resp.status_code, body=resp.text[:300])
            return None
        body = resp.json() if resp.content else {}
        items = _extract_items(body, "credentials")
        _gfs_log(logger, "info", "fetch_credentials_count", user_id,
                 count=len(items) if items is not None else None)
        return items

    async def _mint_credential(client) -> bool:
        url = f"{gfs_openapi_url}/v1/users/{user_id}/credentials"
        _gfs_log(logger, "info", "fetch_mint_credential", user_id, url=url)
        try:
            resp = await client.post(url, headers=headers, json={"permission": "rw"})
        except httpx.HTTPError as e:
            _gfs_log(logger, "error", "fetch_mint_http_error", user_id, error=str(e))
            return False
        if resp.status_code >= 400:
            _gfs_log(logger, "warning", "fetch_mint_failed", user_id,
                     status=resp.status_code, body=resp.text[:300])
            return False
        body = resp.json() if resp.content else {}
        inner = body.get("code") if isinstance(body, dict) else None
        if inner not in (200, "200", None):
            _gfs_log(logger, "warning", "fetch_mint_inner_error", user_id, inner_code=inner)
            return False
        _gfs_log(logger, "info", "fetch_mint_success", user_id)
        return True

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            credentials = await _list_credentials(client)
            if credentials is None:
                return (None, None)

            url2 = f"{gfs_openapi_url}/v1/users/{user_id}/buckets"
            _gfs_log(logger, "info", "fetch_list_buckets", user_id, url=url2)
            try:
                resp2 = await client.get(url2, headers=headers)
                _gfs_log(logger, "info", "fetch_buckets_response", user_id,
                         status=resp2.status_code)
                if resp2.status_code == 404:
                    _gfs_log(logger, "warning", "fetch_buckets_not_found", user_id,
                             reason="no bucket found (404)")
                    return (None, None)
                if resp2.status_code != 200:
                    _gfs_log(logger, "warning", "fetch_buckets_failed", user_id,
                             status=resp2.status_code)
                    return (None, None)
                body2 = resp2.json() if resp2.content else {}
                items2 = _extract_items(body2, "buckets")
                if items2 is None:
                    return (None, None)
                buckets = items2
            except httpx.HTTPError as e:
                _gfs_log(logger, "error", "fetch_buckets_http_error", user_id, error=str(e))
                return (None, None)

            pairs = pick_all_bucket_pairs(credentials, buckets, user_id)
            _gfs_log(logger, "info", "fetch_pair_result", user_id,
                     pair_count=len(pairs), bucket_count=len(buckets))

            if not pairs and buckets:
                _gfs_log(logger, "info", "fetch_no_ak_minting", user_id,
                         reason="no usable AKSK found — minting new credential")
                if await _mint_credential(client):
                    refreshed = await _list_credentials(client)
                    if refreshed is not None:
                        credentials = refreshed
                        pairs = pick_all_bucket_pairs(credentials, buckets, user_id)
                        _gfs_log(logger, "info", "fetch_pair_after_mint", user_id,
                                 pair_count=len(pairs))

        if not pairs:
            _gfs_log(logger, "warning", "fetch_no_pairs", user_id,
                     cred_count=len(credentials), bucket_count=len(buckets))
        return (pairs, endpoint)

    except Exception as e:
        _gfs_log(logger, "error", "fetch_exception", user_id, error=str(e))
        return (None, None)


async def ensure_gfs_provisioned(db_manager, user_id: str) -> bool:
    """
    Auto-provision GFS for a user if not already done. Called from login flows.

    Returns True if user is provisioned (either already was, or just succeeded),
    False if provisioning failed or GFS is disabled. Failures are logged but
    never raise — login should succeed even if GFS setup fails.
    """
    import time

    if os.getenv("GFS_ENABLED", "").lower() not in ("1", "true", "yes"):
        _gfs_log(logger, "info", "provision_skipped", user_id,
                 reason="GFS_ENABLED not set", gfs_enabled=os.getenv("GFS_ENABLED", ""))
        return False

    if not user_id:
        return False

    # Check if already provisioned
    existing = get_gfs_config(db_manager, user_id)
    if existing:
        bucket_names = [b["bucket_name"] for b in existing.get("buckets", [])]
        _gfs_log(logger, "info", "provision_already_done", user_id,
                 buckets=bucket_names, endpoint=existing.get("endpoint"))
        return True

    _gfs_log(logger, "info", "provision_start", user_id)

    endpoint = os.getenv("GFS_ENDPOINT", "https://fgws3-gfs.ihep.ac.cn")
    gfs_api_key = os.getenv("GFS_API_KEY") or os.getenv("GFS_OPENAPI_KEY")

    # DEV shortcut: no API key → seed from env vars
    if not gfs_api_key:
        ak = os.getenv("GFS_AK", "")
        sk = os.getenv("GFS_SK", "")
        bucket_name = os.getenv("GFS_BUCKET", "")
        if not (ak and sk and bucket_name):
            _gfs_log(logger, "error", "provision_failed", user_id,
                     reason="no GFS_API_KEY and no dev env vars (GFS_AK/GFS_SK/GFS_BUCKET)")
            return False
        gfs_config = {
            "gfs_user_id": user_id,
            "endpoint": endpoint,
            "provisioned_at": int(time.time()),
            "buckets": [{
                "bucket_name": bucket_name,
                "access_key": ak,
                "secret_key": sk,
            }],
        }
        try:
            _save_gfs_config_internal(db_manager, user_id, gfs_config)
            _gfs_log(logger, "info", "provision_success", user_id,
                     mode="dev_env_vars", bucket=bucket_name, endpoint=endpoint)
            return True
        except Exception as e:
            _gfs_log(logger, "error", "provision_failed", user_id,
                     reason="db_save_error", error=str(e))
            return False

    # Production: query OpenAPI via shared helper
    pairs, endpoint = await _fetch_gfs_pairs_from_openapi(user_id)
    if pairs is None:
        _gfs_log(logger, "error", "provision_failed", user_id,
                 reason="OpenAPI query returned no pairs")
        return False

    gfs_config = {
        "gfs_user_id": user_id,
        "endpoint": endpoint,
        "provisioned_at": int(time.time()),
        "buckets": pairs,
    }
    try:
        _save_gfs_config_internal(db_manager, user_id, gfs_config)
        bucket_names = [p["bucket_name"] for p in pairs]
        _gfs_log(logger, "info", "provision_success", user_id,
                 mode="openapi", buckets=bucket_names, endpoint=endpoint)
        return True
    except Exception as e:
        _gfs_log(logger, "error", "provision_failed", user_id,
                 reason="db_save_error", error=str(e))
        return False


async def refresh_gfs_config(db_manager, user_id: str) -> Optional[dict]:
    """Re-query GFS OpenAPI and merge any newly-discovered buckets into the
    stored config. Returns the updated config or None on failure / no change.

    Merge strategy: adds new bucket→credential pairs, updates existing ones
    with current AK/SK from OpenAPI. Never removes buckets that are still in
    the stored config but missing from the current OpenAPI response (could be
    a transient API glitch — denied buckets are cleaned up by the reconcile
    path via remove_bucket_from_config).

    This is the mechanism that detects server-side resource changes (admin
    grants a new bucket to a credential, user creates a new bucket, etc.)
    without requiring a manual re-provision.

    Never raises. Callers should treat None as "keep using existing config".
    """
    import asyncio as _asyncio

    if os.getenv("GFS_ENABLED", "").lower() not in ("1", "true", "yes"):
        return None
    if not user_id:
        return None

    stored = get_gfs_config(db_manager, user_id)
    if not stored:
        # No stored config — nothing to refresh. Caller should use
        # ensure_gfs_provisioned for initial setup.
        return None

    stored_buckets = {b["bucket_name"]: b for b in stored.get("buckets", [])}
    stored_names = list(stored_buckets.keys())
    _gfs_log(logger, "info", "refresh_start", user_id,
             stored_buckets=stored_names)

    try:
        # 5-second timeout — don't block the caller on a slow OpenAPI
        pairs, endpoint = await _asyncio.wait_for(
            _fetch_gfs_pairs_from_openapi(user_id), timeout=5
        )
    except _asyncio.TimeoutError:
        _gfs_log(logger, "warning", "refresh_timeout", user_id,
                 reason="OpenAPI query timed out after 5s")
        return None
    except Exception as e:
        _gfs_log(logger, "error", "refresh_error", user_id, error=str(e))
        return None

    if pairs is None:
        _gfs_log(logger, "warning", "refresh_failed", user_id,
                 reason="OpenAPI query returned no pairs")
        return None

    server_buckets = {p["bucket_name"]: p for p in pairs}
    server_names = list(server_buckets.keys())

    added = [n for n in server_names if n not in stored_buckets]
    updated = [n for n in server_names if n in stored_buckets
               and (server_buckets[n].get("access_key") != stored_buckets[n].get("access_key")
                    or server_buckets[n].get("secret_key") != stored_buckets[n].get("secret_key"))]
    unchanged = [n for n in server_names if n in stored_buckets and n not in updated]
    stored_only = [n for n in stored_names if n not in server_buckets]

    _gfs_log(logger, "info", "refresh_diff", user_id,
             added=added, updated=updated, unchanged=unchanged,
             stored_only_missing_from_server=stored_only)

    if not added and not updated:
        _gfs_log(logger, "info", "refresh_no_change", user_id)
        return stored

    # Merge: server view wins for overlapping buckets, stored-only buckets kept
    merged = {}
    for bn, bp in stored_buckets.items():
        merged[bn] = bp
    for bn, sp in server_buckets.items():
        merged[bn] = sp  # overwrites stored with fresh server data

    new_config = {
        "gfs_user_id": user_id,
        "endpoint": endpoint,
        "provisioned_at": int(__import__("time").time()),
        "buckets": list(merged.values()),
    }
    try:
        _save_gfs_config_internal(db_manager, user_id, new_config)
        _gfs_log(logger, "info", "refresh_success", user_id,
                 added=added, updated=updated,
                 final_buckets=list(merged.keys()))
        return new_config
    except Exception as e:
        _gfs_log(logger, "error", "refresh_save_error", user_id, error=str(e))
        return None


def _save_gfs_config_internal(db_manager, user_id: str, gfs_config: dict) -> None:
    """Internal helper to save gfs_config to UserFiles. Raises on failure."""
    from ...datamodel.db import UserFiles
    response = db_manager.get(UserFiles, filters={"user_id": user_id}, return_json=False)
    if not response.status or not response.data:
        userfiles = UserFiles(user_id=user_id, files={})
    else:
        userfiles = response.data[0]
        if userfiles.files is None:
            userfiles.files = {}
    userfiles.files["gfs_config"] = gfs_config
    db_manager.upsert(userfiles)


def invalidate_gfs_config(db_manager, user_id: str) -> bool:
    """Drop a user's stale gfs_config so the next ensure_gfs_provisioned call
    re-runs the picker / mint flow from scratch. Other entries in
    UserFiles.files are preserved.

    Returns True if a config was removed, False if there was nothing to remove
    or the DB write failed. Idempotent — safe to call when no config exists."""
    from ...datamodel.db import UserFiles
    if not user_id:
        return False
    try:
        response = db_manager.get(UserFiles, filters={"user_id": user_id}, return_json=False)
        if not response.status or not response.data:
            return False
        userfiles = response.data[0]
        if not userfiles.files or "gfs_config" not in userfiles.files:
            return False
        userfiles.files.pop("gfs_config", None)
        db_manager.upsert(userfiles)
        logger.info(f"GFS config invalidated for {user_id}")
        return True
    except Exception as e:
        logger.error(f"invalidate_gfs_config failed for {user_id}: {e}")
        return False


def remove_bucket_from_config(db_manager, user_id: str, bucket_name: str) -> Optional[dict]:
    """Surgically remove a single bucket from the user's stored gfs_config.

    Unlike invalidate_gfs_config which drops everything, this only removes the
    one bucket whose AKSK→bucket pairing was denied by GFS. Other buckets in
    the config keep working. If the removed bucket was the last one, the entire
    config is invalidated (same as invalidate_gfs_config).

    Returns the updated config dict, or None if the config is now empty or the
    bucket wasn't found. Other UserFiles.files entries are preserved."""
    from ...datamodel.db import UserFiles
    if not user_id or not bucket_name:
        return None
    try:
        response = db_manager.get(UserFiles, filters={"user_id": user_id}, return_json=False)
        if not response.status or not response.data:
            return None
        userfiles = response.data[0]
        if not userfiles.files or "gfs_config" not in userfiles.files:
            return None
        cfg = userfiles.files["gfs_config"]
        if not isinstance(cfg, dict):
            return None
        cfg = _upgrade_gfs_config(cfg, user_id)
        buckets = cfg.get("buckets", [])
        if not isinstance(buckets, list):
            return None
        new_buckets = [b for b in buckets if b.get("bucket_name") != bucket_name]
        if len(new_buckets) == len(buckets):
            # Bucket not in config — nothing to do
            return cfg
        if not new_buckets:
            # Last bucket removed — invalidate entirely
            userfiles.files.pop("gfs_config", None)
            db_manager.upsert(userfiles)
            logger.info(
                f"GFS config fully invalidated for {user_id} "
                f"after removing last bucket {bucket_name}"
            )
            return None
        cfg["buckets"] = new_buckets
        userfiles.files["gfs_config"] = cfg
        db_manager.upsert(userfiles)
        logger.info(
            f"GFS config: removed bucket {bucket_name} for {user_id}, "
            f"{len(new_buckets)} remaining: {[b['bucket_name'] for b in new_buckets]}"
        )
        return cfg
    except Exception as e:
        logger.error(f"remove_bucket_from_config failed for {user_id}/{bucket_name}: {e}")
        return None


# ── jcli commands ─────────────────────────────────────────────────────────────

def _run_jcli(args: list[str], cfg: Dict[str, str], timeout: int = 60) -> bool:
    """Run a jcli command with inline credentials. Returns True on success."""
    jcli = _jcli_bin()
    if not jcli:
        if not ensure_jcli():
            logger.error("jcli not available and install failed")
            return False
        jcli = _jcli_bin()

    cmd = [
        jcli,
        "-ak", cfg["access_key"],
        "-sk", cfg["secret_key"],
        "-endpoint", cfg.get("endpoint", "https://fgws3-gfs.ihep.ac.cn"),
        "-bucket", cfg["bucket_name"],
    ] + args

    try:
        result = subprocess.run(cmd, timeout=timeout, capture_output=True, text=True)
        if result.returncode != 0:
            logger.warning(f"jcli {args[0]} failed: {result.stderr.strip()}")
            return False
        return True
    except subprocess.TimeoutExpired:
        logger.warning(f"jcli {args[0]} timed out after {timeout}s")
        return False
    except Exception as e:
        logger.error(f"jcli error: {e}")
        return False


def gfs_put(local_path: str, remote_path: str, cfg: Dict[str, str]) -> bool:
    """Upload a single file to the GFS bucket. remote_path is relative to bucket root."""
    return _run_jcli(["put", local_path, remote_path], cfg)



def gfs_mv(source: str, dest: str, cfg: Dict[str, str]) -> bool:
    """Move/rename a GFS object. Both paths are relative to bucket root."""
    return _run_jcli(["mv", source, dest], cfg)


def gfs_rm(remote_path: str, cfg: Dict[str, str], recursive: bool = False) -> bool:
    """Delete a file or directory from GFS."""
    args = ["rm"]
    if recursive:
        args.append("-r")
    args.append(remote_path)
    return _run_jcli(args, cfg, timeout=60)


def gfs_get(remote_path: str, dest: str, cfg: Dict[str, str], timeout: int = 60) -> bool:
    """Download a single file from GFS to a local path. Returns True on success."""
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(dest) + ".jcli_tmp")
    try:
        tmp.unlink(missing_ok=True)
    except Exception:
        pass
    args = ["get", remote_path, str(tmp)]
    ok = _run_jcli(args, cfg, timeout=timeout)
    if not ok or not tmp.exists() or tmp.stat().st_size == 0:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return False
    tmp.replace(dest_path)
    return True


def gfs_sync(local_dir: str, remote_dir: str, cfg: Dict[str, str]) -> bool:
    """Sync a local directory to a GFS bucket path."""
    return _run_jcli(["sync", local_dir, remote_dir], cfg, timeout=120)


def gfs_sync_pull(local_dir: str, cfg: Dict[str, str], timeout: int = 180) -> bool:
    """Sync the GFS bucket root down to a local directory using `jcli sync`.

    `jcli sync` skips unchanged files automatically and supports resumed
    transfers, so this is much cheaper than walking + N×`jcli get` when
    there are many files. Does not delete local files that are gone from
    GFS — caller handles pruning separately.
    """
    return _run_jcli(["sync", "/", local_dir], cfg, timeout=timeout)


def _strip_ansi(text: str) -> str:
    """Remove ANSI escape codes and carriage returns from a string."""
    import re
    return re.sub(r'\x1b\[[0-9;]*[mK]|\r', '', text)


def _detect_jcli_denial(text: str) -> bool:
    """True if jcli output indicates the AKSK is unauthorized for the bucket.
    These messages mean the credentials need to be re-provisioned, not just
    retried — the server has already decided this AK can't access this bucket."""
    lowered = text.lower()
    return (
        "服务端拒绝" in text
        or "access denied" in lowered
        or "accessdenied" in lowered
        or "signaturedoesnotmatch" in lowered
        or "invalidaccesskeyid" in lowered
    )


class GfsAccessDenied(Exception):
    """Raised when the GFS server rejects the stored AKSK→bucket pairing.
    Caller should invalidate the stored gfs_config and re-provision."""


def gfs_ls(remote_path: str, cfg: Dict[str, str]) -> Optional[list]:
    """
    List files under a GFS path.
    Returns list of dicts: {name, path, size, is_dir} on success, or None on
    transient failure (network, missing binary, parse error). Raises
    GfsAccessDenied when the AKSK→bucket pairing is rejected by the server.
    """
    jcli = _jcli_bin()
    if not jcli:
        if not ensure_jcli():
            return None
        jcli = _jcli_bin()

    cmd = [
        jcli,
        "-ak", cfg["access_key"],
        "-sk", cfg["secret_key"],
        "-endpoint", cfg.get("endpoint", "https://fgws3-gfs.ihep.ac.cn"),
        "-bucket", cfg["bucket_name"],
        "ls", remote_path,
    ]
    try:
        result = subprocess.run(cmd, timeout=30, capture_output=True, text=True)
        if result.returncode != 0:
            stderr = _strip_ansi(result.stderr or "")
            if _detect_jcli_denial(stderr):
                raise GfsAccessDenied(stderr.strip()[:200])
            return None

        # jcli exits 0 even on auth failure / bucket-not-found, writing an
        # error sentinel to stdout instead. Detect that explicitly so the
        # caller doesn't mistake "denied" for "empty bucket" and start
        # pruning the local mirror.
        stripped_out = _strip_ansi(result.stdout)
        if _detect_jcli_denial(stripped_out):
            logger.warning(f"jcli ls denied for bucket={cfg.get('bucket_name')}: {stripped_out.strip()[:200]}")
            raise GfsAccessDenied(stripped_out.strip()[:200])
        if "错误" in stripped_out or "no such" in stripped_out.lower():
            logger.warning(f"jcli ls reported error in body: {stripped_out.strip()[:200]}")
            return None

        import re as _re
        # NAME starts after the MODTIME column (`Mon DD HH:MM`). Anchor on the
        # HH:MM token so filenames containing whitespace (incl. multi-space
        # CJK paths like `加工  关联业务承诺书.jpg`) survive intact — `split()`
        # collapses runs of whitespace and would corrupt the name otherwise.
        _modtime_re = _re.compile(r"\s\d{2}:\d{2}\s+")

        entries = []
        for raw_line in result.stdout.splitlines():
            line = _strip_ansi(raw_line).strip()
            # Skip header, progress, empty, and total lines
            if not line or line.startswith("MODE") or line.startswith("loading") or line.startswith("total"):
                continue
            # Table columns: MODE  USER  GROUP  SIZE [UNIT]  MODTIME_DATE  MODTIME_TIME  NAME
            # SIZE may be "DIR" or "14.00 B" / "1.23 KB" (number + unit token).
            m = _modtime_re.search(line)
            if not m:
                continue
            prefix = line[:m.start()]
            name = line[m.end():]
            parts = prefix.split()
            if len(parts) < 4:
                continue
            mode = parts[0]
            is_dir = mode.startswith("d") or name.endswith("/")
            # Size column may be "DIR" or a number; unit is optional ("B"/"KB"/...).
            size_bytes = 0
            if not is_dir:
                try:
                    size_raw = parts[3]
                    unit = parts[4] if len(parts) >= 5 and parts[4] in ("B", "KB", "MB", "GB", "TB") else None
                    val = float(size_raw)
                    multiplier = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}.get(unit or "B", 1)
                    size_bytes = int(val * multiplier)
                except (ValueError, IndexError):
                    size_bytes = 0
            # Strip bucket prefix from name to get relative path
            bucket = cfg["bucket_name"]
            rel = name
            if rel.startswith(f"{bucket}/"):
                rel = rel[len(f"{bucket}/"):]
            entries.append({
                "name": rel.rstrip("/").split("/")[-1] or rel,
                "path": rel,
                "size": size_bytes,
                "is_dir": is_dir,
            })
        return entries
    except GfsAccessDenied:
        raise
    except Exception as e:
        logger.error(f"jcli ls error: {e}")
        return None


# ── async fire-and-forget ─────────────────────────────────────────────────────

async def gfs_put_async(local_path: str, remote_path: str, cfg: Dict[str, str]) -> None:
    """Non-blocking GFS upload — runs in a thread pool, never raises."""
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, gfs_put, local_path, remote_path, cfg)
    except Exception as e:
        logger.error(f"gfs_put_async error for {local_path}: {e}")


# ── skills public helpers ────────────────────────────────────────────────────

def gfs_dir_subdirs(remote_path: str, cfg: Dict[str, str]) -> list[str]:
    """List immediate subdirectories under a GFS path. Returns list of dir names."""
    entries = gfs_ls(remote_path, cfg)
    if not entries:
        return []
    return [e["name"] for e in entries if e.get("is_dir")]


def gfs_read_text(remote_path: str, cfg: Dict[str, str]) -> str | None:
    """Download a text file from GFS and return its content as a string."""
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w+b", delete=False, suffix=".gfs_read") as tmp:
        tmp_path = tmp.name
    try:
        ok = gfs_get(remote_path, tmp_path, cfg, timeout=30)
        if not ok:
            return None
        return Path(tmp_path).read_text(encoding="utf-8")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def gfs_exists(remote_path: str, cfg: Dict[str, str]) -> bool:
    """Check if a GFS path exists (file or directory)."""
    parent = str(Path(remote_path).parent) if "/" in remote_path else ""
    name = Path(remote_path).name
    entries = gfs_ls(parent, cfg)
    if not entries:
        return False
    return any(e["name"] == name or e["path"] == remote_path for e in entries)
