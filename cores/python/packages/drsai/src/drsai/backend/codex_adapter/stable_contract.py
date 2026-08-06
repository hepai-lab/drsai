"""Generated Codex stable-contract bindings and compatibility policy.

The only editable protocol source is
``cores/protocol/codex-app-server-stable-contract.json``.  The imported
module is deterministic generated output and must never be edited by hand.
"""

from __future__ import annotations

from enum import Enum

from drsai.backend.codex_adapter.stable_contract_generated import (  # noqa: F401
    CLIENT_METHODS,
    CLIENT_METHOD_PARAMS,
    CLIENT_REQUIRED_PARAMS,
    CONTRACT_DIGEST,
    CONTRACT_VERSION,
    DIAGNOSTIC_NOTIFICATIONS,
    FATAL_NOTIFICATIONS,
    GENERATED_BASELINE,
    KNOWN_IGNORED_NOTIFICATIONS,
    LEGACY_NOTIFICATIONS,
    REVIEWED_COMPATIBLE_VERSIONS,
    REVIEWED_SCHEMA_SHA256,
    SEMANTIC_DISPOSITIONS,
    SEMANTIC_NOTIFICATIONS,
    SERVER_REQUESTS,
    STABLE_NOTIFICATIONS,
    USER_NOTICE_NOTIFICATIONS,
)


class NotificationClass(str, Enum):
    SEMANTIC = "semantic"
    USER_NOTICE = "user_notice"
    DIAGNOSTIC = "diagnostic"
    KNOWN_IGNORED = "known_ignored"
    SERVER_REQUEST = "server_request"
    FATAL = "fatal"
    UNKNOWN = "unknown"


class CodexCompatibility(str, Enum):
    EXACT = "exact"
    REVIEWED_COMPATIBLE = "reviewed_compatible"
    BLOCKED = "blocked"


class SemanticDisposition(str, Enum):
    MAPPED = "mapped"
    REVIEWED_IGNORED = "reviewed_ignored"
    RELEASE_BLOCKED = "release_blocked"


def classify_notification(method: str) -> NotificationClass:
    if method in SEMANTIC_NOTIFICATIONS:
        return NotificationClass.SEMANTIC
    if method in USER_NOTICE_NOTIFICATIONS:
        return NotificationClass.USER_NOTICE
    if method in DIAGNOSTIC_NOTIFICATIONS:
        return NotificationClass.DIAGNOSTIC
    if method in KNOWN_IGNORED_NOTIFICATIONS:
        return NotificationClass.KNOWN_IGNORED
    if method in SERVER_REQUESTS:
        return NotificationClass.SERVER_REQUEST
    if method in FATAL_NOTIFICATIONS or method in LEGACY_NOTIFICATIONS:
        return NotificationClass.FATAL
    return NotificationClass.UNKNOWN


def compatibility_for_version(version: str) -> CodexCompatibility:
    if version == GENERATED_BASELINE["codexVersion"]:
        return CodexCompatibility.EXACT
    if version in REVIEWED_COMPATIBLE_VERSIONS:
        return CodexCompatibility.REVIEWED_COMPATIBLE
    return CodexCompatibility.BLOCKED


def compatibility_for_identity(version: str, schema_digest: str | None) -> CodexCompatibility:
    """Classify version and, when supplied, its exact reviewed Schema bytes."""
    compatibility = compatibility_for_version(version)
    if compatibility is CodexCompatibility.BLOCKED or not schema_digest:
        return compatibility
    normalized = schema_digest.removeprefix("sha256:").lower()
    return compatibility if REVIEWED_SCHEMA_SHA256.get(version) == normalized else CodexCompatibility.BLOCKED


def semantic_disposition(method: str) -> SemanticDisposition | None:
    value = SEMANTIC_DISPOSITIONS.get(method)
    if not isinstance(value, dict):
        return None
    try:
        return SemanticDisposition(str(value.get("disposition") or ""))
    except ValueError:
        return None


def validate_client_method(method: str, params: object) -> None:
    """Validate the reviewed client surface before any local or remote write."""
    if method not in CLIENT_METHODS:
        raise ValueError(f"Codex client method is not allowed: {method!r}")
    if not isinstance(params, dict):
        # Callers pass concrete dicts after converting Mapping inputs. Keeping
        # this strict prevents custom mapping side effects at the wire boundary.
        raise ValueError("Codex client params must be an object.")
    allowed = CLIENT_METHOD_PARAMS.get(method)
    if allowed is None:
        raise ValueError(f"Codex client method has no reviewed parameter contract: {method!r}")
    unexpected = set(params) - set(allowed)
    if unexpected:
        raise ValueError(f"Codex client params are not allowed for {method}: {sorted(unexpected)!r}")
    missing = set(CLIENT_REQUIRED_PARAMS.get(method, ())) - set(params)
    if missing:
        raise ValueError(f"Codex client params are required for {method}: {sorted(missing)!r}")


def validate_server_request(method: str, params: object) -> None:
    """Validate App Server -> client request direction before dispatch."""
    if method not in SERVER_REQUESTS:
        raise ValueError(f"Codex server request is not allowed: {method!r}")
    if not isinstance(params, dict):
        raise ValueError(f"Codex server request params must be an object: {method!r}")
