"""Provider-neutral capability configuration preflight.

This module deliberately knows about capability/resource semantics, not HTTP,
Desktop components, or Tavily's wire API.  It is safe to use before a user
query has been disclosed to any external provider.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable, Iterable, Literal, Protocol


CapabilityReason = Literal[
    "resource_missing", "resource_disabled", "credential_missing",
    "credential_unavailable", "credential_invalid", "quota_exhausted",
    "network_unavailable", "provider_timeout", "policy_denied",
]


class PerceptorLike(Protocol):
    kind: str
    adapter: str
    capabilities: tuple[str, ...]
    enabled: bool


@dataclass(frozen=True)
class CapabilityConfigurationRequest:
    capability: str
    resource_kind: str
    preferred_adapter: str
    reason: CapabilityReason
    query_disclosed: bool = False

    def public_dict(self) -> dict[str, object]:
        return {
            "type": "capability_configuration_required",
            "capability": self.capability,
            "resource_kind": self.resource_kind,
            "preferred_adapter": self.preferred_adapter,
            "reason": self.reason,
            "resume_supported": True,
            "query_disclosed": self.query_disclosed,
        }


_EXPLICIT_WEB = re.compile(
    r"(?:联网|上网|网页|网络|官网|官方网站|搜索|搜一下|查一下|查找|检索|"
    r"search\b|look\s*up\b|browse\b|official\s+(?:site|website))",
    re.IGNORECASE,
)
_CURRENT_INFO = re.compile(
    r"(?:最新|近期|最近|现在|当前|今天|本周|本月|日程|会议|活动|新闻|价格|政策|版本|"
    r"latest|recent|current|today|schedule|conference|event|news|price|version)",
    re.IGNORECASE,
)


def prompt_requires_current_web(prompt: str, *, current_year: int | None = None) -> bool:
    """Conservatively identify prompts that cannot be answered as timeless facts.

    The Tool Router remains the final enforcement boundary.  This preflight is
    intentionally biased toward explicit search requests, current-information
    vocabulary, and present/future years rather than broad topic guessing.
    """

    normalized = " ".join(str(prompt or "").split())[:16_000]
    if not normalized:
        return False
    if _EXPLICIT_WEB.search(normalized) or _CURRENT_INFO.search(normalized):
        return True
    year = current_year or datetime.now(UTC).year
    mentioned = [int(value) for value in re.findall(r"(?<!\d)(20\d{2})(?!\d)", normalized)]
    return any(value >= year for value in mentioned)


def classify_web_search_configuration(
    resources: Iterable[PerceptorLike],
    *,
    credential_available: Callable[[PerceptorLike], bool],
) -> CapabilityConfigurationRequest | None:
    """Return the actionable missing state, or ``None`` when search is usable."""

    candidates = [
        resource for resource in resources
        if resource.kind == "public_web"
        and resource.adapter == "tavily"
        and "web.search" in resource.capabilities
    ]
    if not candidates:
        return CapabilityConfigurationRequest("web.search", "public_web", "tavily", "resource_missing")
    enabled = [resource for resource in candidates if resource.enabled]
    if not enabled:
        return CapabilityConfigurationRequest("web.search", "public_web", "tavily", "resource_disabled")
    if not any(credential_available(resource) for resource in enabled):
        return CapabilityConfigurationRequest("web.search", "public_web", "tavily", "credential_unavailable")
    return None
