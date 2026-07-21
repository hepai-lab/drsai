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


class Client:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def call(self, method: str, path: str, data: Any = None, *, timeout: int = 300, headers: dict[str, str] | None = None):
        body = None if data is None else json.dumps(data).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=body, method=method)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed ({exc.code}): {detail}") from exc


def wait_for_gateway(client: Client, timeout: int = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            client.call("GET", "/health", timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    raise TimeoutError("Runtime Gateway did not become healthy")


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


def phase_execute(
    client: Client,
    workspace: Path,
    runtime_state_root: Path,
    state_path: Path,
    auth_request_path: Path,
    open_login_browser: bool = False,
    allow_no_approval: bool = False,
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
        "backend_config": {"approvalPolicy": "on-request", "sandbox": "workspace-write"},
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
    if allow_no_approval:
        wait_for_event(client, cancelled["run_id"], "agent.started", required_data={"backend": "codex"})
    else:
        wait_for_event(client, cancelled["run_id"], "audit.codex.approval.requested")
    client.call("POST", f"/v1/runs/{cancelled['run_id']}/cancel")
    cancel_thread.join(60)
    cancelled_run = client.call("GET", f"/v1/runs/{cancelled['run_id']}")
    if cancelled_run["status"] != "cancelled":
        raise RuntimeError(f"Cancel did not converge: {cancelled_run}; execute={cancel_result}")

    state = {
        "workspace_id": workspace_id,
        "runs": [completion["run_id"], continuation["run_id"], approval["run_id"], cancelled["run_id"]],
        "expected_statuses": ["completed", "completed", "completed", "cancelled"],
        "auth_mode": account.get("auth_mode"),
        "archive_roundtrip": True,
        "multi_turn": {
            "session_id": completion_session_id,
            "thread_id": first_backend.get("thread_id"),
            "first_turn_id": first_backend.get("turn_id"),
            "second_turn_id": second_backend.get("turn_id"),
            "context_retained": True,
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
    return {"recovered": True, "statuses": statuses, "event_counts": event_counts, "auth_mode": state.get("auth_mode")}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18642")
    parser.add_argument("--phase", choices=("execute", "recover"), required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--runtime-state-root", type=Path)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--auth-request", type=Path)
    parser.add_argument("--open-login-browser", action="store_true")
    parser.add_argument("--allow-no-approval", action="store_true")
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    client = Client(args.base_url)
    if args.phase == "execute":
        if not args.workspace or not args.auth_request or not args.runtime_state_root:
            parser.error("execute requires --workspace, --runtime-state-root and --auth-request")
        result = phase_execute(
            client, args.workspace, args.runtime_state_root, args.state, args.auth_request,
            args.open_login_browser, args.allow_no_approval,
        )
    else:
        result = phase_recover(client, args.state)
    args.result.write_text(json.dumps({"passed": True, **result}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
