"""Server-side remote worker catalogue.

Ports the legacy Agent Square discovery (WebUI ``get_ddf_agents``) into the
desktop gateway so the Desktop has one origin to call and never handles the
DDF/HepAI credential:

  models = HepAI(...).agents.list()          -> GET  {root}/agents/list_agents
  per id: HRModel.connect(...).get_info()    -> POST {root}/worker/unified_gate/?model=&function=get_info
  keep only dict results (skip WorkerInfo / errors)

The connection defaults mirror ``platformConfig`` (DDF prod/dev). A deployment
may override the root with ``OPENDRSAI_DDF_API_BASE_URL`` or
``DRSAI_REMOTE_WORKER_URL``.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

from loguru import logger

DEFAULT_DDF_ROOT = "https://ddf.ihep.ac.cn/apiv2"
LIST_AGENTS_TIMEOUT_SECONDS = 12.0
INFO_TIMEOUT_SECONDS = 5.0
MAX_INFO_CONCURRENCY = 8
# The DDF agent catalog is slow (one list_agents call plus one get_info round
# trip per worker) and rarely changes. Successful "ready" results are cached
# in-process for 24 hours; ``refresh=True`` only revalidates a stale cache,
# and ``force=True`` (the explicit Refresh button) bypasses the TTL.
CATALOG_CACHE_TTL_SECONDS = 24 * 60 * 60

_catalog_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_catalog_fetch_lock = asyncio.Lock()


def _cached_catalog(root: str) -> dict[str, Any] | None:
    entry = _catalog_cache.get(root)
    if not entry:
        return None
    fetched_at, payload = entry
    if payload.get("state") != "ready":
        return None
    if time.time() - fetched_at >= CATALOG_CACHE_TTL_SECONDS:
        return None
    return {**payload, "cached": True, "cached_at": fetched_at}


def _ddf_root() -> str:
    root = (
        os.environ.get("DRSAI_REMOTE_WORKER_URL")
        or os.environ.get("OPENDRSAI_DDF_API_BASE_URL")
        or DEFAULT_DDF_ROOT
    )
    root = root.strip().rstrip("/")
    # Launchers sometimes append /v1 for OpenAI-compatible model routes; the
    # worker gates live on the /apiv2 root.
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return root


def _api_key(credential: str | None = None) -> str:
    explicit = (credential or "").strip()
    if explicit:
        return explicit
    for name in ("HEPAI_API_KEY", "OPENAI_API_KEY", "DRSAI_REMOTE_WORKER_API_KEY"):
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    # The Desktop may hold the HepAI credential as an OIDC access token
    # (platform auth) rather than an env var; e.g. an adopted dev-managed
    # gateway that was not spawned with the Desktop env.
    try:
        from drsai.platform_auth import get_platform_auth

        context = get_platform_auth()
        if context is not None and context.access_token:
            return context.access_token
    except Exception:  # noqa: BLE001 - credential discovery is best-effort
        pass
    return _auth_session_access_token()


def _auth_session_access_token() -> str:
    """Resolve the Desktop OIDC session token, refreshing it when expired.

    The Desktop login (``auth.json`` in the state root) stores an encrypted
    access/refresh token pair. Remote Worker calls made outside a request
    scope (e.g. catalog refresh) can use the persisted access token, and the
    refresh token renews it without user interaction.
    """
    try:
        from drsai.backend.auth.token_store import (
            is_token_expired,
            load_auth_session,
        )

        session = load_auth_session()
        if not session:
            return ""
        access_token = str(session.get("access_token") or "")
        if access_token and not is_token_expired(session):
            return access_token
        refresh_token = str(session.get("refresh_token") or "")
        if not refresh_token:
            return access_token
        # Expired but refreshable: exchange via the OIDC token endpoint and
        # persist the renewed session, mirroring the auth.session_refresh RPC.
        from drsai.backend.auth.oidc_client import OidcClient
        from drsai.backend.auth.token_store import save_auth_session
        from drsai.platform_upstream import resolve_hepai_oidc_issuer

        client = OidcClient(
            issuer=resolve_hepai_oidc_issuer(os.environ),
            client_id=os.environ.get("OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-tui"),
            scopes=os.environ.get(
                "OPENDRSAI_OIDC_SCOPES",
                "openid email profile roles groups hai_api offline_access",
            ),
        )
        tokens = client.refresh_access_token(refresh_token)
        new_session = save_auth_session(
            tokens=tokens,
            user_info=session.get("user") or {},
            issuer=resolve_hepai_oidc_issuer(os.environ),
            client_id=os.environ.get("OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-tui"),
        )
        return str(new_session.get("access_token") or "")
    except Exception:  # noqa: BLE001 - credential discovery is best-effort
        return ""


def normalize_worker_name(row: Any) -> str:
    if isinstance(row, str):
        return row.strip()
    if isinstance(row, dict):
        for key in ("id", "name", "worker_name", "model"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


async def _list_agent_rows(root: str, api_key: str) -> list[dict[str, Any]]:
    """Return the full DDF list_agents rows (rich agent metadata)."""
    import httpx

    async with httpx.AsyncClient(timeout=LIST_AGENTS_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{root}/agents/list_agents",
            headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        payload = response.json()

    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        rows = []
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = normalize_worker_name(row)
        if not name or name == "hepai/custom-model" or name in seen:
            continue
        seen.add(name)
        result.append({**row, "name": name})
    return result


async def _fetch_worker_info(root: str, api_key: str, worker: str) -> dict[str, Any] | None:
    import httpx

    url = f"{root}/worker/unified_gate/"
    params = {"model": worker, "function": "get_info"}
    try:
        async with httpx.AsyncClient(timeout=INFO_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                params=params,
                json={},
                headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001 - a single worker's info is best-effort
        logger.debug("remote worker get_info failed for {}: {}", worker, exc)
        return None
    if not isinstance(payload, dict):
        return None
    if _is_worker_info(payload):
        return None
    return payload


def _is_worker_info(info: dict[str, Any]) -> bool:
    has_worker_shape = any(
        key in info
        for key in ("worker_address", "model_names", "host_name", "last_heartbeat", "queue_length")
    )
    has_agent_shape = (
        isinstance(info.get("name"), str)
        and bool(str(info.get("name")).strip())
        and any(key in info for key in ("description", "author", "examples", "logo"))
    )
    return has_worker_shape and not has_agent_shape


def _parse_maybe_dict(value: str) -> object | None:
    """Parse a stringified dict like \"{'en': '...', 'zh': '...'}\" safely."""
    text = value.strip()
    if not text.startswith("{"):
        return None
    try:
        import ast

        parsed = ast.literal_eval(text)
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, SyntaxError):
        return None


def _looks_like_example_text(value: str) -> bool:
    """True when a string looks like a human example prompt, not dict residue."""
    text = value.strip()
    if not text or text.startswith("{") or text.startswith("["):
        return False
    return "': " not in text and ": '" not in text


def _coerce_description(info: dict[str, Any]) -> str | None:
    for key in ("description", "announcements"):
        value = info.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            import json

            return json.dumps(
                {k: v for k, v in value.items() if k in ("en", "zh") and isinstance(v, str)},
                ensure_ascii=False,
            )
    return None


async def list_remote_workers(
    refresh: bool = False,
    credential: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Return the remote workers this Runtime can proxy.

    ``credential`` is a request-scoped bearer token supplied by the Desktop
    (saved HepAI API key or OIDC access token). It wins over the process env
    so an adopted/restarted gateway without the key in its environment can
    still serve the catalog.

    Caching: a successful ``ready`` catalog is served from the in-process
    cache for 24 hours. ``refresh=True`` revalidates only once the cache is
    stale; ``force=True`` (explicit user Refresh) always bypasses the cache.

    Never raises for an unreachable platform: a deployment with no credential or
    an offline platform is the normal "no remote workers" state.
    """
    root = _ddf_root()
    if not force:
        cached = _cached_catalog(root)
        if cached is not None:
            return cached
    async with _catalog_fetch_lock:
        if not force:
            cached = _cached_catalog(root)
            if cached is not None:
                return cached
        payload = await _fetch_remote_worker_catalog(root, credential)
    if payload.get("state") == "ready":
        _catalog_cache[root] = (time.time(), payload)
    return payload


async def _fetch_remote_worker_catalog(
    root: str,
    credential: str | None = None,
) -> dict[str, Any]:
    api_key = _api_key(credential)
    if not api_key:
        return {
            "state": "requires_login",
            "root": root,
            "workers": [],
            "message": "Save a HepAI/DDF API key to load remote workers.",
        }
    try:
        rows = await _list_agent_rows(root, api_key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("remote worker list failed at {}: {}", root, exc)
        return {
            "state": "unavailable",
            "root": root,
            "workers": [],
            "message": "The remote worker platform is unreachable.",
        }

    workers: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("name") or "")
        info = await _fetch_worker_info(root, api_key, name)
        merged = {**row}
        if isinstance(info, dict):
            merged.update({k: v for k, v in info.items() if v not in (None, "", [], {})})

        description = merged.get("description")
        descriptor: dict[str, Any] = {"name": name, "worker": name}
        if isinstance(description, dict):
            zh = str(description.get("zh") or "").strip()
            en = str(description.get("en") or "").strip()
            if zh:
                descriptor["description_zh"] = zh
            if en:
                descriptor["description_en"] = en
            descriptor["description"] = zh or en or _coerce_description(merged)
        elif isinstance(description, str) and description.strip():
            descriptor["description"] = description.strip()
        else:
            fallback = _coerce_description(merged)
            if fallback:
                descriptor["description"] = fallback

        author = merged.get("author") or merged.get("owner")
        if isinstance(author, str) and author.strip():
            descriptor["author"] = author.strip()
            descriptor["owner"] = author.strip()
        logo = merged.get("logo")
        if isinstance(logo, str) and logo.strip():
            descriptor["logo"] = logo.strip()
        capabilities = merged.get("capabilities")
        if isinstance(capabilities, list) and capabilities:
            descriptor["capabilities"] = [str(c) for c in capabilities if str(c).strip()]
        examples = merged.get("examples")
        normalized_examples: dict[str, list[str]] = {}

        def _push_example(lang: str, value: object) -> None:
            text = str(value).strip()
            if text:
                bucket = normalized_examples.setdefault(lang, [])
                if len(bucket) < 8:
                    bucket.append(text)

        def _absorb_example_item(item: object) -> None:
            # Per-example bilingual dicts: {"en": "...", "zh": "..."} (or a
            # stringified form of it from some DDF workers).
            if isinstance(item, dict):
                for lang in ("zh", "en"):
                    value = item.get(lang)
                    if isinstance(value, str) and value.strip():
                        _push_example(lang, value)
                    elif isinstance(value, list):
                        for entry in value:
                            _push_example(lang, entry)
            elif isinstance(item, str) and item.strip().startswith("{"):
                parsed = _parse_maybe_dict(item)
                if isinstance(parsed, dict):
                    _absorb_example_item(parsed)
                elif _looks_like_example_text(item):
                    _push_example("en", item)
            elif isinstance(item, str) and _looks_like_example_text(item):
                _push_example("en", item)
            elif isinstance(item, list):
                for entry in item:
                    _absorb_example_item(entry)

        if isinstance(examples, dict):
            for lang in ("zh", "en"):
                values = examples.get(lang)
                if isinstance(values, list) and values:
                    for value in values:
                        _push_example(lang, value)
                elif isinstance(values, str) and values.strip():
                    _push_example(lang, values)
            if not normalized_examples:
                # Fallback: values may be per-example dicts or nested lists.
                for value in examples.values():
                    _absorb_example_item(value)
        elif isinstance(examples, list) and examples:
            for item in examples:
                _absorb_example_item(item)
        elif isinstance(examples, str) and examples.strip():
            parsed = _parse_maybe_dict(examples)
            if isinstance(parsed, dict):
                _absorb_example_item(parsed)
        if normalized_examples:
            descriptor["examples"] = normalized_examples
        version = merged.get("version")
        if isinstance(version, str) and version.strip():
            descriptor["version"] = version.strip()
        updated_at = merged.get("updated_at")
        if isinstance(updated_at, str) and updated_at.strip():
            descriptor["updated_at"] = updated_at.strip()
        if "available" in merged:
            descriptor["available"] = bool(merged.get("available"))
        workers.append(descriptor)

    return {
        "state": "ready",
        "root": root,
        "workers": workers,
        "message": f"Loaded {len(workers)} remote worker(s).",
    }


async def remote_worker_status(credential: str | None = None) -> dict[str, Any]:
    root = _ddf_root()
    return {
        "root": root,
        "credential_present": bool(_api_key(credential)),
        "state": "ready" if _api_key(credential) else "requires_login",
    }


__all__ = ["list_remote_workers", "remote_worker_status", "normalize_worker_name"]
