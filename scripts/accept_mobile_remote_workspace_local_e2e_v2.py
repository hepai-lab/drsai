from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import ipaddress
import json
import os
import shutil
import sqlite3
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "cores" / "python" / "packages" / "drsai" / "src"
sys.path.insert(0, str(PYTHON_SRC))

import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.relay.api import create_relay_app
from drsai.relay.gateway_control import GatewayControlError, GatewayRuntimeControlHandler
from drsai.relay.models import Workspace
from drsai.relay.registry import RelayRegistry
from drsai.relay.runtime_client import RuntimeCredential, RuntimeCredentialStore
from scan_remote_workspace_secret_canary import canary_variants, scan_artifact


class GatewayTransport:
    def __init__(self, client: TestClient, token: str) -> None:
        self.client = client
        self.token = token

    async def request(self, method, path, *, body=None, headers=None):
        response = await asyncio.to_thread(
            self.client.request,
            method,
            path,
            json=body,
            headers={"X-OpenDrSai-Gateway-Token": self.token, **(headers or {})},
        )
        result = response.json()
        if response.status_code >= 400:
            detail = result.get("detail", result)
            if not isinstance(detail, dict):
                detail = {"message": str(detail)}
            raise GatewayControlError(
                str(detail.get("code") or f"runtime_http_{response.status_code}"),
                str(detail.get("message") or detail),
                retryable=response.status_code >= 500,
            )
        return result


class DirectRuntimeChannel:
    def __init__(self, handler: GatewayRuntimeControlHandler) -> None:
        self.handler = handler

    async def request(self, runtime_id, operation, arguments):
        if runtime_id != self.handler.runtime_id:
            raise RuntimeError("runtime_scope_mismatch")
        local_arguments = {
            **arguments,
            "kwargs": dict(arguments.get("kwargs") or {}),
        }
        # The local deterministic Relay authenticates the emulator with a
        # synthetic bearer. It is not an HepAI OIDC token and must not be
        # forwarded into the Full Runtime's separate OIDC boundary.
        local_arguments["kwargs"].pop("_authorization", None)
        print(f"P5_LOCAL_RUNTIME_OPERATION_START={operation}", flush=True)
        try:
            result = await asyncio.wait_for(
                self.handler(operation, local_arguments),
                timeout=30,
            )
            print(f"P5_LOCAL_RUNTIME_OPERATION_END={operation}", flush=True)
            return result
        except TimeoutError as exc:
            print(f"P5_LOCAL_RUNTIME_OPERATION_TIMEOUT={operation}", flush=True)
            raise RuntimeError(
                f"p5_local_runtime_operation_timeout:{operation}"
            ) from exc

    async def attach(self, *_):
        return "local-e2e"


_RFC1918_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def validated_transport_host(
    transport: str,
    host_address: str | None,
    *,
    allow_insecure_private_lan: bool,
) -> ipaddress.IPv4Address:
    if transport != "lan":
        if host_address:
            raise ValueError("local_e2e_host_address_requires_lan")
        if allow_insecure_private_lan:
            raise ValueError("local_e2e_lan_consent_requires_lan")
        return ipaddress.IPv4Address("127.0.0.1")
    if not allow_insecure_private_lan:
        raise ValueError("local_e2e_insecure_private_lan_consent_required")
    try:
        candidate = ipaddress.ip_address(host_address or "")
    except ValueError as exc:
        raise ValueError("local_e2e_rfc1918_ipv4_required") from exc
    if not isinstance(candidate, ipaddress.IPv4Address) or not any(
        candidate in network for network in _RFC1918_NETWORKS
    ):
        raise ValueError("local_e2e_rfc1918_ipv4_required")
    return candidate

    async def detach(self, *_):
        return None

    def accept_response(self, *_):
        return None


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run the local Android Emulator → Relay → Windows Runtime V2 gate.")
    result.add_argument("--serial", default="emulator-5556")
    result.add_argument("--avd", default="OpenDrSai_V2_API35")
    result.add_argument("--transport", choices=("adb-reverse", "lan"), default="adb-reverse")
    result.add_argument("--host-address")
    result.add_argument(
        "--allow-insecure-private-lan",
        action="store_true",
        help=(
            "Explicitly consent to sending the one-run test bearer and grant over "
            "unencrypted RFC1918 LAN HTTP. Prefer adb-reverse."
        ),
    )
    result.add_argument(
        "--output",
        default=str(ROOT / "release" / "product-evidence" / "mobile-remote-workspace-v2" / "local-emulator-e2e.json"),
    )
    return result


def run(command: list[str], *, cwd: Path | None = None, timeout: int = 240, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def android_tools() -> tuple[Path, Path, Path, Path]:
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData" / "Local" / "Android" / "Sdk"))
    adb = sdk / "platform-tools" / "adb.exe"
    emulator = sdk / "emulator" / "emulator.exe"
    avdmanager = sdk / "cmdline-tools" / "latest" / "bin" / "avdmanager.bat"
    java_home = Path(os.environ.get("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr"))
    for path in (adb, emulator, avdmanager, java_home / "bin" / "java.exe"):
        if not path.exists():
            raise RuntimeError(f"required_tool_missing:{path.name}")
    return adb, emulator, avdmanager, java_home


def ensure_emulator(adb: Path, emulator: Path, avdmanager: Path, java_home: Path, serial: str, avd: str) -> subprocess.Popen | None:
    devices = run([str(adb), "devices"]).stdout
    if f"{serial}\tdevice" in devices:
        return None
    avds = run([str(emulator), "-list-avds"]).stdout.splitlines()
    if avd not in avds:
        environment = {**os.environ, "JAVA_HOME": str(java_home), "PATH": f"{java_home / 'bin'};{os.environ.get('PATH', '')}"}
        subprocess.run(
            [str(avdmanager), "create", "avd", "--name", avd, "--package",
             "system-images;android-35;google_apis;x86_64", "--device", "pixel_5", "--force"],
            input="no\n",
            text=True,
            check=True,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    port = serial.removeprefix("emulator-")
    process = subprocess.Popen(
        [str(emulator), "-avd", avd, "-port", port, "-no-window", "-no-audio", "-no-boot-anim",
         "-gpu", "swiftshader_indirect", "-wipe-data"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            if run([str(adb), "-s", serial, "shell", "getprop", "sys.boot_completed"], timeout=10).stdout.strip() == "1":
                return process
        except Exception:
            pass
        time.sleep(2)
    process.terminate()
    raise RuntimeError("emulator_boot_timeout")


def build_and_install(adb: Path, java_home: Path, serial: str) -> tuple[Path, Path]:
    gradle = ROOT / "apps" / "android" / "gradlew.bat"
    environment = {**os.environ, "JAVA_HOME": str(java_home)}
    subprocess.run(
        [str(gradle), ":app:assembleDebug", ":app:assembleDebugAndroidTest", "--no-daemon"],
        cwd=gradle.parent,
        env=environment,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        timeout=240,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    app_apk = next((gradle.parent / "app" / "build" / "outputs" / "apk" / "debug").glob("OpenDrSai-Android-*.apk"))
    test_apk = next((gradle.parent / "app" / "build" / "outputs" / "apk" / "androidTest" / "debug").glob("*.apk"))
    run([str(adb), "-s", serial, "install", "-r", "-t", str(app_apk)])
    run([str(adb), "-s", serial, "install", "-r", "-t", str(test_apk)])
    return app_apk, test_apk


def available_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> int:
    options = parser().parse_args()
    host_address = validated_transport_host(
        options.transport,
        options.host_address,
        allow_insecure_private_lan=options.allow_insecure_private_lan,
    )
    output = Path(options.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(UTC)
    emulator_process = None
    server = None
    server_thread = None
    windows = None
    temporary_root_cleanup: Path | None = None
    adb_tool: Path | None = None
    reverse_port: int | None = None
    report: dict[str, object] = {
        "schema_version": 1,
        "started_at": started_at.isoformat(),
        "serial": options.serial,
        "checks": [],
        "passed": False,
    }
    try:
        adb, emulator, avdmanager, java_home = android_tools()
        adb_tool = adb
        emulator_process = ensure_emulator(adb, emulator, avdmanager, java_home, options.serial, options.avd)
        app_apk, _ = build_and_install(adb, java_home, options.serial)

        with tempfile.TemporaryDirectory(prefix="opendrsai-local-e2e-", ignore_cleanup_errors=True) as temporary:
            temporary_root = Path(temporary)
            temporary_root_cleanup = temporary_root
            home = temporary_root / "home"
            workspace_path = temporary_root / "workspace"
            workspace_path.mkdir()
            (workspace_path / "README.md").write_text("local Android Runtime E2E", encoding="utf-8")
            approve_canary = f"windows-only-{uuid4().hex}"
            reject_canary = f"windows-reject-{uuid4().hex}"
            message_canary = f"message-secret-{uuid4().hex}"
            approve_canary_path = f".m08-approve-{uuid4().hex}.txt"
            reject_canary_path = f".m08-reject-{uuid4().hex}.txt"
            approve_definition = home / "assets" / "agents" / "android-local-e2e-approve" / "1.json"
            approve_definition.parent.mkdir(parents=True)
            approve_definition.write_text(json.dumps({
                "id": "android-local-e2e-approve",
                "version": "1",
                "name": "Android Local E2E Approve",
                "backend": "opendrsai",
                "instructions": "controlled local emulator acceptance",
                "permissions": ["shell:python", "tool:artifact.publish"],
                "controlled_plan": {
                    "calls": [
                        {"kind": "approval", "name": "shell:python", "arguments": {
                            "risk_summary": "Allow controlled local operation", "scope": "workspace", "timeout_seconds": 30,
                        }},
                        {"kind": "shell", "name": "python", "arguments": {
                            "command": [sys.executable, "-c",
                                        "from pathlib import Path; "
                                        f"Path({approve_canary_path!r}).write_text({approve_canary!r}, encoding='utf-8'); "
                                        "Path('artifact.txt').write_text('android local artifact', encoding='utf-8')"],
                        }},
                        {"kind": "tool", "name": "artifact.publish", "arguments": {
                            "path": "artifact.txt", "display_name": "Android Local Artifact", "mime_type": "text/plain",
                        }},
                    ],
                    "content": "local-runtime-complete",
                },
            }), encoding="utf-8")
            reject_definition = home / "assets" / "agents" / "android-local-e2e-reject" / "1.json"
            reject_definition.parent.mkdir(parents=True)
            reject_definition.write_text(json.dumps({
                "id": "android-local-e2e-reject",
                "version": "1",
                "name": "Android Local E2E Reject",
                "backend": "opendrsai",
                "instructions": "controlled rejection acceptance",
                "permissions": ["shell:python"],
                "controlled_plan": {
                    "calls": [
                        {"kind": "approval", "name": "shell:python", "arguments": {
                            "risk_summary": "Reject controlled local operation",
                            "scope": "workspace",
                            "timeout_seconds": 30,
                        }},
                        {"kind": "shell", "name": "python", "arguments": {
                            "command": [sys.executable, "-c",
                                        "from pathlib import Path; "
                                        f"Path({reject_canary_path!r}).write_text({reject_canary!r}, encoding='utf-8')"],
                        }},
                    ],
                    "content": "must-not-complete",
                },
            }), encoding="utf-8")
            # The controlled backend still traverses the production model
            # policy resolver.  Keep this fixture explicit and credential-free
            # instead of relying on a developer machine's global config.
            (home / "configs" / "agents").mkdir(parents=True)
            (home / "configs" / "models").mkdir(parents=True)
            (home / "config.toml").write_text(
                'config_version = 2\ncurrent_agent = "opendrsai"\n'
                'agent_config_file = "configs/agents/agent_opendrsai.toml"\n\n'
                '[model_providers.hepai]\nbase_url = "https://controlled.invalid/v1"\n'
                'requires_api_key = false\nmodels_file = "configs/models/provider_hepai.toml"\n',
                encoding="utf-8",
            )
            (home / "configs" / "agents" / "agent_opendrsai.toml").write_text(
                'schema_version = 2\nagent_name = "opendrsai"\n[models.primary]\n'
                'mode = "explicit"\nprovider_id = "hepai"\nmodel_id = "controlled"\n',
                encoding="utf-8",
            )
            (home / "configs" / "models" / "provider_hepai.toml").write_text(
                '[models."controlled"]\ninput_modalities = ["text"]\n'
                'output_modalities = ["text"]\napi_protocol = "openai"\n'
                'enabled = true\ncapabilities = ["chat", "tool_calling"]\n',
                encoding="utf-8",
            )
            gateway_token = "local-e2e-gateway-token"
            os.environ["DRSAI_HOME"] = str(home)
            os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = gateway_token
            os.environ["DRSAI_RUNTIME_CONTROLLED_MODEL"] = "1"

            from drsai.backend import gateway
            gateway._WORKSPACE = home / "workspace-state"
            gateway._DATASET = gateway._WORKSPACE / "drsai"
            gateway._DATASET.mkdir(parents=True, exist_ok=True)
            gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
            for name in (
                "_db_manager", "_runtime_registry_instance", "_runtime_engine_instance",
                "_runtime_agent_service_instance", "_runtime_tool_dispatcher_instance",
                "_runtime_artifact_store_instance",
            ):
                setattr(gateway, name, None)
            gateway._local_workspace_owop_instances.clear()
            windows = TestClient(gateway.app)
            windows.__enter__()
            opened = windows.post(
                "/v1/workspaces",
                headers={"X-OpenDrSai-Gateway-Token": gateway_token},
                json={"path": str(workspace_path)},
            )
            opened.raise_for_status()
            workspace_id = opened.json()["workspace_id"]

            registry = RelayRegistry()
            private_key = Ed25519PrivateKey.generate()
            public_key = base64.urlsafe_b64encode(private_key.public_key().public_bytes(
                serialization.Encoding.Raw,
                serialization.PublicFormat.Raw,
            )).rstrip(b"=").decode()
            runtime_id, registration_token = registry.register(
                registry.issue_registration_code(),
                "Windows Local E2E",
                "2.0.0",
                public_key,
                "local-emulator-registration",
            )
            credential_path = home / "runtime" / "credential-canary.dpapi"
            credential_store = RuntimeCredentialStore(credential_path)
            credential_store.save(RuntimeCredential(runtime_id, registration_token))
            if credential_store.load() != RuntimeCredential(runtime_id, registration_token):
                raise RuntimeError("windows_dpapi_roundtrip_failed")
            nonce = uuid4().hex
            signature = base64.urlsafe_b64encode(private_key.sign(
                f"{runtime_id}\nlocal-emulator-instance\n{nonce}".encode()
            )).rstrip(b"=").decode()
            registry.heartbeat(
                runtime_id,
                registration_token,
                instance_id="local-emulator-instance",
                version="2.0.0",
                capabilities=frozenset(),
                backend_health={},
                nonce=nonce,
                signature=signature,
            )
            registry.publish_workspaces(runtime_id, registration_token, [
                Workspace(runtime_id=runtime_id, workspace_id=workspace_id, display_name="Local Emulator Workspace"),
            ])
            grant_id, grant_code, _ = registry.issue_access_grant(runtime_id, registration_token)
            bearer = f"local-e2e-{uuid4().hex}"
            subject = "android-emulator"
            handler = GatewayRuntimeControlHandler(
                runtime_id,
                GatewayTransport(windows, gateway_token),
                home / "runtime",
            )
            app = create_relay_app(
                registry,
                channels=DirectRuntimeChannel(handler),
                principal_resolver=lambda request: subject
                if request.headers.get("authorization") == f"Bearer {bearer}" else "",
            )
            port = available_port()
            listen_host = str(host_address)
            server = uvicorn.Server(uvicorn.Config(
                app,
                host=listen_host,
                port=port,
                log_level="warning",
                timeout_keep_alive=1,
            ))
            server_thread = threading.Thread(target=server.run, daemon=True)
            server_thread.start()
            deadline = time.monotonic() + 20
            while not server.started and time.monotonic() < deadline:
                time.sleep(0.05)
            if not server.started:
                raise RuntimeError("local_relay_start_timeout")

            if options.transport == "adb-reverse":
                run([str(adb), "-s", options.serial, "reverse", f"tcp:{port}", f"tcp:{port}"])
                reverse_port = port
            run([str(adb), "-s", options.serial, "logcat", "-c"])
            instrumentation = run([
                str(adb), "-s", options.serial, "shell", "am", "instrument", "-w", "-r",
                "-e", "class",
                "ai.drsai.remote.LocalRemoteWorkspaceE2ETest#registrationAssociationBrowseRunAndApprovalUseTheRealLocalRelay",
                "-e", "relayBaseUrl", f"http://{host_address}:{port}",
                "-e", "relayBearer", bearer,
                "-e", "relayGrantCode", grant_code,
                "-e", "approveCanary", approve_canary,
                "-e", "rejectCanary", reject_canary,
                "-e", "messageCanary", message_canary,
                "-e", "approveCanaryPath", approve_canary_path,
                "-e", "rejectCanaryPath", reject_canary_path,
                "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
            ], timeout=180).stdout
            if "OK (1 test)" not in instrumentation:
                print(instrumentation, file=sys.stderr)
                print(json.dumps({
                    "runtime_execution_failures": handler.execution_failures,
                }, ensure_ascii=False, default=str), file=sys.stderr)
                raise RuntimeError("android_local_e2e_failed")
            proof_prefixes = (
                "OPENDRSAI_TRANSCRIPT_PROOF=",
                "INSTRUMENTATION_STATUS: transcriptProof=",
            )
            proof_value = next(
                (
                    line.strip().split(prefix, 1)[1]
                    for line in instrumentation.splitlines()
                    for prefix in proof_prefixes
                    if prefix in line
                ),
                None,
            )
            if proof_value is None:
                raise RuntimeError("android_transcript_proof_missing")
            android_proof = json.loads(proof_value)
            approved_file = workspace_path / approve_canary_path
            rejected_file = workspace_path / reject_canary_path
            if not approved_file.is_file() or approved_file.read_text(encoding="utf-8") != approve_canary:
                raise RuntimeError("windows_canary_missing")
            if rejected_file.exists():
                raise RuntimeError("rejected_windows_side_effect_present")
            storage_scan = android_proof.get("android_storage_scan") or {}
            category_counts = storage_scan.get("category_file_counts") or {}
            report["android_storage_scan_debug"] = storage_scan
            if (
                storage_scan.get("result") != "zero_matches"
                or int(storage_scan.get("root_count", 0)) < 8
                or int(storage_scan.get("prepared_root_count", 0))
                    + int(storage_scan.get("immutable_root_count", 0))
                    != int(storage_scan.get("root_count", 0))
                or int(storage_scan.get("file_count", 0)) <= 0
                or int(storage_scan.get("forbidden_count", 0)) != 7
                or int(storage_scan.get("variant_count", 0)) < 21
                or storage_scan.get("backup_disabled") is not True
                or len(category_counts) != int(storage_scan.get("root_count", 0))
                or any(int(count) <= 0 for count in category_counts.values())
            ):
                raise RuntimeError("android_storage_scan_incomplete")
            approval_branches = android_proof.get("approval_branches") or {}
            if approval_branches != {
                "approved_terminal": "completed",
                "rejected_terminal": "cancelled",
                "rejected_tool_finished": False,
                "rejected_audit": True,
            }:
                raise RuntimeError("approval_branch_proof_invalid")
            transport_faults = android_proof.get("transport_faults") or {}
            if transport_faults != {
                "run_response_dropped": True,
                "approval_response_dropped": True,
            }:
                raise RuntimeError("transport_fault_injection_missing")
            projected_events, _ = asyncio.run(handler.list_events(str(android_proof["run_id"]), limit=500))
            normalized = [
                {
                    "event_id": item["event_id"],
                    "sequence": item["sequence"],
                    "kind": item["kind"],
                    "payload": item["payload"],
                }
                for item in projected_events
            ]
            canonical_events = [
                json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                for item in normalized
            ]
            android_canonical_events = [
                json.dumps(
                    json.loads(value),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                for value in android_proof.pop("canonical_events")
            ]
            android_semantic_hash = hashlib.sha256(
                "\n".join(android_canonical_events).encode("utf-8")
            ).hexdigest()
            windows_hash = hashlib.sha256(
                "\n".join(canonical_events).encode("utf-8")
            ).hexdigest()
            if android_proof["event_count"] != len(normalized) or android_semantic_hash != windows_hash:
                android_event_hashes = [
                    hashlib.sha256(value.encode("utf-8")).hexdigest()
                    for value in android_canonical_events
                ]
                windows_event_hashes = [
                    hashlib.sha256(value.encode("utf-8")).hexdigest()
                    for value in canonical_events
                ]
                report["transcript_debug"] = {
                    "android_event_count": android_proof["event_count"],
                    "windows_event_count": len(normalized),
                    "android_sha256": android_semantic_hash,
                    "windows_sha256": windows_hash,
                    "mismatch_indexes": [
                        index
                        for index, (android_hash, windows_event_hash)
                        in enumerate(zip(android_event_hashes, windows_event_hashes))
                        if android_hash != windows_event_hash
                    ],
                    "event_kinds": [item["kind"] for item in normalized],
                }
                raise RuntimeError("cross_client_transcript_hash_mismatch")
            with handler._connect() as relay_db:
                run_binding_count = int(relay_db.execute(
                    "SELECT COUNT(*) FROM relay_runs WHERE subject=? AND idempotency_key=?",
                    (subject, "android-emulator-run"),
                ).fetchone()[0])
                approval_binding_count = int(relay_db.execute(
                    "SELECT COUNT(*) FROM relay_approval_decisions WHERE subject=?",
                    (subject,),
                ).fetchone()[0])
            approved_events = [item for item in normalized if item["kind"] == "approval.approved"]
            tool_finished_events = [item for item in normalized if item["kind"] == "tool.finished"]
            artifact_events = [item for item in normalized if item["kind"] == "artifact.created"]
            report["transport_fault_debug"] = {
                "run_bindings": run_binding_count,
                "approval_bindings": approval_binding_count,
                "approved_events": len(approved_events),
                "tool_finished_events": len(tool_finished_events),
                "artifact_events": len(artifact_events),
                "event_kinds": [item["kind"] for item in normalized],
            }
            if (
                run_binding_count != 1
                or approval_binding_count != 2
                or len(approved_events) != 1
                or len(tool_finished_events) != 2
                or len(artifact_events) != 1
            ):
                raise RuntimeError("transport_fault_created_duplicate_runtime_objects")
            diagnostic_path = home / "runtime" / "run-diagnostics.json"
            diagnostic_response = windows.get(
                f"/v1/runs/{android_proof['run_id']}/diagnostics",
                headers={"X-OpenDrSai-Gateway-Token": gateway_token},
            )
            diagnostic_response.raise_for_status()
            diagnostic_path.write_text(
                json.dumps(diagnostic_response.json(), ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )
            runtime_log = home / "runtime" / "runtime.log"
            from drsai.backend.runtime.security import redact_sensitive
            from drsai.relay.security import redact_secrets
            runtime_log.write_text(
                "\n".join([
                    str(redact_sensitive(
                        f"Authorization: Bearer {bearer}; token={registration_token}"
                    )),
                    redact_secrets(
                        f"access_grant_code={grant_code}; message={message_canary}; command={approve_canary}"
                    ),
                ]),
                encoding="utf-8",
            )
            package_uid_output = run([
                str(adb), "-s", options.serial, "shell", "cmd", "package",
                "list", "packages", "-U", "ai.drsai.remote.debug",
            ]).stdout.strip()
            uid_marker = " uid:"
            if uid_marker not in package_uid_output:
                raise RuntimeError("android_package_uid_missing")
            android_uid = package_uid_output.rsplit(uid_marker, 1)[1].strip()
            if not android_uid.isdigit():
                raise RuntimeError("android_package_uid_invalid")
            android_logcat = home / "runtime" / "android-logcat.txt"
            android_logcat.write_text(
                run([
                    str(adb), "-s", options.serial, "logcat", "-d",
                    f"--uid={android_uid}",
                ]).stdout,
                encoding="utf-8",
            )
            if android_logcat.stat().st_size == 0:
                raise RuntimeError("android_logcat_empty")
            endpoint_canaries = canary_variants([
                bearer,
                grant_code,
                registration_token,
                message_canary,
                approve_canary,
                reject_canary,
            ])
            runtime_database = gateway._runtime_engine().database
            checkpoint_probe = gateway._runtime_engine().save_checkpoint(
                str(android_proof["run_id"]),
                {
                    "recovery": {
                        "command": f"echo {approve_canary}",
                        "message": message_canary,
                    }
                },
            )
            if gateway._runtime_engine().latest_checkpoint(
                str(android_proof["run_id"])
            ) != checkpoint_probe:
                raise RuntimeError("windows_encrypted_checkpoint_roundtrip_failed")
            endpoint_artifacts = [
                ("windows_dpapi", credential_path),
                ("windows_runtime_db", runtime_database),
                ("windows_checkpoint_key", runtime_database.with_suffix(
                    runtime_database.suffix + ".checkpoint-key"
                )),
                ("windows_relay_db", handler.database),
                ("windows_runtime_log", runtime_log),
                ("windows_diagnostics", diagnostic_path),
                ("android_logcat", android_logcat),
                ("android_apk", app_apk),
            ]
            endpoint_results = [
                scan_artifact(label, path, endpoint_canaries)
                for label, path in endpoint_artifacts
            ]
            if any(item.leaked for item in endpoint_results):
                canary_classes = {
                    "oidc_bearer": bearer,
                    "grant_code": grant_code,
                    "runtime_token": registration_token,
                    "message": message_canary,
                    "approved_command": approve_canary,
                    "rejected_command": reject_canary,
                }
                report["endpoint_secret_scan_debug"] = [
                    {
                        "label": item.label,
                        "leaked": item.leaked,
                        "leak_locations": item.leak_locations,
                        "matched_classes": [
                            name
                            for name, value in canary_classes.items()
                            if scan_artifact(
                                name, dict(endpoint_artifacts)[item.label],
                                canary_variants([value]),
                            ).leaked
                        ] if item.leaked else [],
                    }
                    for item in endpoint_results
                ]
                sqlite_matches: list[dict[str, object]] = []
                with sqlite3.connect(runtime_database) as runtime_db:
                    tables = [
                        str(row[0]) for row in runtime_db.execute(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                        )
                    ]
                    for table in tables:
                        columns = [
                            str(row[1]) for row in runtime_db.execute(
                                f'PRAGMA table_info("{table}")'
                            )
                        ]
                        for column in columns:
                            for rowid, value in runtime_db.execute(
                                f'SELECT rowid, CAST("{column}" AS BLOB) FROM "{table}" '
                                f'WHERE "{column}" IS NOT NULL'
                            ):
                                blob = bytes(value) if isinstance(value, bytes) else str(value).encode()
                                matched = [
                                    name for name, secret in canary_classes.items()
                                    if any(variant in blob for variant in canary_variants([secret]))
                                ]
                                if matched:
                                    sqlite_matches.append({
                                        "table": table,
                                        "column": column,
                                        "rowid": int(rowid),
                                        "matched_classes": matched,
                                    })
                report["runtime_db_secret_locations"] = sqlite_matches
                raise RuntimeError("endpoint_secret_canary_leak")
            grant_status, _ = registry.access_grant_status(runtime_id, registration_token, grant_id)
            if grant_status != "consumed":
                raise RuntimeError("grant_not_consumed")
            report["checks"] = [
                {"name": "android_emulator_boot", "status": "passed"},
                {"name": "apk_build_install", "status": "passed", "artifact": app_apk.name},
                {"name": "runtime_registration_heartbeat", "status": "passed"},
                {"name": "grant_association", "status": "passed"},
                {"name": "workspace_session_browse", "status": "passed"},
                {"name": "run_approval_tool_artifact", "status": "passed"},
                {
                    "name": "m08_f03_windows_only_canary",
                    "status": "passed",
                    "windows_file_created": True,
                    "android_scan_result": "zero_matches",
                    "android_scan_roots": int(storage_scan["root_count"]),
                    "android_files_scanned": int(storage_scan["file_count"]),
                    "android_scan_categories": sorted(category_counts),
                },
                {
                    "name": "m08_f07_approval_branches",
                    "status": "passed",
                    "approved_status": "completed",
                    "rejected_status": "cancelled",
                    "rejected_side_effect": False,
                    "rejected_audit": True,
                },
                {
                    "name": "cross_client_transcript_hash",
                    "status": "passed",
                    "event_count": len(normalized),
                    "sha256": windows_hash,
                },
                {
                    "name": "m09_f01_response_loss_recovery",
                    "status": "passed",
                    "faults": transport_faults,
                    "run_bindings": run_binding_count,
                    "approval_bindings": approval_binding_count,
                    "approved_events": len(approved_events),
                    "tool_finished_events": len(tool_finished_events),
                    "artifact_events": len(artifact_events),
                },
                {
                    "name": "m09_f05_endpoint_secret_scan",
                    "status": "passed",
                    "canary_classes": 6,
                    "encoding_variants": len(endpoint_canaries),
                    "android_storage_categories": len(category_counts),
                    "artifacts": [
                        {
                            "label": item.label,
                            "files_scanned": item.files_scanned,
                            "archive_members_scanned": item.archive_members_scanned,
                            "leaked": item.leaked,
                        }
                        for item in endpoint_results
                    ],
                },
            ]
            report["passed"] = True
    except Exception as exc:
        traceback.print_exc()
        report["error"] = type(exc).__name__
        return_code = 1
    else:
        return_code = 0
    finally:
        if adb_tool is not None and reverse_port is not None:
            subprocess.run(
                [str(adb_tool), "-s", options.serial, "reverse", "--remove", f"tcp:{reverse_port}"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        if server is not None:
            server.should_exit = True
        if server_thread is not None:
            server_thread.join(timeout=10)
        if windows is not None:
            windows.__exit__(None, None, None)
        if (
            temporary_root_cleanup is not None
            and temporary_root_cleanup.name.startswith("opendrsai-local-e2e-")
            and temporary_root_cleanup.parent == Path(tempfile.gettempdir())
        ):
            shutil.rmtree(temporary_root_cleanup, ignore_errors=True)
        report["finished_at"] = datetime.now(UTC).isoformat()
        report["duration_seconds"] = round((datetime.now(UTC) - started_at).total_seconds(), 3)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if emulator_process is not None:
            emulator_process.terminate()
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
