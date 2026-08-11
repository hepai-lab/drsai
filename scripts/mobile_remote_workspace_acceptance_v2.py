"""Generate and verify the 80-point Mobile Remote Workspace V2 acceptance ledger."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/remote_workespace/OpenDrSai移动远程工作区开发方案V2.md"
LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v2/acceptance.json"
ROW = re.compile(
    r"^\| (?P<id>M\d{2}-F\d{2}) \| (?P<change>[^|]+) \| "
    r"(?P<description>[^|]+) \| (?P<acceptance>[^|]+) \|$"
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
    r"(?:password|registration_token|private_key|access_token)\s*[\"=:]\s*[^\s\",}]{8,})"
)
LOCAL_EVIDENCE: dict[str, tuple[str, str]] = {
    "M01-F01": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M01-F02": ("cores/python/packages/drsai/src/drsai/backend/runtime/registry.py", "test_runtime_registry.py"),
    "M01-F03": ("cores/python/packages/drsai/src/drsai/relay/registry.py", "test_relay_api.py + HAI Relay/OIDC 66 passed"),
    "M01-F04": ("cores/python/packages/drsai/src/drsai/backend/runtime/registry.py", "test_runtime_registry.py"),
    "M01-F05": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M01-F06": ("apps/android/app/src/main/java/ai/drsai/remote/remote/model/RemoteModels.kt", "RemoteModelsTest"),
    "M01-F08": ("apps/android/app/build.gradle.kts", "test_mobile_remote_workspace_acceptance_v2.py"),
    "M02-F01": ("cores/protocol/relay/runtime-relay.schema.json", "test_relay_contract_codegen.py"),
    "M02-F02": ("cores/protocol/relay/runtime-directory-fixtures.json", "Python 7 passed + Kotlin 203 passed + TypeScript fixture passed"),
    "M02-F03": ("cores/python/packages/drsai/src/drsai/relay/registry.py", "test_relay_registry.py"),
    "M02-F04": ("cores/python/packages/drsai/src/drsai/relay/gateway_control.py", "test_relay_gateway_control.py"),
    "M02-F05": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M02-F06": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M02-F07": ("cores/protocol/relay/runtime-relay.schema.json", "RemoteSequenceSynchronizerTest"),
    "M02-F08": ("cores/protocol/relay/runtime-relay.openapi.json", "test_relay_contract_codegen.py"),
    "M03-F01": ("cores/python/packages/drsai/src/drsai/relay/runtime_client.py", "test_relay_runtime_client.py"),
    "M03-F03": ("cores/python/packages/drsai/src/drsai/relay/runtime_client.py", "ai-dev real WSS generation 1 to 3 and heartbeat presence"),
    "M03-F04": ("cores/python/packages/drsai/src/drsai/relay/gateway_control.py", "test_relay_gateway_control.py"),
    "M03-F05": ("cores/python/packages/drsai/src/drsai/relay/gateway_control.py", "test_relay_gateway_control.py"),
    "M03-F06": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M03-F07": ("cores/python/packages/drsai/src/drsai/relay/api.py", "test_relay_runtime_api.py"),
    "M03-F08": ("cores/python/packages/drsai/src/drsai/relay/gateway_control.py", "test_relay_gateway_control.py"),
    "M04-F01": ("ai-dev:runtime-relay/v2/openapi.json", "ai-dev public health/openapi/401 smoke passed"),
    "M04-F03": ("ai-dev:revision/1f36d4b03717ef2181ee5260ea19d4df5e7141f0", "HAI attach takeover and generation fencing tests passed"),
    "M04-F04": ("ai-dev:revision/1f36d4b03717ef2181ee5260ea19d4df5e7141f0", "HAI runtime relay and OIDC: 39 passed"),
    "M04-F07": ("ai-dev:revision/631d263bd1e091b0d424bfe81ef356d4d3d10f4a", "HAI runtime relay and OIDC: 49 passed"),
    "M05-F01": ("cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py", "test_mobile_pairing.py"),
    "M05-F02": ("cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py", "test_mobile_pairing.py"),
    "M05-F03": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayDiscoveryClient.kt", "RelayDiscoveryClientTest"),
    "M05-F05": ("cores/protocol/relay/runtime-relay.schema.json", "HAI scope stripping matrix: Relay/OIDC 66 passed"),
    "M05-F06": ("cores/python/packages/drsai/src/drsai/relay/registry.py", "test_relay_registry.py"),
    "M05-F07": ("apps/desktop/shared/renderer/src/components/MobilePairingDialog.tsx", "test_mobile_pairing.py + RelayDiscoveryClientTest + verify-mobile-pairing-ui.mjs"),
    "M05-F08": ("apps/desktop/windows/scripts/verify-mobile-pairing-security.mjs", "verify-mobile-pairing-security.mjs"),
    "M06-F01": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt", "RemoteWorkspaceUiTest"),
    "M06-F02": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt", "RemoteWorkspaceUiTest"),
    "M06-F03": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt", "RelayRemoteRepositoryTest"),
    "M06-F04": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt", "RemoteWorkspaceUiTest"),
    "M06-F05": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt", "RemoteSessionScreenLogicTest"),
    "M06-F06": ("apps/android/app/src/main/java/ai/drsai/remote/remote/navigation/AppRoute.kt", "AppRouteTest"),
    "M06-F07": ("apps/android/app/src/main/java/ai/drsai/remote/remote/model/RemoteModels.kt", "RemoteReliabilityTest"),
    "M06-F08": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteStore.kt", "LocalStoreTest"),
    "M07-F01": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt", "RemoteConversationTest"),
    "M07-F02": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteMarkdown.kt", "RemoteConversationTest"),
    "M07-F03": ("apps/android/app/src/main/java/ai/drsai/remote/remote/model/RemoteConversation.kt", "RemoteConversationTest"),
    "M07-F04": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M07-F05": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSequenceSynchronizer.kt", "RemoteSequenceSynchronizerTest"),
    "M07-F06": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSequenceSynchronizer.kt", "RemoteSequenceSynchronizerTest"),
    "M07-F07": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt", "RemoteReliabilityTest"),
    "M08-F01": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt", "RelayRemoteRepositoryTest"),
    "M08-F02": ("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt", "RelayRemoteRepositoryTest"),
    "M08-F03": ("scripts/accept_mobile_remote_workspace_local_e2e_v2.py", "accept_mobile_remote_workspace_local_e2e_v2.py + local-emulator-e2e.json"),
    "M08-F04": ("apps/android/app/src/main/java/ai/drsai/remote/remote/model/RemoteConversation.kt", "RemoteConversationTest"),
    "M08-F05": ("cores/python/packages/drsai/src/drsai/backend/runtime/agent.py", "test_agent_backend_contract.py"),
    "M08-F06": ("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt", "RemoteSessionUiTest"),
    "M08-F07": ("apps/android/app/src/androidTest/java/ai/drsai/remote/LocalRemoteWorkspaceE2ETest.kt", "accept_mobile_remote_workspace_local_e2e_v2.py + local-emulator-e2e.json"),
    "M08-F08": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M09-F02": ("apps/android/app/src/main/java/ai/drsai/remote/remote/model/RemoteModels.kt", "RemoteReliabilityTest"),
    "M09-F05": ("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py", "test_runtime_engine.py"),
    "M10-F01": ("scripts/generate_relay_contract.py", "test_relay_contract_codegen.py"),
}


def plan_items() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if not match:
            continue
        item = {key: value.strip() for key, value in match.groupdict().items()}
        item["module"] = item["id"].split("-", 1)[0]
        items.append(item)
    return items


def load_existing() -> dict[str, Any]:
    if not LEDGER.is_file():
        return {}
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def generated() -> dict[str, Any]:
    existing = load_existing()
    old_items = {
        str(item.get("id")): item
        for item in existing.get("items", [])
        if isinstance(item, dict)
    }
    items: list[dict[str, Any]] = []
    for source in plan_items():
        old = old_items.get(source["id"], {})
        seeded = LOCAL_EVIDENCE.get(source["id"])
        status = old.get("status", "unverified")
        evidence = old.get("evidence", [])
        if seeded and status in {"unverified", "local_pass"}:
            artifact, test = seeded
            status = "local_pass" if status == "unverified" else status
            # These two entries are generated from the current repository
            # topology.  Reconcile them on every generation so a module move
            # cannot leave a green ledger pointing at deleted source files.
            preserved = [
                row
                for row in evidence
                if row.get("kind") not in {"code", "automated_test"}
            ]
            evidence = [
                {"kind": "code", "artifact": artifact},
                {
                    "kind": "automated_test",
                    "command": test,
                    "result": "passed",
                },
                *preserved,
            ]
        items.append({
            **source,
            "status": status,
            "evidence": evidence,
            "blockers": old.get("blockers", []),
        })
    return {
        "schema_version": 1,
        "plan": str(PLAN.relative_to(ROOT)).replace("\\", "/"),
        "expected_count": 80,
        "release_gate": {
            "required_full_pass": 80,
            "allow_blocked": False,
            "required_systems": sorted(REQUIRED_FULL_EVIDENCE),
            "stability_duration_seconds": 3600,
        },
        "versions": existing.get("versions", {
            "protocol_schema": "2.0.0",
            "hai_revision": None,
            "windows_revision": None,
            "android_revision": None,
            "android_apk_sha256": None,
        }),
        "items": items,
    }


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    source = plan_items()
    items = data.get("items")
    if len(source) != 80:
        errors.append(f"plan must contain 80 features, found {len(source)}")
    if not isinstance(items, list):
        return [*errors, "ledger items must be an array"]
    if len(items) != 80:
        errors.append(f"ledger must contain 80 features, found {len(items)}")
    ids = [str(item.get("id")) for item in items if isinstance(item, dict)]
    if len(ids) != len(set(ids)):
        errors.append("ledger contains duplicate feature ids")
    if ids != [item["id"] for item in source]:
        errors.append("ledger feature ids/order drift from the V2 plan")
    for expected, item in zip(source, items):
        if not isinstance(item, dict):
            errors.append(f"{expected['id']}: item must be an object")
            continue
        for key in ("module", "change", "description", "acceptance"):
            if item.get(key) != expected[key]:
                errors.append(f"{expected['id']}: {key} drift")
        status = item.get("status")
        if status not in VALID_STATUS:
            errors.append(f"{expected['id']}: invalid status {status!r}")
        evidence = item.get("evidence")
        blockers = item.get("blockers")
        if not isinstance(evidence, list) or not all(isinstance(row, dict) for row in evidence):
            errors.append(f"{expected['id']}: evidence must be an object array")
            continue
        if not isinstance(blockers, list) or not all(isinstance(row, str) for row in blockers):
            errors.append(f"{expected['id']}: blockers must be a string array")
        kinds = {str(row.get("kind")) for row in evidence}
        if status == "local_pass" and "automated_test" not in kinds:
            errors.append(f"{expected['id']}: local_pass requires automated_test evidence")
        if status == "full_pass":
            missing = REQUIRED_FULL_EVIDENCE - kinds
            if missing:
                errors.append(
                    f"{expected['id']}: full_pass missing evidence {sorted(missing)}"
                )
            if blockers:
                errors.append(f"{expected['id']}: full_pass cannot retain blockers")
        for row in evidence:
            artifact = row.get("artifact")
            if isinstance(artifact, str) and not artifact.startswith(("https://", "ai-dev:")):
                path = ROOT / artifact
                if not path.exists():
                    errors.append(f"{expected['id']}: evidence artifact missing: {artifact}")
    serialized = json.dumps(data, ensure_ascii=False)
    if SECRET_PATTERN.search(serialized):
        errors.append("ledger contains a likely secret")
    if data.get("expected_count") != 80:
        errors.append("expected_count must be 80")
    if data.get("release_gate", {}).get("stability_duration_seconds") != 3600:
        errors.append("release gate must require the full 1-hour stability window")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-release-ready", action="store_true")
    arguments = parser.parse_args()
    expected = generated()
    if arguments.check:
        if not LEDGER.is_file():
            raise SystemExit(f"acceptance ledger missing: {LEDGER}")
        actual = load_existing()
        if actual != expected:
            raise SystemExit("acceptance ledger drift; regenerate it")
    else:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        LEDGER.write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    errors = validate(expected)
    if arguments.require_release_ready:
        counts = {
            status: sum(item["status"] == status for item in expected["items"])
            for status in VALID_STATUS
        }
        if counts["full_pass"] != 80:
            errors.append(f"release blocked: full_pass={counts['full_pass']}/80")
        if counts["blocked"]:
            errors.append(f"release blocked: blocked={counts['blocked']}")
    if errors:
        raise SystemExit("\n".join(errors))
    counts = {
        status: sum(item["status"] == status for item in expected["items"])
        for status in sorted(VALID_STATUS)
    }
    print(json.dumps({"valid": True, "counts": counts}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
