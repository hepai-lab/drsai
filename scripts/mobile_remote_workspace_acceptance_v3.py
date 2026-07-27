"""Generate and verify the 104-point Mobile Remote Workspace V3 ledger."""
from __future__ import annotations

import argparse
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/remote_workespace/OpenDrSai移动远程工作区开发方案V3.md"
V2_LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v2/acceptance.json"
LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v3/acceptance.json"
ROW = re.compile(
    r"^\| (?P<id>M\d{2}-F\d{2}) \| (?P<description>[^|]+) \| "
    r"(?P<acceptance>[^|]+) \|$"
)
VALID_STATUS = {"unverified", "local_pass", "full_pass", "blocked"}
REQUIRED_FULL_EVIDENCE = {
    "code",
    "automated_test",
    "ai_dev",
    "windows_runtime",
    "android_device",
}
SECRET_PATTERN = re.compile(
    r"(?i)(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|"
    r"(?:password|registration_token|private_key|access_token)"
    r"\s*[\"=:]\s*[^\s\",}]{8,})"
)
PARTIAL_M11_EVIDENCE: dict[str, list[dict[str, str]]] = {
    "M11-F01": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/runtime-relay.schema.json",
            "result": "contract_defined_runtime_not_implemented",
        },
    ],
    "M11-F02": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/session-conversation-fixtures.json",
        },
        {
            "kind": "automated_test",
            "command": "pytest test_relay_contract_codegen.py + Android SessionConversationContractTest",
            "result": "contract_pass_runtime_merge_pending",
        },
    ],
    "M11-F03": [
        {
            "kind": "automated_test",
            "command": "pytest test_relay_contract_codegen.py",
            "result": "schema_pass_sse_runtime_pending",
        },
    ],
    "M11-F04": [
        {
            "kind": "automated_test",
            "command": "pytest test_relay_contract_codegen.py + Android SessionConversationContractTest",
            "result": "capability_profile_pass_client_gate_pending",
        },
    ],
}
LOCAL_V3_EVIDENCE: dict[str, list[dict[str, str]]] = {
    item_id: [
        {
            "kind": "code",
            "artifact": "cores/python/packages/drsai/src/drsai/backend/runtime/journal.py",
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_runtime_conversation_journal.py "
                "test_runtime_engine.py"
            ),
            "result": "30 passed",
        },
    ]
    for item_id in ("M12-F01", "M12-F02", "M12-F03", "M12-F04")
}
LOCAL_V3_EVIDENCE.update({
    "M10-F08": [
        {
            "kind": "code",
            "artifact": "scripts/finalize_mobile_remote_workspace_release_v3.py",
        },
        {
            "kind": "automated_test",
            "command": "pytest test_mobile_remote_workspace_release_finalizer_v3.py",
            "result": (
                "6 finalizer scenarios pass; 104/104, three JUnit suites, "
                "screenshots, fault/secret/stability and digest gates fail closed"
            ),
        },
    ],
    "M11-F01": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/runtime-relay.schema.json",
        },
        {
            "kind": "automated_test",
            "command": "pytest test_runtime_conversation_journal.py test_relay_contract_codegen.py",
            "result": "strict concurrent Session sequence and generated schema pass",
        },
    ],
    "M11-F02": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/session-conversation-fixtures.json",
        },
        {
            "kind": "automated_test",
            "command": "pytest test_runtime_conversation_journal.py + Android SessionConversationContractTest",
            "result": "revision/source_message_id merge and shared fixtures pass",
        },
    ],
    "M11-F03": [
        {
            "kind": "code",
            "artifact": "cores/python/packages/drsai/src/drsai/backend/gateway.py",
        },
        {
            "kind": "automated_test",
            "command": "pytest test_gateway_session_events.py",
            "result": "3 passed; snapshot/replay/SSE race and pre-header cursor_expired pass",
        },
    ],
    "M11-F04": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/runtime-relay.schema.json",
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_relay_contract_codegen.py + "
                "Android SessionConversationContractTest"
            ),
            "result": (
                "session-events/1 capability profile, minimum Runtime 1.5.3 "
                "gate, prerelease rejection and generated endpoint drift pass"
            ),
        },
    ],
    "M13-F01": [
        {
            "kind": "code",
            "artifact": "apps/desktop/shared/main/chat.ts",
        },
        {
            "kind": "automated_test",
            "command": (
                "npm verify:session-sync-state + pytest "
                "test_runtime_conversation_journal.py "
                "test_relay_gateway_control.py"
            ),
            "result": (
                "My DrSai/Codex use Runtime create_run; Windows/Android "
                "source provenance and semantic idempotency pass"
            ),
        },
    ],
    "M13-F02": [
        {
            "kind": "code",
            "artifact": (
                "apps/desktop/shared/main/"
                "threadRuntimeSubscription.ts"
            ),
        },
        {
            "kind": "automated_test",
            "command": "npm verify:session-conversation-subscription",
            "result": (
                "Snapshot-to-SSE, duplicate/gap recovery and "
                "message/reasoning/tool projection pass"
            ),
        },
    ],
    "M13-F03": [
        {
            "kind": "code",
            "artifact": "apps/desktop/shared/main/threadRuntimeProjection.ts",
        },
        {
            "kind": "automated_test",
            "command": "npm verify:session-conversation-subscription",
            "result": (
                "Android-originated source item projects into the Windows "
                "conversation without creating a local Run"
            ),
        },
    ],
    "M13-F04": [
        {
            "kind": "code",
            "artifact": "apps/desktop/shared/main/sessionSyncState.ts",
        },
        {
            "kind": "automated_test",
            "command": (
                "npm verify:session-sync-state + "
                "npm typecheck:node + npm typecheck:web"
            ),
            "result": (
                "atomic monotonic cursor, restart-safe hashed outbox and "
                "thread catalog IPC pass"
            ),
        },
    ],
    "M14-F01": [
        {
            "kind": "code",
            "artifact": (
                "ai-dev:hai-ai-platform-backend@"
                "173bb1abc6be3099d8f641a8897c7861e62bbb8a"
            ),
        },
        {
            "kind": "automated_test",
            "command": "ai-dev Relay directed suite",
            "result": (
                "13 passed; mixed legacy Run/session frame routing, "
                "outer/inner identity validation and dedupe pass"
            ),
        },
    ],
    "M14-F02": [
        {
            "kind": "code",
            "artifact": (
                "ai-dev:hai-ai-platform-backend@"
                "173bb1abc6be3099d8f641a8897c7861e62bbb8a"
            ),
        },
        {
            "kind": "automated_test",
            "command": "ai-dev Relay 13 tests + OIDC 18 tests",
            "result": (
                "authorized Snapshot/events/SSE routing and public DTO "
                "identity normalization pass; anonymous endpoints return 401"
            ),
        },
    ],
    "M14-F03": [
        {
            "kind": "code",
            "artifact": (
                "ai-dev:hai-ai-platform-backend@"
                "173bb1abc6be3099d8f641a8897c7861e62bbb8a"
            ),
        },
        {
            "kind": "automated_test",
            "command": "ai-dev Redis Session replay directed tests",
            "result": (
                "bounded replay, generation fencing, sequence dedupe and "
                "cursor_expired pass locally; release-scale gate remains"
            ),
        },
    ],
    "M14-F04": [
        {
            "kind": "code",
            "artifact": (
                "ai-dev:hai-ai-platform-backend@"
                "173bb1abc6be3099d8f641a8897c7861e62bbb8a"
            ),
        },
        {
            "kind": "automated_test",
            "command": "ai-dev Relay 13 tests + OIDC 18 tests",
            "result": (
                "association revoke closes Session streams; scope, "
                "structured logging and public OpenAPI gates pass locally"
            ),
        },
    ],
    "M15-F01": [
        {
            "kind": "code",
            "artifact": (
                "apps/android/app/src/main/java/ai/drsai/remote/"
                "remote/data/RemoteStore.kt"
            ),
        },
        {
            "kind": "automated_test",
            "command": "JVM tests + RemoteSessionSyncStoreTest",
            "result": (
                "224 JVM passed; Samsung 4/4 and API35 emulator 4/4; "
                "Snapshot/items/events/cursor transactions pass"
            ),
        },
    ],
    "M15-F02": [
        {
            "kind": "code",
            "artifact": (
                "apps/android/app/src/main/java/ai/drsai/remote/"
                "remote/ui/RemoteSessionViewModel.kt"
            ),
        },
        {
            "kind": "automated_test",
            "command": "JVM 224 tests + AndroidTest compile",
            "result": (
                "Session-level Snapshot/replay/SSE remains subscribed across "
                "successive Runs and renders Journal items"
            ),
        },
    ],
    "M15-F03": [
        {
            "kind": "code",
            "artifact": (
                "apps/android/app/src/main/java/ai/drsai/remote/"
                "remote/data/RelayRemoteRepository.kt"
            ),
        },
        {
            "kind": "automated_test",
            "command": "JVM 224 tests + RemoteSessionSyncStoreTest",
            "result": (
                "optimistic source_message_id/idempotency merge, stale "
                "snapshot rejection and duplicate/collision fail closed"
            ),
        },
    ],
    "M15-F04": [
        {
            "kind": "code",
            "artifact": (
                "apps/android/app/src/main/java/ai/drsai/remote/"
                "remote/ui/RemoteSessionViewModel.kt"
            ),
        },
        {
            "kind": "automated_test",
            "command": "JVM 224 tests + AndroidTest 8 device/emulator tests",
            "result": (
                "foreground/network/EOF/401/cursor_expired recovery logic "
                "and persistent cursor invariants pass locally"
            ),
        },
    ],
    "M16-F01": [
        {
            "kind": "code",
            "artifact": (
                "cores/python/packages/drsai/src/drsai/backend/"
                "runtime/engine.py"
            ),
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_runtime_conversation_journal.py "
                "test_runtime_engine.py::"
                "test_concurrent_approval_decisions_have_one_atomic_winner"
            ),
            "result": (
                "100 alternating Windows/Android sends produce 100 unique "
                "Runs/items and one contiguous Session sequence; concurrent "
                "Approval has one atomic winner"
            ),
        },
    ],
    "M16-F02": [
        {
            "kind": "code",
            "artifact": "cores/protocol/relay/runtime-relay.schema.json",
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_relay_contract_codegen.py "
                "test_relay_runtime_client.py + Android "
                "SessionConversationContractTest RelayDiscoveryClientTest"
            ),
            "result": (
                "Python/Kotlin generated contracts, session-events/1 minimum "
                "1.5.3 matrix, malformed/prerelease rejection and endpoint "
                "drift gate pass"
            ),
        },
    ],
    "M16-F03": [
        {
            "kind": "code",
            "artifact": "scripts/accept_mobile_remote_workspace_real_device_v3.py",
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_mobile_remote_workspace_real_device_v3.py "
                "test_session_conversation_digest.py + "
                "Android compileDebugAndroidTestKotlin"
            ),
            "result": (
                "bidirectional two-Run Session SSE/P95 driver, Android UI "
                "proof, source/sequence checks and three-language canonical "
                "transcript digest pass locally"
            ),
        },
    ],
    "M16-F04": [
        {
            "kind": "code",
            "artifact": "scripts/finalize_mobile_remote_workspace_release_v3.py",
        },
        {
            "kind": "automated_test",
            "command": (
                "pytest test_mobile_remote_workspace_release_finalizer_v3.py "
                "test_mobile_remote_workspace_acceptance_v3.py"
            ),
            "result": (
                "one-hour thresholds, five-fault matrix, nine-source secret "
                "scan, artifact digest manifest and 104/104 gate pass locally"
            ),
        },
    ],
})
MOVED_V2_ARTIFACTS = {
    "cores/python/packages/drsai/src/drsai/backend/runtime_engine.py":
        "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime_registry.py":
        "cores/python/packages/drsai/src/drsai/backend/runtime/registry.py",
    "cores/python/packages/drsai/src/drsai/backend/agent_runtime.py":
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
}


def v3_rows() -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if not match:
            continue
        row = {key: value.strip() for key, value in match.groupdict().items()}
        rows[row["id"]] = row
    return rows


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def generated() -> dict[str, Any]:
    source_v2 = load_json(V2_LEDGER)
    inherited = deepcopy(source_v2.get("items", []))
    rows = v3_rows()
    existing = load_json(LEDGER)
    existing_by_id = {
        str(item.get("id")): item
        for item in existing.get("items", [])
        if isinstance(item, dict)
    }

    for item in inherited:
        for evidence in item.get("evidence", []):
            artifact = evidence.get("artifact")
            if artifact in MOVED_V2_ARTIFACTS:
                evidence["artifact"] = MOVED_V2_ARTIFACTS[artifact]
        override = rows.get(str(item["id"]))
        if override:
            item["description"] = override["description"]
            item["acceptance"] = override["acceptance"]
        old = existing_by_id.get(str(item["id"]))
        if old and old.get("status") in VALID_STATUS:
            item["status"] = old["status"]
            item["evidence"] = deepcopy(old.get("evidence", item.get("evidence", [])))
            item["blockers"] = deepcopy(old.get("blockers", item.get("blockers", [])))
        seeded = LOCAL_V3_EVIDENCE.get(str(item["id"]))
        if seeded and item.get("status") == "unverified":
            item["status"] = "local_pass"
            item["evidence"] = deepcopy(seeded)

    added: list[dict[str, Any]] = []
    for module in range(11, 17):
        for feature in range(1, 5):
            item_id = f"M{module:02d}-F{feature:02d}"
            source = rows[item_id]
            old = existing_by_id.get(item_id, {})
            seeded = LOCAL_V3_EVIDENCE.get(item_id)
            old_status = old.get("status", "unverified")
            old_evidence = old.get(
                "evidence", deepcopy(PARTIAL_M11_EVIDENCE.get(item_id, []))
            )
            if seeded and old_status == "unverified":
                old_status = "local_pass"
                old_evidence = deepcopy(seeded)
            added.append(
                {
                    "id": item_id,
                    "change": "V3新增",
                    "description": source["description"],
                    "acceptance": source["acceptance"],
                    "module": f"M{module:02d}",
                    "status": old_status,
                    "evidence": old_evidence,
                    "blockers": old.get("blockers", []),
                }
            )

    versions = deepcopy(source_v2.get("versions", {}))
    versions["protocol_schema"] = "2.0.0"
    versions["session_event_profile"] = "session-events/1"
    return {
        "schema_version": 1,
        "plan": str(PLAN.relative_to(ROOT)).replace("\\", "/"),
        "expected_count": 104,
        "inherits": str(V2_LEDGER.relative_to(ROOT)).replace("\\", "/"),
        "release_gate": {
            "required_full_pass": 104,
            "allow_blocked": False,
            "required_systems": sorted(REQUIRED_FULL_EVIDENCE),
            "stability_duration_seconds": 3600,
        },
        "versions": versions,
        "items": [*inherited, *added],
    }


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    items = data.get("items")
    if not isinstance(items, list):
        return ["ledger items must be an array"]
    if len(items) != 104:
        errors.append(f"ledger must contain 104 features, found {len(items)}")
    ids = [str(item.get("id")) for item in items if isinstance(item, dict)]
    expected = [
        *(f"M{module:02d}-F{feature:02d}" for module in range(1, 11) for feature in range(1, 9)),
        *(f"M{module:02d}-F{feature:02d}" for module in range(11, 17) for feature in range(1, 5)),
    ]
    if ids != expected:
        errors.append("ledger feature ids/order drift from the cumulative V3 plan")
    if len(ids) != len(set(ids)):
        errors.append("ledger contains duplicate feature ids")
    for item in items:
        if not isinstance(item, dict):
            errors.append("ledger item must be an object")
            continue
        status = item.get("status")
        if status not in VALID_STATUS:
            errors.append(f"{item.get('id')}: invalid status {status!r}")
        evidence = item.get("evidence")
        blockers = item.get("blockers")
        if not isinstance(evidence, list) or not all(isinstance(row, dict) for row in evidence):
            errors.append(f"{item.get('id')}: evidence must be an object array")
            continue
        if not isinstance(blockers, list) or not all(isinstance(row, str) for row in blockers):
            errors.append(f"{item.get('id')}: blockers must be a string array")
        kinds = {str(row.get("kind")) for row in evidence}
        if status == "local_pass" and "automated_test" not in kinds:
            errors.append(f"{item.get('id')}: local_pass requires automated_test evidence")
        if status == "full_pass":
            missing = REQUIRED_FULL_EVIDENCE - kinds
            if missing:
                errors.append(f"{item.get('id')}: full_pass missing {sorted(missing)}")
            if blockers:
                errors.append(f"{item.get('id')}: full_pass cannot retain blockers")
        for row in evidence:
            artifact = row.get("artifact")
            if isinstance(artifact, str) and not artifact.startswith(("https://", "ai-dev:")):
                if not (ROOT / artifact).exists():
                    errors.append(f"{item.get('id')}: evidence artifact missing: {artifact}")
    if data.get("expected_count") != 104:
        errors.append("expected_count must be 104")
    gate = data.get("release_gate", {})
    if gate.get("required_full_pass") != 104:
        errors.append("release gate must require 104 full_pass items")
    if gate.get("stability_duration_seconds") != 3600:
        errors.append("release gate must require the full 1-hour stability window")
    if SECRET_PATTERN.search(json.dumps(data, ensure_ascii=False)):
        errors.append("ledger contains a likely secret")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-release-ready", action="store_true")
    arguments = parser.parse_args()
    expected = generated()
    if arguments.check:
        if load_json(LEDGER) != expected:
            raise SystemExit("V3 acceptance ledger drift; regenerate it")
    else:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        LEDGER.write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    errors = validate(expected)
    counts = {
        status: sum(item["status"] == status for item in expected["items"])
        for status in sorted(VALID_STATUS)
    }
    if arguments.require_release_ready and counts["full_pass"] != 104:
        errors.append(f"release blocked: full_pass={counts['full_pass']}/104")
    if errors:
        raise SystemExit("\n".join(errors))
    print(json.dumps({"valid": True, "counts": counts}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
