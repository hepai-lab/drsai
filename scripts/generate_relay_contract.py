"""Generate small, dependency-free Relay contract catalogs from the schema."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/runtime-relay.schema.json"
PY_OUT = ROOT / "cores/python/packages/drsai/src/drsai/relay/generated_contract.py"
KT_OUT = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"


def render_python(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    capability_profiles = data.get("x-relay-capability-profiles", {})
    minimum_versions = data.get("x-relay-minimum-versions", {})
    session_event_kinds = data.get("x-session-event-kinds", [])
    profile_lines = ", ".join(
        f"{name!r}: frozenset({sorted(values)!r})"
        for name, values in sorted(capability_profiles.items())
    )
    return (
        '"""Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit."""\n'
        'from __future__ import annotations\n'
        'from datetime import datetime\n'
        'from typing import Any, Literal\n'
        'from uuid import UUID\n'
        'from pydantic import BaseModel, ConfigDict\n\n'
        f'SCHEMA_VERSION = {data["version"]!r}\n'
        f'PROTOCOL_VERSION = {data["protocol_version"]!r}\n'
        f'ENDPOINTS = {dict(sorted(endpoints.items()))!r}\n'
        f'CAPABILITIES = frozenset({sorted(capabilities)!r})\n\n'
        f'CAPABILITY_PROFILES = {{{profile_lines}}}\n'
        f'MINIMUM_VERSIONS = {dict(sorted(minimum_versions.items()))!r}\n'
        f'SESSION_EVENT_KINDS = frozenset({sorted(session_event_kinds)!r})\n\n'
        'class GeneratedStrictModel(BaseModel):\n    model_config = ConfigDict(extra="forbid", frozen=True)\n\n'
        'class GeneratedControlRequest(GeneratedStrictModel):\n    request_id: UUID\n    correlation_id: str\n    idempotency_key: str | None = None\n\n'
        'class GeneratedErrorEnvelope(GeneratedStrictModel):\n    code: str\n    message: str\n    correlation_id: str\n    retryable: bool\n    details: dict[str, Any]\n    source: Literal["relay", "runtime"]\n\n'
        'class GeneratedRelayEvent(GeneratedStrictModel):\n    event_id: str\n    sequence: int\n    runtime_id: str\n    workspace_id: str\n    session_id: str\n    run_id: str\n    timestamp: datetime\n    kind: str\n    payload: dict[str, Any]\n\n'
        'class GeneratedSessionConversationItem(GeneratedStrictModel):\n    item_id: str\n    session_id: str\n    run_id: str | None\n    kind: Literal["message", "reasoning", "tool", "approval", "artifact", "error"]\n    role: Literal["user", "assistant", "system", "tool"] | None\n    revision: int\n    session_sequence: int\n    source_client: Literal["windows", "android", "runtime"]\n    source_message_id: str | None\n    created_at: datetime\n    updated_at: datetime\n    payload: dict[str, Any]\n\n'
        'class GeneratedConversationSnapshot(GeneratedStrictModel):\n    session_id: str\n    snapshot_sequence: int\n    items: list[GeneratedSessionConversationItem]\n    next_cursor: str | None\n\n'
        'class GeneratedSessionEvent(GeneratedStrictModel):\n    event_id: str\n    runtime_id: str\n    workspace_id: str\n    session_id: str\n    run_id: str | None\n    session_sequence: int\n    kind: str\n    timestamp: datetime\n    payload: dict[str, Any]\n\n'
        'class GeneratedRuntimeSessionEventFrame(GeneratedStrictModel):\n    type: Literal["event"] = "event"\n    scope: Literal["session"] = "session"\n    session_id: str\n    session_sequence: int\n    event: GeneratedSessionEvent\n'
    )


def render_kotlin(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    capability_profiles = data.get("x-relay-capability-profiles", {})
    minimum_versions = data.get("x-relay-minimum-versions", {})
    session_event_kinds = data.get("x-session-event-kinds", [])
    endpoint_lines = ",\n".join(f'        "{k}" to "{v}"' for k, v in sorted(endpoints.items()))
    capability_lines = ",\n".join(f'        "{value}"' for value in sorted(capabilities))
    profile_lines = ",\n".join(
        f'        "{profile}" to setOf({", ".join(f"{value!r}" for value in sorted(values))})'.replace("'", '"')
        for profile, values in sorted(capability_profiles.items())
    )
    minimum_version_lines = ",\n".join(
        f'        "{profile}" to mapOf({", ".join(f"{component!r} to {version!r}" for component, version in sorted(versions.items()))})'.replace("'", '"')
        for profile, versions in sorted(minimum_versions.items())
    )
    session_event_kind_lines = ",\n".join(
        f'        "{value}"' for value in sorted(session_event_kinds)
    )
    return f'''// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object RelayContractGenerated {{
    const val SCHEMA_VERSION: String = "{data['version']}"
    const val PROTOCOL_VERSION: String = "{data['protocol_version']}"
    val ENDPOINTS: Map<String, String> = mapOf(
{endpoint_lines}
    )
    val CAPABILITIES: Set<String> = setOf(
{capability_lines}
    )
    val CAPABILITY_PROFILES: Map<String, Set<String>> = mapOf(
{profile_lines}
    )
    val MINIMUM_VERSIONS: Map<String, Map<String, String>> = mapOf(
{minimum_version_lines}
    )
    val SESSION_EVENT_KINDS: Set<String> = setOf(
{session_event_kind_lines}
    )
}}

data class GeneratedControlRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
)

data class GeneratedErrorEnvelope(
    val code: String,
    val message: String,
    val correlationId: String,
    val retryable: Boolean,
    val details: Map<String, Any?>,
    val source: String,
)

data class GeneratedRelayEvent(
    val eventId: String,
    val sequence: Long,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val timestamp: String,
    val kind: String,
    val payload: Map<String, Any?>,
)

data class GeneratedSessionConversationItem(
    val itemId: String,
    val sessionId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payload: Map<String, Any?>,
)

data class GeneratedConversationSnapshot(
    val sessionId: String,
    val snapshotSequence: Long,
    val items: List<GeneratedSessionConversationItem>,
    val nextCursor: String?,
)

data class GeneratedSessionEvent(
    val eventId: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
)

data class GeneratedRuntimeSessionEventFrame(
    val type: String = "event",
    val scope: String = "session",
    val sessionId: String,
    val sessionSequence: Long,
    val event: GeneratedSessionEvent,
)
'''


def generated() -> tuple[str, str]:
    data = json.loads(SCHEMA.read_text(encoding="utf-8"))
    return render_python(data), render_kotlin(data)


def main(check: bool = False) -> int:
    python_text, kotlin_text = generated()
    outputs = ((PY_OUT, python_text), (KT_OUT, kotlin_text))
    if check:
        drift = [str(path.relative_to(ROOT)) for path, text in outputs if not path.exists() or path.read_text(encoding="utf-8") != text]
        if drift:
            raise SystemExit("Relay generated contract drift: " + ", ".join(drift))
        return 0
    for path, text in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main("--check" in sys.argv))
