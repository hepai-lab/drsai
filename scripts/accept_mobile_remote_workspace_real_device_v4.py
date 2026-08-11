"""Collect a sanitized three-client OAEP convergence proof for V4."""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from accept_mobile_remote_workspace_real_device_v2 import GatewayPairingClient, capture_screenshot, phase


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.oaep.digest import oaep_items_digest  # noqa: E402
from drsai.oaep.protocol import OAEPProtocol  # noqa: E402


def parse_adb_devices(stdout: str) -> list[dict[str, str]]:
    devices: list[dict[str, str]] = []
    for line in stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            devices.append({
                "serial": parts[0],
                "state": parts[1],
                "kind": "emulator" if parts[0].startswith("emulator-") else "physical",
            })
    return devices


def require_physical_android_device(adb: str, serial: str) -> dict[str, str]:
    if not serial:
        raise RuntimeError("v4_android_device_serial_required")
    executable = shutil.which(adb) or (adb if Path(adb).is_file() else None)
    if executable is None:
        raise RuntimeError("v4_adb_not_found")
    completed = subprocess.run(
        [executable, "devices"],
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=15,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("v4_adb_devices_failed")
    matches = [device for device in parse_adb_devices(completed.stdout) if device["serial"] == serial]
    if not matches:
        raise RuntimeError("v4_physical_android_device_missing")
    device = matches[0]
    if device["state"] != "device":
        raise RuntimeError("v4_android_device_not_authorized")
    if device["kind"] != "physical":
        raise RuntimeError("v4_physical_android_device_required")
    return device


def desktop_digest(snapshot: dict[str, Any]) -> str:
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "apps/desktop/windows/scripts/digest-oaep-items.mts")],
        cwd=ROOT / "apps/desktop/windows",
        input=json.dumps({"items": snapshot.get("items")}, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=30,
        check=False,
    )
    value = completed.stdout.strip()
    if completed.returncode or len(value) != 64:
        raise RuntimeError("v4_windows_oaep_digest_failed")
    return value


def validate_oaep_proof(
    snapshot: dict[str, Any], android: dict[str, Any], windows_sha256: str
) -> dict[str, Any]:
    OAEPProtocol().validate_snapshot(snapshot)
    runtime_sha256 = oaep_items_digest(snapshot["items"])
    if not (
        android.get("protocol") == "oaep/1"
        and android.get("schema_hash") == OAEPProtocol().schema_hash
        and android.get("oaep_sha256") == runtime_sha256 == windows_sha256
        and android.get("snapshot_sequence") == snapshot["snapshot_sequence"]
        and int(android.get("duplicate_sequence_count", -1)) == 0
        and int(android.get("missing_sequence_count", -1)) == 0
    ):
        raise RuntimeError("v4_oaep_convergence_invalid")
    return {
        "name": "oaep_hash_convergence",
        "status": "passed",
        "runtime_sha256": runtime_sha256,
        "windows_sha256": windows_sha256,
        "android_sha256": android["oaep_sha256"],
        "schema_hash": android["schema_hash"],
        "snapshot_sequence": snapshot["snapshot_sequence"],
        "item_count": len(snapshot["items"]),
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }


def _is_safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or normalized.startswith("//"):
        return False
    if len(normalized) >= 3 and normalized[1] == ":" and normalized[2] == "/" and normalized[0].isalpha():
        return False
    return all(part not in {"", ".", ".."} for part in normalized.split("/"))


def file_change_stats(snapshot: dict[str, Any]) -> dict[str, Any]:
    file_change_count = 0
    unsafe_path_count = 0
    sensitive_field_count = 0
    forbidden = {
        "content", "raw_content", "absolute_path", "full_path", "local_path",
        "cwd", "token", "secret",
    }
    for item in snapshot.get("items", []):
        if not isinstance(item, dict) or item.get("type") != "file_change":
            continue
        content = item.get("content")
        changes = content.get("changes") if isinstance(content, dict) else None
        if not isinstance(changes, list):
            continue
        for change in changes:
            if not isinstance(change, dict):
                continue
            file_change_count += 1
            sensitive_field_count += sum(1 for key in change if key in forbidden)
            for key in ("path", "old_path", "new_path"):
                if key in change and not _is_safe_relative_path(change.get(key)):
                    unsafe_path_count += 1
    return {
        "file_change_count": file_change_count,
        "safe_relative_paths": (
            file_change_count > 0
            and unsafe_path_count == 0
            and sensitive_field_count == 0
        ),
        "absolute_path_count": unsafe_path_count,
        "sensitive_field_count": sensitive_field_count,
    }


def validate_file_change_proof(snapshot: dict[str, Any], android: dict[str, Any]) -> dict[str, Any]:
    runtime = file_change_stats(snapshot)
    for key, expected in runtime.items():
        if android.get(key) != expected:
            raise RuntimeError("v4_file_change_safe_paths_invalid")
    if not runtime["safe_relative_paths"]:
        raise RuntimeError("v4_file_change_safe_paths_invalid")
    return {
        "name": "file_change_safe_paths",
        "status": "passed",
        **runtime,
    }


async def collect(args: argparse.Namespace) -> dict[str, Any]:
    client = GatewayPairingClient(args.gateway_url, args.token_path)
    snapshot = await client._request("GET", f"/v1/sessions/{args.session_id}/oaep-snapshot")  # noqa: SLF001
    proof = phase(
        args,
        "oaep-session-proof",
        extras={
            "verifyWorkspaceId": args.workspace_id,
            "verifySessionId": args.session_id,
            "expectedSourceMessageIds": ",".join(args.expected_source_message_id),
            "expectedRunCount": str(args.expected_run_count),
        },
    )
    if proof is None:
        raise RuntimeError("v4_android_oaep_proof_missing")
    check = validate_oaep_proof(snapshot, proof, desktop_digest(snapshot))
    file_check = validate_file_change_proof(snapshot, proof)
    check.update(capture_screenshot(args, "oaep-convergence"))
    return {
        "schema_version": 1,
        "passed": True,
        "protocol": "oaep/1",
        "checks": [check, file_check],
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path.home() / ".drsai"
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--expected-source-message-id", action="append", required=True)
    parser.add_argument("--expected-run-count", type=int, default=4)
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/")
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.acceptance")
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--phase-timeout-seconds", type=int, default=120)
    parser.add_argument("--output", type=Path, default=ROOT / "release/product-evidence/mobile-remote-workspace-v4/oaep-convergence.json")
    args = parser.parse_args()
    if args.expected_run_count < 1:
        raise SystemExit("expected run count must be positive")
    require_physical_android_device(args.adb, args.device)
    report = asyncio.run(collect(args))
    atomic_json(args.output, report)
    print(json.dumps({"passed": True, "artifact": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
