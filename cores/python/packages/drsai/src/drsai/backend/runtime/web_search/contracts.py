"""Stable P1 contracts for public-web search results."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import re
from typing import Any
import unicodedata
from urllib.parse import urlsplit


MAX_QUERY_CHARS = 500
MAX_RESULTS = 10


@dataclass(frozen=True)
class WebSearchQueryPlan:
    requested_query: str
    effective_query: str
    rewrite_reason: str = ""


def plan_search_query(value: str) -> WebSearchQueryPlan:
    """Conservatively turn a high-confidence entity question into search terms."""
    if not isinstance(value, str):
        raise ValueError("web_search_query_invalid")
    requested = normalize_query(value)
    candidate = normalize_query(unicodedata.normalize("NFKC", requested))
    reason = ""
    terminal = re.fullmatch(
        r"(?P<entity>.+?)(?:是什么|是谁|介绍一下|了解一下)[?？!！。]*",
        candidate,
        flags=re.IGNORECASE,
    )
    leading = re.fullmatch(
        r"(?:what\s+is|who\s+is)\s+(?P<entity>.+?)[?!.]*",
        candidate,
        flags=re.IGNORECASE,
    )
    match = terminal or leading
    if match is not None:
        entity = " ".join(match.group("entity").split()).strip()
        # Only rewrite identifiers with a clear Latin/digit signal. This keeps
        # Chinese names such as “什么值得买” and open-ended questions intact.
        if re.search(r"[A-Za-z]", entity) and (
            re.search(r"\d", entity)
            or re.search(r"[A-Z].*[A-Z]", entity)
            or re.fullmatch(r"[A-Za-z][A-Za-z0-9_.+\-/ ]{2,}", entity)
        ):
            candidate = entity
            reason = "entity_definition"
    separated = re.sub(
        r"(?P<letters>[A-Z]{2,}|[A-Za-z]{3,})(?P<number>\d+)",
        r"\g<letters> \g<number>",
        candidate,
    )
    separated = re.sub(
        r"(?P<number>\d{2,})(?P<letters>[A-Z]{2,}|[A-Za-z]{3,})",
        r"\g<number> \g<letters>",
        separated,
    )
    separated = " ".join(separated.split())
    if separated != candidate:
        candidate = separated
        reason = f"{reason}+alphanumeric_boundary" if reason else "alphanumeric_boundary"
    return WebSearchQueryPlan(requested, candidate, reason)


def normalize_query(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("web_search_query_invalid")
    query = " ".join(value.split())
    if not query:
        raise ValueError("web_search_query_required")
    if len(query) > MAX_QUERY_CHARS:
        raise ValueError("web_search_query_too_long")
    return query


def normalize_max_results(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= MAX_RESULTS:
        raise ValueError("web_search_max_results_invalid")
    return value


@dataclass(frozen=True)
class WebSearchResult:
    rank: int
    title: str
    url: str
    snippet: str = ""
    content: str = ""
    content_sha256: str = ""

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class WebSearchCandidate:
    """Bounded, UI-only evidence for one normalized search-engine candidate."""

    rank: int
    title: str
    url: str
    snippet: str = ""
    accepted: bool = False
    reason: str = "query_mismatch"

    def inspection_dict(self) -> dict[str, Any]:
        return {
            "rank": self.rank,
            "title": self.title,
            "url": self.url,
            "domain": urlsplit(self.url).hostname or "",
            "snippet": self.snippet[:600],
            "accepted": self.accepted,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class WebSearchResponse:
    query: str
    results: tuple[WebSearchResult, ...]
    requested_query: str = ""
    rewrite_reason: str = ""
    provider: str = "bing-playwright"
    retrieved_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    )
    partial: bool = False
    warnings: tuple[str, ...] = ()
    candidates: tuple[WebSearchCandidate, ...] = ()
    version: int = 1

    def public_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "query": self.query,
            **({"requested_query": self.requested_query} if self.requested_query and self.requested_query != self.query else {}),
            **({"rewrite_reason": self.rewrite_reason} if self.rewrite_reason else {}),
            "provider": self.provider,
            "retrieved_at": self.retrieved_at,
            "results": [result.public_dict() for result in self.results],
            "partial": self.partial,
            "warnings": list(self.warnings),
        }

    def inspection_dict(self) -> dict[str, Any]:
        accepted = sum(1 for candidate in self.candidates if candidate.accepted)
        return {
            "version": 1,
            "kind": "web_search",
            "query": self.query,
            "requested_query": self.requested_query or self.query,
            "effective_query": self.query,
            "rewrite_reason": self.rewrite_reason,
            "provider": self.provider,
            "candidate_count": len(self.candidates),
            "accepted_count": accepted,
            "rejected_count": len(self.candidates) - accepted,
            "candidates": [candidate.inspection_dict() for candidate in self.candidates],
        }
