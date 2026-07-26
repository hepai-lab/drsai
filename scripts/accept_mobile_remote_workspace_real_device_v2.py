"""Real OIDC/Android/ai-dev/Windows acceptance driver for Remote Workspace V2.

The Android access token and one-time grant code never enter the report. The
grant payload is passed directly to ADB and discarded after consumption.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import aiohttp

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

TEST_CLASS = (
    "ai.drsai.remote.RealRemoteWorkspaceE2ETest"
    "#authenticatedCatalogPhaseIsFailClosedAndProducesSanitizedProof"
)


@dataclass(frozen=True)
class GatewayGrant:
    grant_id: str
    status: str
    expires_at: datetime
    payload: str | None = None


class GatewayPairingClient:
    """Use the live Full Runtime as the sole owner of its DPAPI credential."""

    def __init__(
        self,
        base_url: str,
        token_path: Path,
        *,
        timeout_seconds: int = 15,
        session_factory: Any = aiohttp.ClientSession,
    ) -> None:
        parsed = urlparse(base_url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or
                parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise RuntimeError("gateway_pairing_url_must_be_loopback")
        token = token_path.read_text(encoding="utf-8").strip()
        if not (32 <= len(token) <= 128 and all(c.isalnum() or c in "_-" for c in token)):
            raise RuntimeError("gateway_instance_token_invalid")
        self.root = base_url.rstrip("/")
        self.headers = {"X-OpenDrSai-Gateway-Token": token}
        self.timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        self.session_factory = session_factory

    async def _request(
        self, method: str, path: str, json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        async with self.session_factory(timeout=self.timeout) as session:
            request_args: dict[str, Any] = {"headers": self.headers}
            if json_body is not None:
                request_args["json"] = json_body
            async with session.request(
                method, self.root + path, **request_args
            ) as response:
                body = await response.json(content_type=None)
                if response.status >= 400:
                    code = (
                        body.get("detail", {}).get("code")
                        if isinstance(body, dict) and isinstance(body.get("detail"), dict)
                        else "gateway_pairing_request_failed"
                    )
                    raise RuntimeError(f"gateway_pairing_request_failed:{response.status}:{code}")
                if not isinstance(body, dict):
                    raise RuntimeError("gateway_pairing_response_invalid")
                return body

    async def readiness(self) -> dict[str, Any]:
        return await self._request("GET", "/v1/mobile-pairing/status")

    async def workspace_lifecycle_counts(self) -> dict[str, int]:
        body = await self._request(
            "GET", "/v1/mobile-pairing/diagnostics/workspace-lifecycles"
        )
        counts = body.get("counts")
        if set(body) != {"counts", "total"} or not isinstance(counts, dict):
            raise RuntimeError("gateway_workspace_catalog_invalid")
        if (
            set(counts) != {"active", "archived", "removed"}
            or any(not isinstance(value, int) or value < 0 for value in counts.values())
            or body.get("total") != sum(counts.values())
        ):
            raise RuntimeError("gateway_workspace_catalog_invalid")
        return {key: counts[key] for key in ("active", "archived", "removed")}

    async def create_lifecycle_fixture(self, path: Path, lifecycle: str) -> None:
        if lifecycle not in {"archived", "removed"}:
            raise RuntimeError("gateway_workspace_fixture_lifecycle_invalid")
        opened = await self._request("POST", "/v1/workspaces", {"path": str(path)})
        workspace_id = opened.get("workspace_id")
        if not isinstance(workspace_id, str) or not workspace_id:
            raise RuntimeError("gateway_workspace_fixture_invalid")
        if lifecycle == "archived":
            transitioned = await self._request("DELETE", f"/v1/workspaces/{workspace_id}")
        else:
            transitioned = await self._request(
                "POST", f"/v1/workspaces/{workspace_id}/remove"
            )
        if transitioned.get("lifecycle") != lifecycle:
            raise RuntimeError("gateway_workspace_fixture_transition_invalid")

    @staticmethod
    def _grant(body: dict[str, Any]) -> GatewayGrant:
        try:
            expires_at = datetime.fromisoformat(str(body["expires_at"]).replace("Z", "+00:00"))
            grant_id, status = str(body["grant_id"]), str(body["status"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("gateway_pairing_grant_invalid") from exc
        if status not in {"pending", "consumed", "expired", "revoked"}:
            raise RuntimeError("gateway_pairing_grant_invalid")
        payload = body.get("payload")
        return GatewayGrant(grant_id, status, expires_at, str(payload) if payload is not None else None)

    async def create(self) -> GatewayGrant:
        return self._grant(await self._request("POST", "/v1/mobile-pairing/grants"))

    async def read(self, grant_id: str) -> GatewayGrant:
        return self._grant(await self._request("GET", f"/v1/mobile-pairing/grants/{grant_id}"))

    async def revoke(self, grant_id: str) -> GatewayGrant:
        return self._grant(await self._request("DELETE", f"/v1/mobile-pairing/grants/{grant_id}"))

    async def shutdown_runtime(self) -> None:
        body = await self._request("POST", "/v1/runtime/shutdown")
        if body.get("stopping") is not True:
            raise RuntimeError("gateway_runtime_shutdown_rejected")

    async def inject_connection_owner_restart(
        self, ttl_seconds: int = 5,
    ) -> dict[str, Any]:
        body = await self._request(
            "POST",
            "/v1/mobile-pairing/fault-injections/connection-owner-restart",
            {"ttl_seconds": ttl_seconds},
        )
        recovery = body.get("recovery")
        generation = body.get("generation")
        if (
            body.get("runtime_id") is None
            or body.get("status") != "scheduled"
            or not isinstance(generation, int)
            or generation < 1
            or not isinstance(recovery, dict)
            or recovery.get("required_generation") != generation + 1
            or recovery.get("route_available_after_ttl") is not True
            or recovery.get("presence_required") is not True
            or recovery.get("event_replay_preserved") is not True
        ):
            raise RuntimeError("gateway_relay_fault_response_invalid")
        return body


async def wait_gateway(
    client: GatewayPairingClient,
    *,
    expected_ready: bool,
    timeout_seconds: int,
) -> dict[str, Any] | None:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        try:
            last = await client.readiness()
            if expected_ready and last.get("state") == "ready":
                return last
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, RuntimeError):
            if not expected_ready:
                return None
        await asyncio.sleep(0.5)
    state = last.get("state") if isinstance(last, dict) else "unreachable"
    raise RuntimeError(f"gateway_wait_timeout:{'ready' if expected_ready else 'offline'}:{state}")


async def ensure_lifecycle_evidence(
    args: argparse.Namespace,
    service: GatewayPairingClient,
) -> dict[str, int]:
    counts = await service.workspace_lifecycle_counts()
    fixture_root = args.output.parent / ".runtime-lifecycle-fixtures"
    for lifecycle in ("archived", "removed"):
        if counts[lifecycle] > 0:
            continue
        fixture = fixture_root / f"{lifecycle}-{uuid4().hex}"
        fixture.mkdir(parents=True, exist_ok=False)
        try:
            await service.create_lifecycle_fixture(fixture, lifecycle)
        finally:
            fixture.rmdir()
    if fixture_root.is_dir() and not any(fixture_root.iterdir()):
        fixture_root.rmdir()
    counts = await service.workspace_lifecycle_counts()
    if counts["active"] < 2 or counts["archived"] < 1 or counts["removed"] < 1:
        raise RuntimeError("real_device_workspace_lifecycle_fixture_incomplete")
    return counts


def start_runtime(args: argparse.Namespace) -> subprocess.Popen[Any]:
    token_path = args.state_root / "runtime" / "instance-token"
    token = token_path.read_text(encoding="utf-8").strip()
    parsed = urlparse(args.gateway_url)
    port = parsed.port
    if port is None:
        raise RuntimeError("gateway_pairing_port_required")
    environment = os.environ.copy()
    environment.update({
        "DRSAI_API_HOST": "127.0.0.1",
        "DRSAI_API_PORT": str(port),
        "DRSAI_HOME": str(args.state_root),
        "OPENDRSAI_GATEWAY_INSTANCE_TOKEN": token,
        "OPENDRSAI_RUNTIME_VERSION": args.runtime_version,
        "PYTHONPATH": os.pathsep.join(filter(None, [
            str(SOURCE), environment.get("PYTHONPATH", ""),
        ])),
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    stdout_path = args.output.parent / "real-runtime-restart.stdout.log"
    stderr_path = args.output.parent / "real-runtime-restart.stderr.log"
    with stdout_path.open("ab") as stdout, stderr_path.open("ab") as stderr:
        return subprocess.Popen(
            [args.runtime_python, "-m", "drsai.backend.gateway"],
            cwd=ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )


def adb(args: argparse.Namespace, *command: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [args.adb, "-s", args.device, *command],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def adb_shell_quote(value: str) -> str:
    """Quote one value for the remote Android shell used by ``adb shell``."""
    return shlex.quote(value)


def open_android_route(args: argparse.Namespace, uri: str) -> None:
    launched = adb(
        args,
        "shell", "am", "start", "-W",
        "-a", "android.intent.action.VIEW",
        "-d", adb_shell_quote(uri),
        "-p", args.package,
    )
    if launched.returncode or "Status: ok" not in launched.stdout:
        raise RuntimeError("real_device_route_launch_failed")


def capture_screenshot(args: argparse.Namespace, name: str) -> dict[str, str]:
    """Capture a real-device PNG and return only its relative path and digest."""
    if not name or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in name):
        raise RuntimeError("real_device_screenshot_name_invalid")
    completed = subprocess.run(
        [args.adb, "-s", args.device, "exec-out", "screencap", "-p"],
        check=False,
        capture_output=True,
        timeout=args.phase_timeout_seconds,
    )
    if completed.returncode or not completed.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"real_device_screenshot_{name}_failed")
    path = args.output.parent / f"real-device-{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".png.tmp")
    temporary.write_bytes(completed.stdout)
    temporary.replace(path)
    try:
        artifact = path.resolve().relative_to(ROOT.resolve())
    except ValueError as exc:
        raise RuntimeError("real_device_screenshot_outside_workspace") from exc
    return {
        "screenshot_artifact": str(artifact).replace("\\", "/"),
        "screenshot_sha256": hashlib.sha256(completed.stdout).hexdigest(),
    }


def phase(
    args: argparse.Namespace,
    name: str,
    *,
    expect_success: bool = True,
    extras: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    instrumentation_extras = [
        value
        for key, value in (extras or {}).items()
        for value in ("-e", key, adb_shell_quote(value))
    ]
    result = adb(
        args,
        "shell", "am", "instrument", "-w", "-r",
        "-e", "class", adb_shell_quote(TEST_CLASS),
        "-e", "phase", adb_shell_quote(name),
        "-e", "runtimeId", adb_shell_quote(args.runtime_id),
        "-e", "relayBaseUrl", adb_shell_quote(args.base_url),
        *instrumentation_extras,
        f"{args.package}.test/androidx.test.runner.AndroidJUnitRunner",
        timeout=(
            getattr(args, "interaction_timeout_seconds", args.phase_timeout_seconds)
            if name == "interaction"
            else args.phase_timeout_seconds
        ),
    )
    succeeded = result.returncode == 0 and "OK (1 test)" in result.stdout
    if expect_success != succeeded:
        diagnostic = "expected_success" if expect_success else "expected_failure"
        raise RuntimeError(f"real_device_phase_{name}_{diagnostic}_mismatch")
    if not succeeded:
        return None
    prefixes = (
        "OPENDRSAI_REAL_DEVICE_PROOF=",
        "INSTRUMENTATION_STATUS: realDeviceProof=",
    )
    encoded = next(
        (
            line.split(prefix, 1)[1].strip()
            for line in result.stdout.splitlines()
            for prefix in prefixes
            if prefix in line
        ),
        None,
    )
    if encoded is None:
        raise RuntimeError(f"real_device_phase_{name}_proof_missing")
    proof = json.loads(encoded)
    if proof.get("phase") != name:
        raise RuntimeError(f"real_device_phase_{name}_proof_mismatch")
    return proof


async def create_and_consume_grant(
    args: argparse.Namespace, service: Any
) -> dict[str, Any]:
    grant = await service.create()
    if not grant.payload:
        raise RuntimeError("real_device_pairing_payload_missing")
    launched = adb(
        args,
        "shell", "am", "start", "-W",
        "-a", "android.intent.action.VIEW",
        "-d", adb_shell_quote(grant.payload),
        "-p", args.package,
    )
    if launched.returncode:
        await service.revoke(grant.grant_id)
        raise RuntimeError("real_device_pairing_dispatch_failed")
    deadline = time.monotonic() + args.pair_timeout_seconds
    current = grant
    while time.monotonic() < deadline:
        await asyncio.sleep(1)
        current = await service.read(grant.grant_id)
        if current.status in {"consumed", "expired", "revoked"}:
            break
    if current.status != "consumed":
        raise RuntimeError(f"real_device_pairing_{current.status}")
    return {
        "grant_id": current.grant_id,
        "status": current.status,
        "expires_at": current.expires_at.isoformat(),
    }


def network_setting(args: argparse.Namespace, key: str) -> bool:
    result = adb(args, "shell", "settings", "get", "global", key)
    if result.returncode or result.stdout.strip() not in {"0", "1"}:
        raise RuntimeError(f"real_device_network_setting_{key}_unavailable")
    return result.stdout.strip() == "1"


def set_network(args: argparse.Namespace, *, wifi: bool, data: bool) -> None:
    for kind, enabled in (("wifi", wifi), ("data", data)):
        result = adb(args, "shell", "svc", kind, "enable" if enabled else "disable")
        if result.returncode:
            raise RuntimeError(f"real_device_{kind}_toggle_failed")


async def accept(args: argparse.Namespace) -> dict[str, Any]:
    service = GatewayPairingClient(
        args.gateway_url,
        args.state_root / "runtime" / "instance-token",
        timeout_seconds=args.gateway_timeout_seconds,
    )
    readiness = await service.readiness()
    if readiness.get("state") != "ready":
        raise RuntimeError(f"Runtime pairing is not ready: {readiness.get('state')}")
    if readiness.get("runtime_id") != args.runtime_id:
        raise RuntimeError("real_device_runtime_id_mismatch")
    if adb(args, "get-state").stdout.strip() != "device":
        raise RuntimeError("real_device_adb_offline")

    started = datetime.now(UTC)
    result: dict[str, Any] = {
        "schema_version": 1,
        "started_at": started.isoformat(),
        "runtime_id": args.runtime_id,
        "device": args.device,
        "package": args.package,
        "checks": [],
        "passed": False,
    }
    phase(args, "cleanup")
    pre = phase(args, "pre")
    result["checks"].append({"name": "pre_pair_invisible", "status": "passed", **(pre or {})})
    lifecycle_counts = await ensure_lifecycle_evidence(args, service)
    first_grant = await create_and_consume_grant(args, service)
    post = phase(args, "post")
    open_android_route(args, "opendrsai://remote")
    result["checks"].append({
        "name": "pair_and_catalog",
        "status": "passed",
        "grant": first_grant,
        "runtime_authoritative_lifecycle_counts": lifecycle_counts,
        **(post or {}),
        **capture_screenshot(args, "catalog"),
    })
    interaction_id = uuid4().hex
    interaction_message = (
        "OpenDrSai mobile real-device acceptance "
        f"{interaction_id}. Use a read-only shell command to print this identifier; "
        "wait for mobile approval and do not modify files."
    )
    interaction = phase(
        args,
        "interaction",
        extras={
            "interactionWorkspaceId": args.interaction_workspace_id,
            "interactionAgentDefinitionId": args.interaction_agent_definition_id,
            "interactionId": interaction_id,
            "interactionMessage": interaction_message,
        },
    )
    if interaction is None or interaction.get("message_sha256") != __import__("hashlib").sha256(
        interaction_message.encode("utf-8")
    ).hexdigest():
        raise RuntimeError("real_device_interaction_proof_invalid")
    open_android_route(
        args,
        "opendrsai://session/"
        f"{args.runtime_id}/{interaction['workspace_id']}/{interaction['session_id']}",
    )
    result["checks"].append({
        "name": "message_stream_approval",
        "status": "passed",
        **interaction,
        **capture_screenshot(args, "interaction"),
    })

    adb(args, "shell", "input", "keyevent", "KEYCODE_HOME")
    background = phase(args, "post")
    result["checks"].append({
        "name": "background_recovery",
        "status": "passed",
        "target_visible": background.get("target_visible") if background else None,
    })
    adb(args, "shell", "am", "force-stop", args.package)
    killed = phase(args, "post")
    result["checks"].append({
        "name": "process_death_recovery",
        "status": "passed",
        "target_visible": killed.get("target_visible") if killed else None,
    })

    original_wifi = network_setting(args, "wifi_on")
    original_data = network_setting(args, "mobile_data")
    try:
        set_network(args, wifi=False, data=False)
        offline = phase(args, "offline")
        if offline is None or offline.get("network_failure") is not True:
            raise RuntimeError("real_device_offline_proof_invalid")
        result["checks"].append({
            "name": "offline_fail_closed",
            "status": "passed",
            **offline,
        })
    finally:
        set_network(args, wifi=original_wifi, data=original_data)
    deadline = time.monotonic() + args.network_recovery_timeout_seconds
    recovered = None
    while time.monotonic() < deadline:
        try:
            recovered = phase(args, "post")
            break
        except RuntimeError:
            time.sleep(2)
    if recovered is None:
        raise RuntimeError("real_device_network_recovery_timeout")
    result["checks"].append({
        "name": "network_recovery",
        "status": "passed",
        "target_visible": recovered.get("target_visible"),
    })
    await service.shutdown_runtime()
    await wait_gateway(
        service,
        expected_ready=False,
        timeout_seconds=args.runtime_restart_timeout_seconds,
    )
    restarted_process = start_runtime(args)
    restarted = await wait_gateway(
        service,
        expected_ready=True,
        timeout_seconds=args.runtime_restart_timeout_seconds,
    )
    if restarted is None or restarted.get("runtime_id") != args.runtime_id:
        raise RuntimeError("real_device_restarted_runtime_id_mismatch")
    relay_recovered = None
    deadline = time.monotonic() + args.runtime_restart_timeout_seconds
    while time.monotonic() < deadline:
        if restarted_process.poll() is not None:
            raise RuntimeError("real_device_restarted_runtime_exited")
        try:
            relay_recovered = phase(args, "post")
            break
        except RuntimeError:
            time.sleep(2)
    if relay_recovered is None:
        raise RuntimeError("real_device_runtime_relay_recovery_timeout")
    result["checks"].append({
        "name": "runtime_restart_recovery",
        "status": "passed",
        "runtime_id": restarted.get("runtime_id"),
        "process_alive": restarted_process.poll() is None,
        "target_visible": relay_recovered.get("target_visible"),
    })

    relay_fault = await service.inject_connection_owner_restart(
        args.relay_fault_ttl_seconds
    )
    if relay_fault.get("runtime_id") != args.runtime_id:
        raise RuntimeError("real_device_relay_fault_runtime_mismatch")
    relay_fault_recovered = None
    deadline = time.monotonic() + args.relay_fault_recovery_timeout_seconds
    while time.monotonic() < deadline:
        try:
            candidate = phase(args, "post")
            if (
                candidate is not None
                and int(candidate.get("runtime_generation", 0))
                >= int(relay_fault["recovery"]["required_generation"])
            ):
                relay_fault_recovered = candidate
                break
        except RuntimeError:
            time.sleep(2)
    if relay_fault_recovered is None:
        raise RuntimeError("real_device_relay_fault_recovery_timeout")
    result["checks"].append({
        "name": "relay_fault_recovery",
        "status": "passed",
        "scheduled_generation": relay_fault["generation"],
        "required_generation": relay_fault["recovery"]["required_generation"],
        "recovered_generation": relay_fault_recovered["runtime_generation"],
        "target_visible": relay_fault_recovered.get("target_visible"),
        "event_replay_preserved": relay_fault["recovery"]["event_replay_preserved"],
    })
    verified = phase(
        args,
        "verify",
        extras={
            "verifyWorkspaceId": str(interaction["workspace_id"]),
            "verifySessionId": str(interaction["session_id"]),
            "verifyRunId": str(interaction["run_id"]),
        },
    )
    if (
        verified is None
        or verified.get("terminal_status") != "completed"
        or verified.get("run_count") != 1
        or verified.get("event_count") != interaction.get("event_count")
        or verified.get("event_sha256") != interaction.get("event_sha256")
        or verified.get("conversation_sha256") != interaction.get("conversation_sha256")
        or int(verified.get("conversation_count", 0))
        < int(interaction.get("conversation_after", 0))
    ):
        raise RuntimeError("real_device_fault_integrity_mismatch")
    result["checks"][-1].update({
        "single_run_preserved": True,
        "event_count_preserved": True,
        "event_hash_preserved": True,
        "conversation_projection_preserved": True,
    })

    phase(args, "cleanup")
    revoked = phase(
        args,
        "revoked",
        extras={
            "verifyWorkspaceId": str(interaction["workspace_id"]),
            "verifySessionId": str(interaction["session_id"]),
        },
    )
    result["checks"].append({
        "name": "revocation_invisible",
        "status": "passed",
        **(revoked or {}),
    })
    second_grant = await create_and_consume_grant(args, service)
    repaired = phase(args, "post")
    result["checks"].append({
        "name": "repair_association",
        "status": "passed",
        "grant": second_grant,
        "target_visible": repaired.get("target_visible") if repaired else None,
    })
    result["passed"] = True
    result["finished_at"] = datetime.now(UTC).isoformat()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument(
        "--state-root", type=Path,
        default=Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai"))),
    )
    parser.add_argument(
        "--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/"
    )
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18643")
    parser.add_argument("--gateway-timeout-seconds", type=int, default=15)
    parser.add_argument("--runtime-python", default=sys.executable)
    parser.add_argument("--runtime-version", default="2.0.0")
    parser.add_argument("--runtime-restart-timeout-seconds", type=int, default=120)
    parser.add_argument("--interaction-workspace-id", required=True)
    parser.add_argument("--interaction-agent-definition-id", default="mobile-acceptance")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument(
        "--adb",
        default=str(Path(os.getenv("LOCALAPPDATA", "")) / "Android/Sdk/platform-tools/adb.exe"),
    )
    parser.add_argument("--phase-timeout-seconds", type=int, default=90)
    parser.add_argument("--interaction-timeout-seconds", type=int, default=420)
    parser.add_argument("--pair-timeout-seconds", type=int, default=120)
    parser.add_argument("--network-recovery-timeout-seconds", type=int, default=90)
    parser.add_argument("--relay-fault-ttl-seconds", type=int, default=5)
    parser.add_argument("--relay-fault-recovery-timeout-seconds", type=int, default=120)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = asyncio.run(accept(args))
    except Exception as error:
        report = {
            "schema_version": 1,
            "runtime_id": args.runtime_id,
            "device": args.device,
            "passed": False,
            "error": {"code": type(error).__name__, "message": str(error)},
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
