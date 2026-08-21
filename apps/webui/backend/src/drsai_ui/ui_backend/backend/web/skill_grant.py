"""Skill proxy helpers for remote agents.

Identity is user_id; auth is X-Skill-Proxy-Token (DRSAI_SKILL_PROXY_TOKEN).
"""

from __future__ import annotations

import os
from typing import Any, Mapping


def skill_proxy_internal_token() -> str:
    return (os.getenv("DRSAI_SKILL_PROXY_TOKEN") or "").strip()


def redact_skill_proxy_for_log(proxy: Mapping[str, Any] | None) -> dict:
    out = dict(proxy or {})
    if out.get("token"):
        out["token"] = "***"
    return out


def resolve_public_origin_from_headers(headers: Mapping[str, str] | None) -> str | None:
    """Build public origin from reverse-proxy / browser request headers."""
    if not headers:
        return None

    def _get(name: str) -> str:
        for key, value in headers.items():
            if key.lower() == name.lower():
                return (value or "").strip()
        return ""

    forwarded_host = _get("x-forwarded-host")
    forwarded_proto = _get("x-forwarded-proto")
    if forwarded_host:
        host = forwarded_host.split(",")[0].strip()
        proto = (forwarded_proto.split(",")[0].strip() if forwarded_proto else "https")
        return f"{proto}://{host}"

    host = _get("host")
    if not host:
        return None

    if forwarded_proto:
        proto = forwarded_proto.split(",")[0].strip()
    elif host.startswith("localhost") or host.startswith("127.0.0.1"):
        proto = "http"
    else:
        proto = "https"
    return f"{proto}://{host}"


def skill_proxy_public_base_url(request_origin: str | None = None) -> str:
    raw = (
        (request_origin or "").strip()
        or os.getenv("DRSAI_UI_PUBLIC_URL")
        or os.getenv("DRSAI_PUBLIC_URL")
        or "https://drsaiv2.ihep.ac.cn"
    ).rstrip("/")
    return f"{raw}/api/agent/skills"


def build_skill_proxy_payload(
    *,
    user_id: str,
    run_id: int | None = None,
    request_origin: str | None = None,
) -> dict:
    """Payload on user message metadata. user_id is identity; token is auth."""
    payload: dict[str, Any] = {
        "base_url": skill_proxy_public_base_url(request_origin),
        "user_id": user_id,
    }
    token = skill_proxy_internal_token()
    if token:
        payload["token"] = token
    if request_origin:
        payload["public_origin"] = request_origin.rstrip("/")
    if run_id is not None:
        payload["run_id"] = int(run_id)
    return payload


def summarize_skill_handoff_for_log(
    skill_proxy: dict | None,
    attached_skills: list | None,
) -> dict:
    proxy = skill_proxy or {}
    skills = []
    for item in attached_skills or []:
        if not isinstance(item, dict):
            continue
        desc = str(item.get("description") or "")
        if len(desc) > 80:
            desc = desc[:80] + "..."
        skills.append({
            "name": item.get("name"),
            "slug": item.get("slug"),
            "source": item.get("source") or "",
            "description": desc,
        })
    base_url = proxy.get("base_url") or ""
    return {
        "skill_proxy": {
            "base_url": base_url,
            "public_origin": proxy.get("public_origin"),
            "user_id": proxy.get("user_id"),
            "run_id": proxy.get("run_id"),
            "has_token": bool(proxy.get("token")),
        },
        "attached_skills": skills,
        "remote_agent_howto": {
            "list": f"GET {base_url}/attached?user_id=<user_id>",
            "load": f"POST {base_url}/load",
            "load_body": {"skill": "<frontmatter name>", "user_id": "<user_id>"},
            "headers": "X-User-Id: <user_id>; X-Skill-Proxy-Token: <skill_proxy.token>",
        },
    }
