"""Base source adapter for syncing external skills into the unified SkillMeta table."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseSourceAdapter(ABC):
    """Abstract base for external skill source adapters.

    Each external source (Higraf, Rongzai, ...) implements these three methods.
    The sync engine calls them in order: list -> download ZIP -> persist metadata.
    """

    source: str

    @abstractmethod
    async def list_skills(self) -> list[dict]:
        """Return skill list from the external source.

        Each dict must contain at minimum:
            slug, name, icon, version, author, tags, download_count
        """
        ...

    @abstractmethod
    async def get_detail(self, slug: str) -> dict | None:
        """Return full detail for a skill.

        Should include: description, body, author_email, author_id, changelog,
        required_tools, and any other upstream-specific fields.
        """
        ...

    @abstractmethod
    async def download_zip(self, slug: str) -> tuple[bytes | None, bool]:
        """Download the skill ZIP. Returns (bytes, restricted_flag).

        If restricted is True, the skill is not downloadable.
        """
        ...