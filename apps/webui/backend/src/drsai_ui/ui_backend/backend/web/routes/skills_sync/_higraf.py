"""Higraf skill source adapter."""

from ._base import BaseSourceAdapter


class HigrafAdapter(BaseSourceAdapter):
    """Adapter for syncing skills from Higraf (higraf.ihep.ac.cn)."""

    source = "higraf"

    async def list_skills(self) -> list[dict]:
        from ..deer_flow import fetch_higraf_skills
        items = await fetch_higraf_skills("public")
        return [
            {
                "slug": h.get("skillId") or h.get("id", ""),
                "name": h.get("name") or h.get("skillName", ""),
                "icon": h.get("emoji", "package"),
                "version": h.get("version") or h.get("currentVersion", "1.0.0"),
                "description": h.get("description") or "",
                "author": h.get("authorName", ""),
                "tags": [h["categoryL2"]] if h.get("categoryL2") else [],
                "download_count": int(h.get("callCount") or 0),
            }
            for h in items
            if h.get("skillId") or h.get("id")
        ]

    async def get_detail(self, slug: str) -> dict | None:
        from ..deer_flow import fetch_higraf_skill_detail
        detail = await fetch_higraf_skill_detail(slug)
        if not detail:
            return None
        return {
            "description": detail.get("description") or "",
            "body": detail.get("content") or detail.get("body") or "",
            "author_email": detail.get("authorEmail") or detail.get("authorId") or "",
            "author_id": detail.get("authorId") or "",
            "changelog": detail.get("changelog") or "",
            "required_tools": [],
            "detail_raw": detail,
        }

    async def download_zip(self, slug: str) -> tuple[bytes | None, bool]:
        from ..deer_flow import download_higraf_skill_bytes
        return await download_higraf_skill_bytes(slug)