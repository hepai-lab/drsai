"""Live Runtime Protocol acceptance for a managed Codex Backend."""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class Client:
    def __init__(self, base_url: str, gateway_token: str = ""):
        self.base_url = base_url.rstrip("/")
        self.default_headers = (
            {"X-OpenDrSai-Gateway-Token": gateway_token}
            if gateway_token else {}
        )

    def call(self, method: str, path: str, data: Any = None, *, timeout: int = 300, headers: dict[str, str] | None = None):
        body = None if data is None else json.dumps(data).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=body, method=method)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in {**self.default_headers, **(headers or {})}.items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed ({exc.code}): {detail}") from exc


def wait_for_gateway(client: Client, timeout: int = 60) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            client.call("GET", "/health", timeout=2)
            return
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise TimeoutError(f"Runtime Gateway did not become healthy: {last_error}")


def create_run(client: Client, workspace_id: str, title: str, agent_definition: str = "codex@1") -> dict[str, Any]:
    session = client.call("POST", "/v1/sessions", {"workspace_id": workspace_id, "title": title})
    return create_run_in_session(client, session["session_id"], agent_definition)


def create_run_in_session(client: Client, session_id: str, agent_definition: str = "codex@1") -> dict[str, Any]:
    return client.call(
        "POST", f"/v1/sessions/{session_id}/runs", {"agent_definition": agent_definition},
        headers={"Idempotency-Key": f"sandbox-{uuid.uuid4()}"},
    )


def execute_async(client: Client, run_id: str, prompt: str):
    result: dict[str, Any] = {}
    def target():
        try:
            result["value"] = client.call("POST", f"/v1/runs/{run_id}/execute", {"prompt": prompt}, timeout=600)
        except BaseException as exc:
            result["error"] = str(exc)
    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    return thread, result


def wait_for_event(
    client: Client, run_id: str, event_type: str, timeout: int = 300,
    required_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        events = client.call("GET", f"/v1/runs/{run_id}/events?after_sequence=0&limit=2000")["data"]
        for event in events:
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            if event["type"] == event_type and all(data.get(key) == value for key, value in (required_data or {}).items()):
                return event
        status = client.call("GET", f"/v1/runs/{run_id}")["status"]
        if status in {"completed", "failed", "cancelled"}:
            raise RuntimeError(f"Run reached {status} before {event_type}")
        time.sleep(0.5)
    raise TimeoutError(f"Timed out waiting for {event_type}")


def wait_for_any_event(client: Client, run_id: str, event_types: set[str], timeout: int = 300) -> dict[str, Any]:
    """Wait for one authoritative lifecycle event without assuming a legacy producer."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        events = client.call("GET", f"/v1/runs/{run_id}/events?after_sequence=0&limit=2000")["data"]
        match = next((event for event in events if event["type"] in event_types), None)
        if match is not None:
            return match
        status = client.call("GET", f"/v1/runs/{run_id}")["status"]
        if status in {"completed", "failed", "cancelled"}:
            raise RuntimeError(f"Run reached {status} before any of {sorted(event_types)}")
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for one of {sorted(event_types)}")


def wait_for_oaep_item(
    client: Client,
    session_id: str,
    run_id: str,
    item_types: set[str],
    timeout: int = 300,
) -> dict[str, Any]:
    """Wait on the public OAEP stream rather than a compatibility Run event."""
    deadline = time.monotonic() + timeout
    observed: set[str] = set()
    while time.monotonic() < deadline:
        page = client.call("GET", f"/v1/sessions/{session_id}/oaep-events?after_sequence=0&limit=2000")
        for event in page["data"]:
            if event.get("run_id") != run_id or not str(event.get("type") or "").startswith("event.item."):
                continue
            item = event.get("data", {}).get("item")
            if not isinstance(item, dict):
                continue
            observed.add(str(item.get("type") or ""))
            if item.get("type") in item_types:
                return event
        status = client.call("GET", f"/v1/runs/{run_id}")["status"]
        if status in {"completed", "failed", "cancelled"}:
            raise RuntimeError(f"Run reached {status} before OAEP Item {sorted(item_types)}; observed={sorted(observed)}")
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for OAEP Item {sorted(item_types)}; observed={sorted(observed)}")


def approve_until_finished(
    client: Client,
    run_id: str,
    execute_thread: threading.Thread,
    execute_result: dict[str, Any],
    timeout: int = 600,
) -> int:
    """Approve every command request a Codex turn emits until execution ends."""
    deadline = time.monotonic() + timeout
    approved: set[str] = set()
    while time.monotonic() < deadline:
        events = client.call("GET", f"/v1/runs/{run_id}/events?after_sequence=0&limit=2000")["data"]
        for event in events:
            if event["type"] != "audit.codex.approval.requested":
                continue
            approval_id = event["data"]["approval_id"]
            if approval_id in approved:
                continue
            client.call(
                "POST",
                f"/v1/runs/{run_id}/approvals/{approval_id}/decision",
                {"decision": "accept"},
            )
            approved.add(approval_id)
        if not execute_thread.is_alive():
            if execute_result.get("error"):
                raise RuntimeError(f"Approval Run did not finish: {execute_result}")
            return len(approved)
        time.sleep(0.25)
    raise TimeoutError(f"Approval Run did not finish after {timeout}s; approvals={len(approved)}")


def verify_oaep_convergence(
    client: Client,
    session_id: str,
    run_id: str,
    *,
    require_streaming_delta: bool,
) -> dict[str, Any]:
    """Prove live ordering, replay ordering and the materialized snapshot agree."""
    replay = client.call("GET", f"/v1/sessions/{session_id}/oaep-events?after_sequence=0&limit=2000")
    events = [event for event in replay["data"] if event.get("run_id") == run_id]
    sequences = [int(event["sequence"]) for event in events]
    if sequences != sorted(sequences) or len(sequences) != len(set(sequences)):
        raise RuntimeError(f"OAEP replay sequence is invalid for {run_id}")
    terminal = next((event for event in events if event["type"] == "event.run.completed"), None)
    if terminal is None:
        raise RuntimeError(f"OAEP replay has no completed terminal for {run_id}")
    deltas = [
        event for event in events
        if event["type"] == "event.item.delta"
        and isinstance(event.get("data", {}).get("delta"), dict)
        and event["data"]["delta"].get("kind") == "message.text.append"
    ]
    if require_streaming_delta and not deltas:
        raise RuntimeError(f"OAEP replay has no streaming message delta for {run_id}")
    if deltas and max(int(event["sequence"]) for event in deltas) >= int(terminal["sequence"]):
        raise RuntimeError(f"OAEP message delta did not precede completed for {run_id}")

    completed_items = [
        event["data"]["item"] for event in events
        if event["type"] == "event.item.completed"
        and isinstance(event.get("data", {}).get("item"), dict)
        and event["data"]["item"].get("type") == "message"
        and event["data"]["item"].get("content", {}).get("role") == "assistant"
    ]
    snapshot = client.call("GET", f"/v1/sessions/{session_id}/oaep-snapshot")
    snapshot_items = {item["id"]: item for item in snapshot["items"] if item.get("run_id") == run_id}
    for item in completed_items:
        if snapshot_items.get(item["id"]) != item:
            raise RuntimeError(f"OAEP replay/snapshot item mismatch for {item['id']}")
    if not completed_items:
        raise RuntimeError(f"OAEP replay has no completed assistant message for {run_id}")
    return {
        "event_count": len(events),
        "delta_count": len(deltas),
        "snapshot_sequence": snapshot["snapshot_sequence"],
    }


def phase_execute(
    client: Client,
    workspace: Path,
    runtime_state_root: Path,
    state_path: Path,
    auth_request_path: Path,
    open_login_browser: bool = False,
    allow_no_approval: bool = False,
    continuous_turns: int = 20,
) -> dict[str, Any]:
    wait_for_gateway(client)
    account = client.call("GET", "/v1/agent-backends/codex/account?refresh=true")
    if not account.get("logged_in"):
        try:
            login = client.call("POST", "/v1/agent-backends/codex/account/login", {"type": "chatgptDeviceCode"})
        except RuntimeError as exc:
            if "403" not in str(exc):
                raise
            login = client.call("POST", "/v1/agent-backends/codex/account/login", {"type": "chatgpt"})
        public_login = {key: login.get(key) for key in ("loginId", "verificationUrl", "authUrl", "userCode") if login.get(key)}
        public_login["type"] = login.get("type", "chatgpt")
        auth_request_path.write_text(json.dumps(public_login, indent=2) + "\n", encoding="utf-8")
        login_url = public_login.get("verificationUrl") or public_login.get("authUrl")
        if open_login_browser and login_url and os.name == "nt":
            os.startfile(login_url)  # type: ignore[attr-defined]
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            account = client.call("GET", "/v1/agent-backends/codex/account?refresh=true")
            if account.get("logged_in"):
                break
            time.sleep(2)
        else:
            raise TimeoutError("Codex device login was not completed")
        auth_request_path.unlink(missing_ok=True)

    workspace.mkdir(parents=True, exist_ok=True)
    approval_definition = runtime_state_root / "assets" / "agents" / "codex-approval" / "1.json"
    approval_definition.parent.mkdir(parents=True, exist_ok=True)
    approval_definition.write_text(json.dumps({
        "id": "codex-approval", "version": "1", "backend": "codex", "model": "gpt-5.4",
        "instructions": "Use the requested command exactly and stay inside the authoritative Workspace.",
        "permissions": ["workspace:read", "workspace:write", "files:write", "process:execute", "permissions:grant"],
        # Read-only makes the workspace-local proof write deterministically
        # cross the approval boundary without touching anything outside the
        # disposable acceptance Workspace.
        "backend_config": {"approvalPolicy": "on-request", "sandbox": "read-only"},
    }), encoding="utf-8")
    opened = client.call("POST", "/v1/workspaces", {"path": str(workspace)})
    workspace_id = opened["workspace_id"]

    completion = create_run(client, workspace_id, "Codex completion acceptance")
    context_token = "OPENDRSAI_MULTI_TURN_CONTEXT_7319"
    completion_result = client.call(
        "POST", f"/v1/runs/{completion['run_id']}/execute",
        {"prompt": f"Remember the token {context_token}. Reply with exactly OPENDRSAI_CODEX_RUNTIME_OK and do not use tools."}, timeout=600,
    )
    completion_run = client.call("GET", f"/v1/runs/{completion['run_id']}")
    completion_events = client.call("GET", f"/v1/runs/{completion['run_id']}/events?after_sequence=0&limit=2000")["data"]
    if completion_run["status"] != "completed" or "OPENDRSAI_CODEX_RUNTIME_OK" not in json.dumps(completion_events):
        raise RuntimeError(f"Managed Codex completion acceptance failed: {completion_result}")
    completion_session_id = completion["session_id"]
    first_backend = completion_result.get("result", {}).get("backend_metadata", {})
    continuation = create_run_in_session(client, completion_session_id)
    continuation_result = client.call(
        "POST", f"/v1/runs/{continuation['run_id']}/execute",
        {"prompt": "What exact token did I ask you to remember in the previous message? Reply with only that token."}, timeout=600,
    )
    continuation_events = client.call("GET", f"/v1/runs/{continuation['run_id']}/events?after_sequence=0&limit=2000")["data"]
    second_backend = continuation_result.get("result", {}).get("backend_metadata", {})
    if context_token not in json.dumps(continuation_events):
        raise RuntimeError("Second turn did not retain first-turn conversation context")
    if not first_backend.get("thread_id") or first_backend.get("thread_id") != second_backend.get("thread_id"):
        raise RuntimeError(f"Multi-turn conversation created a different Codex Thread: {first_backend} -> {second_backend}")
    if not first_backend.get("turn_id") or first_backend.get("turn_id") == second_backend.get("turn_id"):
        raise RuntimeError(f"Multi-turn conversation did not create distinct Codex Turns: {first_backend} -> {second_backend}")
    continuous_runs = [completion["run_id"], continuation["run_id"]]
    continuous_turn_ids = [first_backend.get("turn_id"), second_backend.get("turn_id")]
    for turn_number in range(3, max(2, continuous_turns) + 1):
        follow_up = create_run_in_session(client, completion_session_id)
        follow_up_result = client.call(
            "POST", f"/v1/runs/{follow_up['run_id']}/execute",
            {"prompt": f"This is continuity check {turn_number}. Reply with exactly TURN_{turn_number}_OK and do not use tools."},
            timeout=600,
        )
        follow_up_events = client.call("GET", f"/v1/runs/{follow_up['run_id']}/events?after_sequence=0&limit=2000")["data"]
        backend_metadata = follow_up_result.get("result", {}).get("backend_metadata", {})
        if backend_metadata.get("thread_id") != first_backend.get("thread_id"):
            raise RuntimeError(f"Turn {turn_number} created a different Codex Thread: {backend_metadata}")
        if not backend_metadata.get("turn_id") or backend_metadata["turn_id"] in continuous_turn_ids:
            raise RuntimeError(f"Turn {turn_number} did not create one distinct Codex Turn: {backend_metadata}")
        if f"TURN_{turn_number}_OK" not in json.dumps(follow_up_events):
            raise RuntimeError(f"Turn {turn_number} response was missing or duplicated")
        continuous_runs.append(follow_up["run_id"])
        continuous_turn_ids.append(backend_metadata["turn_id"])
    oaep_first = verify_oaep_convergence(
        client, completion_session_id, completion["run_id"], require_streaming_delta=True,
    )
    oaep_second = verify_oaep_convergence(
        client, completion_session_id, continuation["run_id"], require_streaming_delta=True,
    )
    archived_session = client.call("PATCH", f"/v1/sessions/{completion_session_id}", {"archived": True})
    if archived_session.get("archived") is not True:
        raise RuntimeError("Codex Session archive did not converge")
    restored_session = client.call("PATCH", f"/v1/sessions/{completion_session_id}", {"archived": False})
    if restored_session.get("archived") is not False:
        raise RuntimeError("Codex Session unarchive did not converge")

    approval = create_run(client, workspace_id, "Codex approval acceptance", "codex-approval@1")
    approval_thread, approval_result = execute_async(
        client, approval["run_id"],
        "Use the shell command `cmd.exe /d /c echo OPENDRSAI_APPROVAL_OK>approval-proof.txt`, then finish after the file exists.",
    )
    approval_count = approve_until_finished(
        client, approval["run_id"], approval_thread, approval_result,
    )
    if not approval_count and not allow_no_approval:
        raise RuntimeError("Approval Run completed without exercising the approval bridge")
    if not (workspace / "approval-proof.txt").is_file():
        raise RuntimeError("Approved Codex file change was not materialized")

    cancelled = create_run(client, workspace_id, "Codex cancel acceptance", "codex-approval@1")
    cancel_thread, cancel_result = execute_async(
        client, cancelled["run_id"],
        "Use the shell command `ping.exe -n 120 127.0.0.1`, then report completion.",
    )
    # Cancel as soon as the public OAEP stream exposes either the command or
    # an approval Interaction. This avoids every legacy Run-event assumption.
    wait_for_oaep_item(
        client, cancelled["session_id"], cancelled["run_id"],
        {"command_execution", "interaction"},
    )
    client.call("POST", f"/v1/runs/{cancelled['run_id']}/cancel")
    cancel_thread.join(60)
    cancelled_run = client.call("GET", f"/v1/runs/{cancelled['run_id']}")
    if cancelled_run["status"] != "cancelled":
        raise RuntimeError(f"Cancel did not converge: {cancelled_run}; execute={cancel_result}")

    state = {
        "workspace_id": workspace_id,
        "runs": [*continuous_runs, approval["run_id"], cancelled["run_id"]],
        "expected_statuses": [*(["completed"] * len(continuous_runs)), "completed", "cancelled"],
        "auth_mode": account.get("auth_mode"),
        "context_token": context_token,
        "archive_roundtrip": True,
        "approval_count": approval_count,
        "oaep": {"first": oaep_first, "second": oaep_second},
        "multi_turn": {
            "session_id": completion_session_id,
            "thread_id": first_backend.get("thread_id"),
            "first_turn_id": first_backend.get("turn_id"),
            "second_turn_id": second_backend.get("turn_id"),
            "context_retained": True,
            "turn_count": len(continuous_turn_ids),
            "turn_ids_unique": len(set(continuous_turn_ids)) == len(continuous_turn_ids),
        },
    }
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return state


def phase_recover(client: Client, state_path: Path) -> dict[str, Any]:
    wait_for_gateway(client)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    statuses = []
    event_counts = []
    for run_id in state["runs"]:
        run = client.call("GET", f"/v1/runs/{run_id}")
        events = client.call("GET", f"/v1/runs/{run_id}/events?after_sequence=0&limit=2000")["data"]
        statuses.append(run["status"])
        event_counts.append(len(events))
    expected_statuses = state.get("expected_statuses", ["completed", "completed", "cancelled"])
    if statuses != expected_statuses or not all(event_counts):
        raise RuntimeError(f"Restart recovery mismatch: statuses={statuses}, events={event_counts}")
    multi_turn = state["multi_turn"]
    third = create_run_in_session(client, multi_turn["session_id"])
    third_result = client.call(
        "POST", f"/v1/runs/{third['run_id']}/execute",
        {"prompt": "After the Runtime restart, reply with only the exact token from the first message."},
        timeout=600,
    )
    third_events = client.call("GET", f"/v1/runs/{third['run_id']}/events?after_sequence=0&limit=2000")["data"]
    if state["context_token"] not in json.dumps(third_events):
        raise RuntimeError("Third turn after Runtime restart lost conversation context")
    third_backend = third_result.get("result", {}).get("backend_metadata", {})
    if third_backend.get("thread_id") != multi_turn["thread_id"]:
        raise RuntimeError(f"Restart recovery created a different Codex Thread: {third_backend}")
    if third_backend.get("turn_id") in {multi_turn["first_turn_id"], multi_turn["second_turn_id"], None}:
        raise RuntimeError(f"Restart recovery did not create a distinct third Turn: {third_backend}")
    oaep_third = verify_oaep_convergence(
        client, multi_turn["session_id"], third["run_id"], require_streaming_delta=True,
    )
    return {
        "recovered": True,
        "statuses": statuses,
        "event_counts": event_counts,
        "auth_mode": state.get("auth_mode"),
        "third_run_id": third["run_id"],
        "thread_id": third_backend["thread_id"],
        "third_turn_id": third_backend["turn_id"],
        "context_retained": True,
        "archive_roundtrip": state.get("archive_roundtrip") is True,
        "approval_count": int(state.get("approval_count") or 0),
        "cancellation_verified": "cancelled" in statuses,
        "multi_turn": {
            **multi_turn,
            "restart_turn_id": third_backend["turn_id"],
            "context_retained": True,
        },
        "oaep": {
            **state.get("oaep", {}),
            "recovery": oaep_third,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18642")
    parser.add_argument("--self-host-gateway", action="store_true")
    parser.add_argument(
        "--gateway-token",
        default=os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", ""),
        help="Per-instance Desktop/Gateway authentication token.",
    )
    parser.add_argument("--phase", choices=("execute", "recover"), required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--runtime-state-root", type=Path)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--auth-request", type=Path)
    parser.add_argument("--open-login-browser", action="store_true")
    parser.add_argument("--allow-no-approval", action="store_true")
    parser.add_argument("--continuous-turns", type=int, default=20)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    if args.gateway_token:
        # Windows can preserve duplicate, differently-cased environment keys
        # across parent processes.  Make the CLI value authoritative in the
        # same interpreter that imports and hosts the Gateway.
        for key in list(os.environ):
            if key.upper() == "OPENDRSAI_GATEWAY_INSTANCE_TOKEN":
                del os.environ[key]
        os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = args.gateway_token
        os.environ.pop("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_REVOKED", None)
        os.environ.pop("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT", None)
    server = None
    server_thread = None
    if args.self_host_gateway:
        import uvicorn
        import drsai.backend.gateway as gateway_module

        app = gateway_module.app

        endpoint = urlparse(args.base_url)
        server = uvicorn.Server(uvicorn.Config(
            app, host=endpoint.hostname or "127.0.0.1", port=endpoint.port or 18642,
            log_level="warning",
        ))
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()
    try:
        client = Client(args.base_url, args.gateway_token)
        if args.phase == "execute":
            if not args.workspace or not args.auth_request or not args.runtime_state_root:
                parser.error("execute requires --workspace, --runtime-state-root and --auth-request")
            result = phase_execute(
                client, args.workspace, args.runtime_state_root, args.state, args.auth_request,
                args.open_login_browser, args.allow_no_approval,
                args.continuous_turns,
            )
        else:
            result = phase_recover(client, args.state)
        args.result.write_text(json.dumps({"passed": True, **result}, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, sort_keys=True))
        return 0
    finally:
        if server is not None:
            server.should_exit = True
        if server_thread is not None:
            server_thread.join(timeout=15)


if __name__ == "__main__":
    raise SystemExit(main())
