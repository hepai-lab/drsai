"""Generate small, dependency-free Relay contract catalogs from the schema."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "protocol/relay/runtime-relay.schema.json"
PY_OUT = ROOT / "cores/python/packages/drsai/src/drsai/relay/generated_contract.py"
KT_OUT = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"


def render_python(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    return (
        '"""Generated from protocol/relay/runtime-relay.schema.json. Do not edit."""\n'
        'from __future__ import annotations\n'
        'from datetime import datetime\n'
        'from typing import Any, Literal\n'
        'from uuid import UUID\n'
        'from pydantic import BaseModel, ConfigDict\n\n'
        f'SCHEMA_VERSION = {data["version"]!r}\n'
        f'PROTOCOL_VERSION = {data["protocol_version"]!r}\n'
        f'ENDPOINTS = {dict(sorted(endpoints.items()))!r}\n'
        f'CAPABILITIES = frozenset({sorted(capabilities)!r})\n\n'
        'class GeneratedStrictModel(BaseModel):\n    model_config = ConfigDict(extra="forbid", frozen=True)\n\n'
        'class GeneratedControlRequest(GeneratedStrictModel):\n    request_id: UUID\n    correlation_id: str\n    idempotency_key: str | None = None\n\n'
        'class GeneratedErrorEnvelope(GeneratedStrictModel):\n    code: str\n    message: str\n    correlation_id: str\n    retryable: bool\n    details: dict[str, Any]\n    source: Literal["relay", "runtime"]\n\n'
        'class GeneratedRelayEvent(GeneratedStrictModel):\n    event_id: str\n    sequence: int\n    runtime_id: str\n    workspace_id: str\n    session_id: str\n    run_id: str\n    timestamp: datetime\n    kind: str\n    payload: dict[str, Any]\n'
    )


def render_kotlin(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    endpoint_lines = ",\n".join(f'        "{k}" to "{v}"' for k, v in sorted(endpoints.items()))
    capability_lines = ",\n".join(f'        "{value}"' for value in sorted(capabilities))
    return f'''// Generated from protocol/relay/runtime-relay.schema.json. Do not edit.
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
