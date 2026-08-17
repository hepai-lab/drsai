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
    r"(?:最新|近期|最近|今天|本周|本月|新闻|价格|政策|"
    r"latest|recent|today|news|price)",
    re.IGNORECASE,
)
_NOW_TOKEN = re.compile(
    r"(?:当前|现在|(?<![a-z])current(?![a-z]))",
    re.IGNORECASE,
)
_LOCAL_NOW = re.compile(
    r"(?:当前|现在)\s*(?:的\s*)?(?:运行|任务|错误|会话|截图|诊断|模型|状态|连接|Agent)"
    r"|(?<![a-z])current(?![a-z])\s+(?:run|task|error|session|screenshot|diagnostic|model|status|connection)\b",
    re.IGNORECASE,
)
_LOCAL_EVIDENCE = re.compile(
    r"(?:截图|screenshot|这张图|分析这张|运行诊断)",
    re.IGNORECASE,
)
_RETRYABLE_MANAGED_STATUS = frozenset({
    "worker_unavailable", "provider_unavailable", "timeout", "provider_timeout", "rate_limited",
})
_CREDENTIAL_MANAGED_STATUS = frozenset({
    "permission_denied", "login_required", "authentication_failed",
})


def prompt_requires_current_web(prompt: str, *, current_year: int | None = None) -> bool:
    """Conservatively identify prompts that cannot be answered as timeless facts.

    The Tool Router remains the final enforcement boundary.  This preflight is
    intentionally biased toward explicit search requests, current-information
    vocabulary, and present/future years rather than broad topic guessing.
    Local screenshot / run-state questions are answered from attached evidence.
    """

    normalized = " ".join(str(prompt or "").split())[:16_000]
    if not normalized:
        return False
    if _EXPLICIT_WEB.search(normalized):
        return True
    if _LOCAL_EVIDENCE.search(normalized):
        return False
    if _CURRENT_INFO.search(normalized):
        return True
    if _NOW_TOKEN.search(normalized) and not _LOCAL_NOW.search(normalized):
        return True
    year = current_year or datetime.now(UTC).year
    mentioned = [int(value) for value in re.findall(r"(?<!\d)(20\d{2})(?!\d)", normalized)]
    return any(value >= year for value in mentioned)


def classify_managed_web_search_status(status: str) -> CapabilityConfigurationRequest | None:
    """Map a non-available HAI-managed search status to a recoverable pause.

    Transient transport failures stay with the caller so they can raise a
    retryable RuntimeExecutionError. Account/policy denials must not fail the
    whole Run; Desktop already knows how to offer answer-without-network.
    """

    code = str(status or "worker_unavailable").strip() or "worker_unavailable"
    if code == "available" or code in _RETRYABLE_MANAGED_STATUS:
        return None
    reason: CapabilityReason = (
        "credential_unavailable" if code in _CREDENTIAL_MANAGED_STATUS else "policy_denied"
    )
    return CapabilityConfigurationRequest("web.search", "public_web", "tavily", reason)


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
