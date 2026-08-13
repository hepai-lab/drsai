#!/usr/bin/env python3
"""Generate and verify the bounded remote-workspace Legacy inventory."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "cores/protocol/relay/remote-workspace-legacy-inventory.json"


ENTRIES = (
    ("relay-conversation-routes", "route", "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_conversation.py", "create_relay_legacy_conversation_router", "cores/python/packages/drsai/src/drsai/relay/api.py"),
    ("runtime-conversation-routes", "route", "cores/python/packages/drsai/src/drsai/compatibility/runtime_legacy_conversation.py", "RuntimeLegacyConversationHandlers", "cores/python/packages/drsai/src/drsai/backend/gateway.py"),
    ("conversation-dtos", "dto", "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_models.py", "ConversationSnapshot", "cores/python/packages/drsai/src/drsai/relay/models.py"),
    ("runtime-conversation-items", "table", "cores/python/packages/drsai/src/drsai/backend/runtime/journal.py", "runtime_conversation_items", "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py"),
    ("runtime-session-journal", "table", "cores/python/packages/drsai/src/drsai/backend/runtime/journal.py", "runtime_session_journal", "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py"),
    ("legacy-session-migrations", "table", "cores/python/packages/drsai/src/drsai/backend/runtime/migrations.py", "legacy_session_migrations", "cores/python/packages/drsai/src/drsai/backend/gateway.py"),
    ("runtime-session-event-forwarder", "subscription", "cores/python/packages/drsai/src/drsai/relay/runtime_client.py", "_forward_session_events", "cores/python/packages/drsai/src/drsai/relay/runtime_client.py"),
    ("android-conversation-adapter", "adapter", "apps/android/app/src/main/java/ai/drsai/remote/remote/data/LegacyConversationAdapter.kt", "LegacyConversationAdapter", "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"),
    ("desktop-conversation-adapter", "adapter", "apps/desktop/shared/main/legacyConversationAdapter.ts", "LegacyConversationAdapter", "apps/desktop/shared/main/threadRuntimeSubscription.ts"),
    ("desktop-protocol-selector", "selector", "apps/desktop/shared/main/runtimeProtocolSelection.ts", "selected: \"oaep\" | \"legacy\"", "apps/desktop/shared/main/threadRuntimeSubscription.ts"),
    ("desktop-legacy-telemetry", "telemetry", "apps/desktop/shared/main/legacyProtocolTelemetry.ts", "LegacyProtocolTelemetry", "apps/desktop/shared/main/threadRuntimeSubscription.ts"),
)


def _read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file() or not path.read_bytes():
        raise ValueError(f"p6_legacy_inventory_source_missing:{relative}")
    return path.read_text(encoding="utf-8")


def generate() -> dict[str, object]:
    from p5_legacy_rollback import REQUIRED_MEMBERS

    rollback = set(REQUIRED_MEMBERS)
    rows: list[dict[str, object]] = []
    for identifier, kind, owner, marker, consumer in ENTRIES:
        owner_source = _read(owner)
        consumer_source = _read(consumer)
        if marker not in owner_source:
            raise ValueError(f"p6_legacy_inventory_marker_missing:{identifier}")
        consumer_marker = marker if owner == consumer else (
            "boundaries.session.legacy" if identifier == "android-conversation-adapter" else
            "LegacyConversationAdapter" if identifier == "desktop-conversation-adapter" else
            "legacyProtocolTelemetry" if identifier == "desktop-legacy-telemetry" else
            "selectRuntimeConversationProtocol" if identifier == "desktop-protocol-selector" else
            "runtime_session" if identifier == "runtime-session-journal" else
            "runtime_conversation_items" if identifier == "runtime-conversation-items" else
            "/v1/migrations/legacy-desktop-agent-runs" if identifier == "legacy-session-migrations" else
            marker
        )
        if consumer_marker not in consumer_source:
            raise ValueError(f"p6_legacy_inventory_consumer_missing:{identifier}")
        rollback_owner = owner in rollback
        if not rollback_owner:
            raise ValueError(f"p6_legacy_inventory_rollback_missing:{identifier}:{owner}")
        rows.append({
            "id": identifier, "kind": kind, "owner": owner, "consumer": consumer,
            "usage_telemetry": "protocol/runtime_version/fallback_reason",
            "removal_state": "retained_until_threshold_passes",
            "rollback_owner_included": rollback_owner,
        })

    forbidden_roots = (
        "cores/python/packages/drsai/src/drsai/oaep",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep",
    )
    forbidden_tokens = ("drsai.compatibility", "LegacyConversationAdapter")
    violations: list[str] = []
    for relative_root in forbidden_roots:
        for path in sorted((ROOT / relative_root).rglob("*")):
            if path.suffix not in {".py", ".kt", ".ts"}:
                continue
            source = path.read_text(encoding="utf-8")
            if any(token in source for token in forbidden_tokens):
                violations.append(path.relative_to(ROOT).as_posix())
    desktop_oaep = _read("apps/desktop/shared/main/oaepSessionStream.ts")
    if "legacyConversationAdapter" in desktop_oaep or "LegacyConversationAdapter" in desktop_oaep:
        violations.append("apps/desktop/shared/main/oaepSessionStream.ts")
    if violations:
        raise ValueError(f"p6_oaep_core_depends_on_legacy:{','.join(violations)}")

    return {
        "schema_version": "opendrsai.remote-workspace-legacy-inventory/1",
        "policy": {
            "long_observation_window_required": False,
            "delete_only_when": [
                "oaep_client_ratio>=0.999", "legacy_request_ratio<0.001",
                "fallback_error_rate<=0.001", "migration_ratio=1",
                "supported_runtime_requires_legacy=false", "rollback_artifact_verified=true",
                "transcript_hash_preserved=true", "database_migration_verified=true",
            ],
        },
        "items": rows,
    }


def encoded(value: dict[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        output = encoded(generate())
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != output:
            raise SystemExit("p6_legacy_inventory_drift")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(output, encoding="utf-8")
    print(json.dumps({"items": len(ENTRIES), "passed": True}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
