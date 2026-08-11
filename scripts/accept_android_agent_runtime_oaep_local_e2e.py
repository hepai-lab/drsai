from __future__ import annotations

import argparse
import asyncio
import base64
from copy import deepcopy
import hashlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cores" / "python" / "packages" / "drsai" / "src"))

import uvicorn
from fastapi import Request
from drsai.backend.runtime.oaep import reduce_oaep_events
from drsai.oaep.digest import oaep_items_digest
from drsai.relay.api import create_relay_app
from drsai.relay.models import Workspace
from drsai.relay.registry import RelayRegistry


DESKTOP_SUBJECT = "android-e2e-subject"
DESKTOP_WORKSPACE = "desktop-e2e-workspace"
DESKTOP_SESSION = "desktop-e2e-session"
DESKTOP_RUN = "desktop-e2e-run"
DESKTOP_BEARER = "desktop-e2e-bearer"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


class CrossEndDesktopAuthority:
    def __init__(self) -> None:
        self.snapshot: dict[str, Any] | None = None
        self.approval_id = "desktop-e2e-approval"
        self.approval_status = "pending"
        self.decision_order: list[dict[str, Any]] = []
        self.decision_results: dict[str, dict[str, Any]] = {}
        self.approval_transition_count = 0
        self.approval_event_count = 0
        self.side_effect_execution_count = 0
        self.side_effect_receipts: dict[str, dict[str, Any]] = {}
        self.receipt_replay_count = 0
        self._lock = threading.RLock()

    def oaep_snapshot_for_subject(
        self, subject: str, workspace_id: str, session_id: str,
        *, cursor: str | None = None, limit: int = 100,
    ) -> dict[str, Any]:
        if (
            subject != DESKTOP_SUBJECT
            or workspace_id != DESKTOP_WORKSPACE
            or session_id != DESKTOP_SESSION
            or self.snapshot is None
        ):
            raise RuntimeError("desktop_e2e_snapshot_unavailable")
        if cursor not in (None, "") or limit < 1:
            raise RuntimeError("desktop_e2e_snapshot_page_invalid")
        return deepcopy(self.snapshot)

    def decide_approval(
        self, subject: str, approval_id: str, decision: str,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if subject != DESKTOP_SUBJECT or approval_id != self.approval_id:
            raise RuntimeError("desktop_e2e_approval_scope_mismatch")
        if decision != "approve":
            raise RuntimeError("desktop_e2e_approval_decision_invalid")
        stable_key = idempotency_key or f"legacy:{approval_id}:{decision}"
        with self._lock:
            self.decision_order.append({
                "order": len(self.decision_order) + 1,
                "idempotency_key": stable_key,
                "decision": decision,
            })
            prior = self.decision_results.get(stable_key)
            if prior is not None:
                return deepcopy(prior)
            if self.approval_status == "pending":
                self.approval_status = "approved"
                self.approval_transition_count += 1
                self.approval_event_count += 1
                self._execute_side_effect_once()
            result = {
                "runtime_id": "",
                "workspace_id": DESKTOP_WORKSPACE,
                "session_id": DESKTOP_SESSION,
                "run_id": DESKTOP_RUN,
                "approval_id": self.approval_id,
                "agent_definition_id": "desktop-e2e-agent",
                "backend_id": "desktop-e2e-backend",
                "operation": "workspace.write",
                "risk_summary": "Cross-end exactly-once acceptance",
                "scope": "desktop-e2e.txt",
                "expires_at": datetime.now(UTC).isoformat(),
                "correlation_id": "desktop-e2e-approval-race",
                "status": self.approval_status,
            }
            self.decision_results[stable_key] = result
            return deepcopy(result)

    def _execute_side_effect_once(self) -> None:
        operation_id = "desktop-e2e-side-effect"
        if operation_id in self.side_effect_receipts:
            self.receipt_replay_count += 1
            return
        self.side_effect_execution_count += 1
        self.side_effect_receipts[operation_id] = {
            "operation_id": operation_id,
            "status": "succeeded",
            "result_digest": "desktop-e2e-result-digest",
        }

    def recover_and_replay(self) -> None:
        with self._lock:
            self._execute_side_effect_once()

    def race_proof(self) -> dict[str, Any]:
        with self._lock:
            return {
                "approval_id": self.approval_id,
                "status": self.approval_status,
                "decision_order": deepcopy(self.decision_order),
                "approval_transition_count": self.approval_transition_count,
                "approval_event_count": self.approval_event_count,
                "side_effect_execution_count": self.side_effect_execution_count,
                "side_effect_receipt_count": len(self.side_effect_receipts),
                "receipt_replay_count": self.receipt_replay_count,
            }


def remap_tree(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: remap_tree(item, mapping) for key, item in value.items()}
    if isinstance(value, list):
        return [remap_tree(item, mapping) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value


def available_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run(command: list[str], *, cwd: Path | None = None, timeout: int = 240) -> str:
    return subprocess.run(
        command, cwd=cwd, check=True, timeout=timeout, text=True,
        encoding="utf-8", errors="replace", stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout


def main() -> int:
    parser = argparse.ArgumentParser(description="Physical Android Runtime OAEP -> Relay -> Desktop E2E")
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--skip-build", action="store_true",
        help="Reuse the existing APKs so evidence remains bound to a preselected candidate hash.",
    )
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs" / "android" / "reports" / "evidence" / "android-agent-runtime-oaep-local-e2e.json"),
    )
    options = parser.parse_args()
    output = Path(options.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    adb = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk")) / "platform-tools/adb.exe"
    gradle = ROOT / "apps" / "android" / "gradlew.bat"
    java_home = Path(os.environ.get("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr"))
    registry = RelayRegistry()
    desktop_key = Ed25519PrivateKey.generate()
    desktop_public_key = b64url(desktop_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))
    desktop_registration_code = registry.issue_registration_code()
    desktop_runtime_id, desktop_registration_token = registry.register(
        desktop_registration_code, "Desktop OAEP E2E", "1.6.0",
        desktop_public_key, "desktop-oaep-e2e-register",
    )
    registry.publish_workspaces(desktop_runtime_id, desktop_registration_token, [Workspace(
        runtime_id=desktop_runtime_id,
        workspace_id=DESKTOP_WORKSPACE,
        display_name="Desktop OAEP E2E",
    )])
    _, desktop_access_code, _ = registry.issue_access_grant(
        desktop_runtime_id, desktop_registration_token,
    )
    device_key = Ed25519PrivateKey.generate().public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    registry.associate(
        DESKTOP_SUBJECT, desktop_access_code, "android-e2e-consumer",
        "Android E2E Consumer", b64url(device_key),
    )
    desktop_authority = CrossEndDesktopAuthority()
    registration_code = registry.issue_registration_code()
    app = create_relay_app(
        registry,
        runtimes={desktop_runtime_id: desktop_authority},
        principal_resolver=lambda request: DESKTOP_SUBJECT
        if request.headers.get("authorization") == f"Bearer {DESKTOP_BEARER}" else "",
    )
    ready: dict[str, Any] = {}
    desktop_config: dict[str, Any] = {}
    desktop_remaining_events: list[dict[str, Any]] = []
    desktop_generation = "desktop-e2e-generation-1"
    consumer_proof: dict[str, Any] = {}
    approval_proof: dict[str, Any] = {}
    ready_event = threading.Event()
    consumer_proof_event = threading.Event()
    approval_ready_event = threading.Event()
    approval_start_event = threading.Event()
    approval_proof_event = threading.Event()
    release_event = threading.Event()

    @app.post("/e2e/android-ready")
    async def android_ready(request: Request) -> dict[str, bool]:
        value = await request.json()
        ready.clear()
        ready.update(value)
        ready["host_ready_epoch_ms"] = time.time() * 1000
        ready_event.set()
        return {"ok": True}

    @app.get("/e2e/release")
    async def release(runtime_id: str) -> dict[str, bool]:
        return {"release": release_event.is_set() and ready.get("runtime_id") == runtime_id}

    @app.get("/e2e/events")
    async def desktop_events(runtime_id: str, workspace_id: str, session_id: str) -> dict[str, Any]:
        value = await app.state.oaep_replay.page(
            runtime_id, workspace_id, session_id, after_sequence=0, limit=500,
        )
        return value or {"version": "1.0", "object": "list", "data": [], "next_sequence": 0, "has_more": False}

    @app.get("/e2e/snapshot")
    async def desktop_snapshot(runtime_id: str, workspace_id: str, session_id: str) -> dict[str, Any]:
        return await app.state.runtime_channels.request(
            runtime_id, "oaep_snapshot_for_subject",
            {"args": ["android-e2e-subject", workspace_id, session_id], "kwargs": {}},
        )

    @app.get("/e2e/desktop-config")
    async def get_desktop_config() -> dict[str, Any]:
        if not desktop_config:
            return {"ready": False}
        if not desktop_config.get("seeded"):
            await app.state.oaep_replay.attach(desktop_runtime_id, desktop_generation)
            for event in desktop_config["initial_events"]:
                await app.state.oaep_replay.accept(desktop_runtime_id, desktop_generation, {
                    "type": "event", "protocol": "oaep/1", "scope": "session",
                    "runtime_id": desktop_runtime_id, "workspace_id": DESKTOP_WORKSPACE,
                    "session_id": DESKTOP_SESSION, "sequence": event["sequence"],
                    "event": event,
                })
            desktop_config["seeded"] = True
        return {
            "ready": True,
            "runtime_id": desktop_runtime_id,
            "workspace_id": DESKTOP_WORKSPACE,
            "session_id": DESKTOP_SESSION,
            "bearer": DESKTOP_BEARER,
            "event_count": desktop_config["event_count"],
            "disconnect_after": desktop_config["disconnect_after"],
            "items_digest": desktop_config["items_digest"],
            "snapshot_sequence": desktop_config["snapshot_sequence"],
        }

    @app.post("/e2e/android-reconnected")
    async def android_reconnected(request: Request) -> dict[str, Any]:
        body = await request.json()
        if int(body.get("after_sequence", -1)) != int(desktop_config["disconnect_after"]):
            raise RuntimeError("desktop_e2e_reconnect_cursor_mismatch")
        published = 0
        for event in desktop_remaining_events:
            if await app.state.oaep_replay.accept(desktop_runtime_id, desktop_generation, {
                "type": "event", "protocol": "oaep/1", "scope": "session",
                "runtime_id": desktop_runtime_id, "workspace_id": DESKTOP_WORKSPACE,
                "session_id": DESKTOP_SESSION, "sequence": event["sequence"],
                "event": event,
            }):
                published += 1
        desktop_remaining_events.clear()
        return {"ok": True, "published": published}

    @app.post("/e2e/android-consumer-proof")
    async def android_consumer_proof(request: Request) -> dict[str, bool]:
        consumer_proof.clear()
        consumer_proof.update(await request.json())
        consumer_proof_event.set()
        return {"ok": True}

    @app.get("/e2e/approval-race-config")
    async def approval_race_config() -> dict[str, Any]:
        return {
            "runtime_id": desktop_runtime_id,
            "approval_id": desktop_authority.approval_id,
            "bearer": DESKTOP_BEARER,
        }

    @app.post("/e2e/android-approval-ready")
    async def android_approval_ready() -> dict[str, bool]:
        approval_ready_event.set()
        return {"ok": True}

    @app.get("/e2e/approval-start")
    async def approval_start() -> dict[str, bool]:
        return {"start": approval_start_event.is_set()}

    @app.post("/e2e/android-approval-proof")
    async def android_approval_proof(request: Request) -> dict[str, bool]:
        approval_proof.clear()
        approval_proof.update(await request.json())
        approval_proof_event.set()
        return {"ok": True}

    port = available_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()
    instrumentation: subprocess.Popen[str] | None = None
    started = datetime.now(UTC)
    report: dict[str, Any] = {"schema_version": 1, "started_at": started.isoformat(), "passed": False}
    try:
        deadline = time.monotonic() + 20
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError("relay_start_timeout")
        if not options.skip_build:
            environment = {**os.environ, "JAVA_HOME": str(java_home)}
            subprocess.run(
                [str(gradle), ":app:assembleDebug", ":app:assembleDebugAndroidTest", "--no-daemon"],
                cwd=gradle.parent, env=environment, check=True, timeout=300,
                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        app_apk = next((gradle.parent / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"))
        test_apk = next((gradle.parent / "app/build/outputs/apk/androidTest/debug").glob("*.apk"))
        report.update({
            "apk": app_apk.name,
            "apk_sha256": hashlib.sha256(app_apk.read_bytes()).hexdigest(),
            "test_apk_sha256": hashlib.sha256(test_apk.read_bytes()).hexdigest(),
        })
        run([str(adb), "-s", options.serial, "install", "-r", "-t", str(app_apk)])
        run([str(adb), "-s", options.serial, "install", "-r", "-t", str(test_apk)])
        run([str(adb), "-s", options.serial, "reverse", f"tcp:{port}", f"tcp:{port}"])
        command = [
            str(adb), "-s", options.serial, "shell", "am", "instrument", "-w", "-r",
            "-e", "class", "ai.drsai.remote.AndroidOaepRelayLocalE2ETest",
            "-e", "relayBaseUrl", f"http://127.0.0.1:{port}",
            "-e", "registrationCode", registration_code,
            "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
        ]
        instrumentation = subprocess.Popen(
            command, text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if not ready_event.wait(45):
            raise RuntimeError("android_ready_timeout")

        async def verify() -> dict[str, Any]:
            runtime_id = str(ready["runtime_id"])
            workspace_id = str(ready["workspace_id"])
            session_id = str(ready["session_id"])
            expected_sequence = int(ready["snapshot_sequence"])
            snapshot = None
            events_page = None
            last_error = None
            observed_at = None
            def endpoint(path: str) -> dict[str, Any]:
                query = urllib.parse.urlencode({
                    "runtime_id": runtime_id, "workspace_id": workspace_id, "session_id": session_id,
                })
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}?{query}", timeout=15) as response:
                    return json.loads(response.read())
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    events_page = await asyncio.to_thread(endpoint, "/e2e/events")
                    if events_page and events_page["next_sequence"] == expected_sequence:
                        observed_at = datetime.now(UTC)
                        break
                except Exception as exc:
                    last_error = repr(exc)
                await asyncio.sleep(0.05)
            if events_page is None or observed_at is None:
                raise RuntimeError("desktop_oaep_projection_missing:" + json.dumps({
                    "last_error": last_error,
                    "metrics": app.state.oaep_replay.metrics(),
                    "ready": ready,
                }, ensure_ascii=False, default=str))
            snapshot_deadline = time.monotonic() + 20
            while snapshot is None and time.monotonic() < snapshot_deadline:
                try:
                    snapshot = await asyncio.to_thread(endpoint, "/e2e/snapshot")
                except Exception as exc:
                    last_error = repr(exc)
                    await asyncio.sleep(0.05)
            if snapshot is None:
                raise RuntimeError("desktop_oaep_snapshot_missing:" + str(last_error))
            events = events_page["data"]
            if int(events_page["next_sequence"]) != expected_sequence:
                raise RuntimeError("desktop_event_watermark_mismatch")
            item_types = {str(item["type"]) for item in snapshot["items"]}
            expected_types = {"message", "tool_call", "interaction", "artifact", "subtask"}
            if not expected_types <= item_types:
                raise RuntimeError(f"desktop_semantics_missing:{sorted(expected_types - item_types)}")
            snapshot_items_digest = oaep_items_digest(snapshot["items"])
            if snapshot_items_digest != ready["items_digest"]:
                raise RuntimeError("android_desktop_snapshot_digest_mismatch:" + json.dumps({
                    "android": ready["items_digest"], "desktop": snapshot_items_digest,
                    "types": sorted(item_types),
                }, sort_keys=True))
            replay = reduce_oaep_events(events)
            if oaep_items_digest(replay["items"]) != snapshot_items_digest:
                raise RuntimeError("desktop_replay_snapshot_digest_mismatch")

            mapping = {
                runtime_id: desktop_runtime_id,
                workspace_id: DESKTOP_WORKSPACE,
                session_id: DESKTOP_SESSION,
                str(ready.get("run_id", "android-e2e-run")): DESKTOP_RUN,
                "android-e2e-run": DESKTOP_RUN,
            }
            mapped_snapshot = remap_tree(snapshot, mapping)
            mapped_events = remap_tree(events, mapping)
            for index, event in enumerate(mapped_events, start=1):
                event["event_id"] = f"desktop-e2e-event-{index}"
                event["dedupe_key"] = f"desktop-e2e:{event['dedupe_key']}"
            mapped_replay = reduce_oaep_events(mapped_events)
            mapped_digest = oaep_items_digest(mapped_snapshot["items"])
            if oaep_items_digest(mapped_replay["items"]) != mapped_digest:
                raise RuntimeError("desktop_source_fixture_digest_mismatch")
            desktop_authority.snapshot = mapped_snapshot
            disconnect_after = max(1, len(mapped_events) // 2)
            desktop_config.update({
                "initial_events": mapped_events[:disconnect_after],
                "event_count": len(mapped_events),
                "disconnect_after": disconnect_after,
                "items_digest": mapped_digest,
                "snapshot_sequence": mapped_snapshot["snapshot_sequence"],
            })
            desktop_remaining_events.extend(mapped_events[disconnect_after:])
            latencies_ms = [
                max(0.0, (
                    observed_at.timestamp() * 1000
                    - (
                        datetime.fromisoformat(str(event["timestamp"]).replace("Z", "+00:00")).timestamp() * 1000
                        + float(ready["host_ready_epoch_ms"]) - float(ready["device_ready_epoch_ms"])
                    )
                ))
                for event in events
            ]
            ordered = sorted(latencies_ms)
            p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
            if p95 > 2_000:
                raise RuntimeError(f"oaep_e2e_p95_exceeded:{p95:.1f}")
            return {
                "runtime_id": runtime_id, "session_id": session_id,
                "event_count": len(events), "snapshot_sequence": expected_sequence,
                "item_types": sorted(item_types), "items_digest": snapshot_items_digest,
                "p95_ms": round(p95, 3),
            }

        report["android_to_desktop"] = asyncio.run(verify())
        if not consumer_proof_event.wait(45):
            raise RuntimeError("android_desktop_consumer_proof_timeout")
        expected_consumer = {
            "runtime_id": desktop_runtime_id,
            "session_id": DESKTOP_SESSION,
            "event_count": desktop_config["event_count"],
            "snapshot_sequence": desktop_config["snapshot_sequence"],
            "items_digest": desktop_config["items_digest"],
            "disconnect_after": desktop_config["disconnect_after"],
        }
        for key, expected in expected_consumer.items():
            if consumer_proof.get(key) != expected:
                raise RuntimeError(f"android_consumer_proof_mismatch:{key}:"
                                   f"{consumer_proof.get(key)!r}!={expected!r}")
        report["desktop_to_android"] = dict(consumer_proof)
        if not approval_ready_event.wait(20):
            raise RuntimeError("android_approval_race_ready_timeout")
        desktop_decision: dict[str, Any] = {}

        def post_decision(idempotency_key: str) -> dict[str, Any]:
            body = json.dumps({
                "request_id": f"request-{idempotency_key}",
                "correlation_id": "desktop-e2e-approval-race",
                "idempotency_key": idempotency_key,
                "decision": "approve",
            }).encode()
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/v1/runtimes/{desktop_runtime_id}/approvals/"
                f"{desktop_authority.approval_id}/decision",
                data=body, method="POST",
                headers={"Authorization": f"Bearer {DESKTOP_BEARER}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read())

        def desktop_racer() -> None:
            approval_start_event.wait(10)
            desktop_decision.update(post_decision("desktop-race-decision"))

        desktop_race_thread = threading.Thread(target=desktop_racer, daemon=True)
        desktop_race_thread.start()
        approval_start_event.set()
        if not approval_proof_event.wait(20):
            raise RuntimeError("android_approval_race_proof_timeout")
        desktop_race_thread.join(timeout=20)
        if desktop_race_thread.is_alive() or desktop_decision.get("status") != "approved":
            raise RuntimeError("desktop_approval_race_failed")
        if approval_proof.get("status") != "approved":
            raise RuntimeError("android_approval_race_failed")
        post_decision("desktop-race-decision")
        post_decision("desktop-race-late-replay")
        desktop_authority.recover_and_replay()
        race = desktop_authority.race_proof()
        expected_once = {
            "status": "approved",
            "approval_transition_count": 1,
            "approval_event_count": 1,
            "side_effect_execution_count": 1,
            "side_effect_receipt_count": 1,
            "receipt_replay_count": 1,
        }
        for key, expected in expected_once.items():
            if race.get(key) != expected:
                raise RuntimeError(f"approval_exactly_once_mismatch:{key}:"
                                   f"{race.get(key)!r}!={expected!r}")
        if len(race["decision_order"]) != 4:
            raise RuntimeError("approval_unified_order_count_mismatch")
        report["cross_end_approval_race"] = {
            **race,
            "android_status": approval_proof["status"],
            "desktop_status": desktop_decision["status"],
        }
        release_event.set()
        stdout, _ = instrumentation.communicate(timeout=45)
        if instrumentation.returncode != 0 or "OK (1 test)" not in stdout:
            raise RuntimeError("android_instrumentation_failed:\n" + stdout[-4000:])
        report.update({
            "passed": True,
            "finished_at": datetime.now(UTC).isoformat(),
            "serial": options.serial,
            "device": run([str(adb), "-s", options.serial, "shell", "getprop", "ro.product.model"]).strip(),
        })
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        release_event.set()
        report.update({"error": str(exc), "finished_at": datetime.now(UTC).isoformat()})
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        raise
    finally:
        if instrumentation is not None and instrumentation.poll() is None:
            instrumentation.kill()
        server.should_exit = True
        server_thread.join(timeout=10)
        try:
            run([str(adb), "-s", options.serial, "reverse", "--remove", f"tcp:{port}"], timeout=30)
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
