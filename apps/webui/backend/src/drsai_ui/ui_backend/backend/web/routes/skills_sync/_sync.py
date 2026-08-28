"""Unified sync engine — downloads ZIPs from external sources and persists to GFS + DB."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ._base import BaseSourceAdapter


async def sync_source(adapter: BaseSourceAdapter) -> dict:
    """Sync all skills from an external source into GFS + SkillMeta + SkillDetail.

    Returns a summary dict: {"inserted": N, "updated": N, "skipped": N, "errors": N}
    """
    from ....datamodel.db import SkillMeta, SkillDetail
    from ..skills_gfs._auth import _get_db
    from ..skills_gfs._gfs import _require_gfs, _gfs_zip_path
    from ..gfs_utils import gfs_ls

    import logging
    logger = logging.getLogger(__name__)

    summary = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0}

    logger.info("[skills_sync] Starting sync for source=%s", adapter.source)
    items = await adapter.list_skills()
    logger.info("[skills_sync] Got %d skills from source=%s", len(items), adapter.source)

    if not items:
        return summary

    cfg = _require_gfs()
    db_mgr = await _get_db()

    resp = db_mgr.get(SkillMeta, filters={"source": adapter.source})
    existing_slugs = {row.slug for row in (resp.data or [])} if resp.status else set()

    for item in items:
        slug = item.get("slug", "")
        if not slug:
            summary["errors"] += 1
            continue

        exists = slug in existing_slugs

        try:
            zip_path = _gfs_zip_path(slug, source=adapter.source)
            if not gfs_ls(zip_path, cfg):
                zip_bytes, restricted = await adapter.download_zip(slug)
                if restricted:
                    logger.warning("[skills_sync] %s restricted, slug=%s", adapter.source, slug)
                    summary["errors"] += 1
                    continue
                if zip_bytes:
                    _put_bytes_to_gfs(zip_bytes, zip_path, cfg)
                    logger.info("[skills_sync] Uploaded ZIP to GFS: %s", zip_path)

            meta = SkillMeta(
                slug=slug,
                name=item.get("name", slug),
                icon=item.get("icon", "package"),
                version=item.get("version", "1.0.0"),
                description=item.get("description", ""),
                author=item.get("author", ""),
                source=adapter.source,
                source_ref=slug,
                source_synced_at=datetime.now(timezone.utc),
                tags=item.get("tags", []),
                download_count=item.get("download_count", 0),
                visibility="public",
            )
            db_mgr.upsert(meta)

            if not exists:
                detail_data = await adapter.get_detail(slug)
                if detail_data:
                    detail = SkillDetail(
                        slug=slug,
                        description=detail_data.get("description", ""),
                        body=detail_data.get("body", ""),
                        changelog=detail_data.get("changelog", ""),
                        author_email=detail_data.get("author_email"),
                        author_id=detail_data.get("author_id"),
                        required_tools=detail_data.get("required_tools", []),
                        detail_raw=detail_data.get("detail_raw"),
                    )
                    db_mgr.upsert(detail)

                    if detail_data.get("author_email"):
                        meta_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
                        if meta_resp.status and meta_resp.data:
                            m = meta_resp.data[0]
                            m.owner_id = detail_data["author_email"]
                            db_mgr.upsert(m)

            if exists:
                summary["updated"] += 1
            else:
                summary["inserted"] += 1
            existing_slugs.add(slug)

        except Exception as exc:
            logger.error("[skills_sync] Error syncing slug=%s: %s", slug, exc)
            summary["errors"] += 1

    logger.info("[skills_sync] Done source=%s: %s", adapter.source, summary)
    return summary


async def sync_all_sources() -> dict[str, dict]:
    """Sync all registered external sources.

    Returns a dict mapping source name to its sync summary.
    """
    from ._higraf import HigrafAdapter

    adapters: list[BaseSourceAdapter] = [HigrafAdapter()]
    results: dict[str, dict] = {}

    for adapter in adapters:
        results[adapter.source] = await sync_source(adapter)

    return results


def _put_bytes_to_gfs(data: bytes, remote_path: str, cfg: dict) -> bool:
    """Write raw bytes to GFS via a temp file."""
    import os
    import tempfile
    from ..gfs_utils import gfs_put

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    try:
        with open(tmp.name, "wb") as f:
            f.write(data)
        return gfs_put(tmp.name, remote_path, cfg)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass