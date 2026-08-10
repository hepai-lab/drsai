"""Skill share routes — time-limited, optionally password-protected share links.

Owner endpoints (mounted under /skills):
  POST   /skills/{slug}/share          — create a share link
  DELETE /skills/{slug}/share/{id}      — revoke a share link
  GET    /skills/{slug}/shares          — list active shares for a skill

Public endpoints (no auth required):
  GET    /skills/share/{share_id}             — get skill meta (name, description, …)
  POST   /skills/share/{share_id}/verify      — verify password, return download token
  GET    /skills/share/{share_id}/download    — download skill ZIP (requires token)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ...datamodel.db import SkillShare, UserSkillMeta
from ..config import settings
from .gfs_utils import gfs_get
from .skills_gfs import (
    _get_db,
    _gfs_zip_path,
    _require_gfs,
    _require_user_id,
    _SLUG_RE,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ── HMAC secret for download tokens ──────────────────────────────────────────

def _token_secret() -> bytes:
    raw = os.getenv("DRSAI_UI_SHARE_SECRET") or settings.GFS_SKILLS_SK or "drsai-share-secret"
    return raw.encode("utf-8")


def _make_download_token(share_id: str, valid_seconds: int = 3600) -> str:
    expiry = int(time.time()) + valid_seconds
    payload = f"{share_id}:{expiry}"
    sig = hmac.new(_token_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_download_token(token: str, share_id: str) -> bool:
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return False
        tok_share_id, expiry_str, sig = parts
        if tok_share_id != share_id:
            return False
        expiry = int(expiry_str)
        if time.time() > expiry:
            return False
        payload = f"{share_id}:{expiry}"
        expected = hmac.new(_token_secret(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected)
    except (ValueError, TypeError):
        return False


# ── Password hashing (sha256, consistent with existing codebase) ─────────────

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(_hash_password(password), password_hash)


# ═══════════════════════════════════════════════════════════════════════════════
# Owner endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/{slug}/share")
async def create_share(
    slug: str,
    user_id: str = Query(...),
    password: str | None = Form(None),
    expires_in_hours: int = Form(24),
) -> dict:
    """Create a share link for a private skill. ?user_id=xxx"""
    user_id = _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    db_mgr = await _get_db()

    # Verify ownership
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")

    if expires_in_hours < 1 or expires_in_hours > 8760:  # max 1 year
        raise HTTPException(status_code=400, detail="expires_in_hours must be between 1 and 8760")

    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
    password_hash = _hash_password(password) if password and password.strip() else None

    share = SkillShare(
        skill_slug=slug,
        owner_user_id=user_id,
        password_hash=password_hash,
        expires_at=expires_at,
    )
    db_mgr.upsert(share)

    return {
        "status": True,
        "message": "Share link created",
        "data": {
            "share_id": share.share_id,
            "skill_slug": slug,
            "has_password": password_hash is not None,
            "expires_at": expires_at.isoformat(),
            "created_at": share.created_at.isoformat() if share.created_at else "",
        },
    }


@router.delete("/{slug}/share/{share_id}")
async def revoke_share(
    slug: str,
    share_id: str,
    user_id: str = Query(...),
) -> dict:
    """Revoke a share link. ?user_id=xxx"""
    user_id = _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillShare, filters={"share_id": share_id, "skill_slug": slug, "owner_user_id": user_id})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Share not found")

    for row in resp.data:
        db_mgr.delete(SkillShare, filters={"id": row.id})

    return {"status": True, "message": "Share revoked", "data": {"share_id": share_id}}


@router.get("/{slug}/shares")
async def list_shares(
    slug: str,
    user_id: str = Query(...),
) -> dict:
    """List active shares for a skill. ?user_id=xxx"""
    user_id = _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillShare, filters={"skill_slug": slug, "owner_user_id": user_id}, order="desc")

    now = datetime.utcnow()
    items: list[dict] = []
    if resp.status and resp.data:
        for row in resp.data:
            expired = row.expires_at < now
            items.append({
                "share_id": row.share_id,
                "has_password": row.password_hash is not None,
                "expires_at": row.expires_at.isoformat() if row.expires_at else "",
                "expired": expired,
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "access_count": row.access_count or 0,
            })

    return {"status": True, "data": items}


# ═══════════════════════════════════════════════════════════════════════════════
# Public endpoints (no auth required)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/share/{share_id}")
async def get_shared_skill_meta(share_id: str) -> dict:
    """Public: get skill metadata from a share link. No auth required."""
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillShare, filters={"share_id": share_id})

    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Share link not found")

    share: SkillShare = resp.data[0]

    # Check expiry
    if share.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link has expired")

    # Get skill metadata from UserSkillMeta
    skill_resp = db_mgr.get(
        UserSkillMeta,
        filters={"user_id": share.owner_user_id, "slug": share.skill_slug},
    )
    if not skill_resp.status or not skill_resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")

    skill = skill_resp.data[0]
    return {
        "status": True,
        "data": {
            "share_id": share.share_id,
            "has_password": share.password_hash is not None,
            "expires_at": share.expires_at.isoformat(),
            "skill": {
                "slug": skill.slug,
                "name": skill.name or skill.slug,
                "description": getattr(skill, "description", "") or "",
                "icon": getattr(skill, "icon", "package") or "package",
                "version": getattr(skill, "version", "0.0.0") or "0.0.0",
                "owner": getattr(skill, "owner", "") or "",
                "profile": getattr(skill, "profile", "") or "",
                "changelog": getattr(skill, "changelog", "") or "",
            },
        },
    }


@router.post("/share/{share_id}/verify")
async def verify_share_password(
    share_id: str,
    password: str = Form(""),
) -> dict:
    """Public: verify share password and return a download token."""
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillShare, filters={"share_id": share_id})

    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Share link not found")

    share: SkillShare = resp.data[0]

    if share.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link has expired")

    if not share.password_hash:
        # No password set — just return a token directly
        token = _make_download_token(share_id)
        return {"status": True, "data": {"token": token}}

    if not _verify_password(password, share.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")

    token = _make_download_token(share_id)
    return {"status": True, "data": {"token": token}}


@router.get("/share/{share_id}/download")
async def download_shared_skill(
    share_id: str,
    background_tasks: BackgroundTasks,
    token: str = Query(...),
) -> FileResponse:
    """Public: download the shared skill ZIP. Requires a valid download token."""
    if not _verify_download_token(token, share_id):
        raise HTTPException(status_code=403, detail="Invalid or expired download token")

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillShare, filters={"share_id": share_id})

    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Share link not found")

    share: SkillShare = resp.data[0]

    if share.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link has expired")

    # Increment access count
    share.access_count = (share.access_count or 0) + 1
    db_mgr.upsert(share)

    # Download from GFS
    cfg = _require_gfs()
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    ok = False
    for src in ("created", "imported"):
        remote = _gfs_zip_path("user", share.skill_slug, share.owner_user_id, src)
        if gfs_get(remote, tmp_zip.name, cfg, timeout=30):
            ok = True
            break

    if not ok:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        raise HTTPException(status_code=404, detail="Skill file not found")

    def _cleanup() -> None:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass

    background_tasks.add_task(_cleanup)
    return FileResponse(
        tmp_zip.name,
        filename=f"{share.skill_slug}.zip",
        media_type="application/zip",
        background=background_tasks,
    )