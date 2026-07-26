import base64
import faulthandler
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import time
from pathlib import Path


HOME = Path("/tmp/opendrsai-workspace-resources")
WORKSPACE = Path("/home/vscode/workspace")
WORKSPACE_TWO = Path("/home/vscode/workspace-two")
os.environ["DRSAI_HOME"] = str(HOME)
os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = "temporary-workspace-resources-token"
shutil.rmtree(HOME, ignore_errors=True)
faulthandler.enable()
faulthandler.dump_traceback_later(90, repeat=True)

from fastapi.testclient import TestClient
from drsai.backend import gateway
from drsai.backend.remote_ssh.pty import manager as pty_manager


headers = {"X-OpenDrSai-Gateway-Token": "temporary-workspace-resources-token"}


def request(client, method, path, expected=200, raw=False, **kwargs):
    response = client.request(method, path, headers={**headers, **kwargs.pop("headers", {})}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response if raw else response.json()


def git(*args, check=True):
    return subprocess.run(["git", "-C", str(WORKSPACE), *args], capture_output=True, text=True, check=check)


def reset_workspace():
    git("reset", "--hard", "HEAD")
    git("clean", "-fdx")
    git("config", "user.email", "e2e@example.test")
    git("config", "user.name", "E2E")


def receive_until(websocket, predicate, limit=40):
    rows = []
    for _ in range(limit):
        row = websocket.receive_json()
        rows.append(row)
        if predicate(row, rows):
            return row, rows
    raise AssertionError(rows[-5:])


def mark(stage):
    Path("/tmp/m08-current-stage").write_text(stage, encoding="utf-8")
    print(f"M08_STAGE:{stage}", flush=True)


reset_workspace()
with TestClient(gateway.app) as client:
    workspace = request(client, "POST", "/v1/workspaces", json={"path": str(WORKSPACE)})
    second = request(client, "POST", "/v1/workspaces", json={"path": str(WORKSPACE_TWO)})
    wid = workspace["workspace_id"]

    mark("F01")
    # F01 tree/search/pagination/ignore.
    (WORKSPACE / ".gitignore").write_text("ignored*.tmp\nignored-dir/\n", encoding="utf-8")
    (WORKSPACE / "node_modules").mkdir(exist_ok=True)
    (WORKSPACE / "node_modules" / "hidden.js").write_text("hidden", encoding="utf-8")
    (WORKSPACE / "ignored-dir").mkdir(exist_ok=True)
    (WORKSPACE / "ignored-dir" / "hidden.txt").write_text("hidden", encoding="utf-8")
    for index in range(125):
        (WORKSPACE / f"search-{index:03}.txt").write_text(str(index), encoding="utf-8")
    (WORKSPACE / "ignored-one.tmp").write_text("hidden", encoding="utf-8")
    first_page = request(client, "GET", f"/v1/workspaces/{wid}/files?depth=5&query=search-&offset=0&max_entries=25")
    second_page = request(client, "GET", f"/v1/workspaces/{wid}/files?depth=5&query=search-&offset=25&max_entries=25")
    assert len(first_page["data"]) == len(second_page["data"]) == 25
    assert first_page["next_offset"] == 25 and first_page["truncated"]
    assert {row["path"] for row in first_page["data"]}.isdisjoint({row["path"] for row in second_page["data"]})
    all_tree = request(client, "GET", f"/v1/workspaces/{wid}/files?depth=5&query=&max_entries=5000")
    serialized_tree = json.dumps(all_tree)
    assert "node_modules" not in serialized_tree and "ignored-dir" not in serialized_tree and "ignored-one.tmp" not in serialized_tree

    mark("F02")
    # F02 text/binary/rich media/invalid encoding and truncation.
    (WORKSPACE / "unicode.txt").write_text("你好 OpenDrSai", encoding="utf-8")
    (WORKSPACE / "invalid.txt").write_bytes(b"\xff\xfe\x00broken")
    (WORKSPACE / "image.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 64)
    text = request(client, "GET", f"/v1/workspaces/{wid}/file?path=unicode.txt&max_bytes=6")
    invalid = request(client, "GET", f"/v1/workspaces/{wid}/file?path=invalid.txt")
    image = request(client, "GET", f"/v1/workspaces/{wid}/file?path=image.png")
    assert text["encoding"] == "utf-8" and text["truncated"] and text["content"] == "你好"
    assert invalid["binary"] and invalid["encoding"] is None and invalid["data_url"].startswith("data:text/plain;base64,")
    assert image["binary"] and image["mime"] == "image/png" and image["data_url"].startswith("data:image/png;base64,")

    mark("F03")
    # F03 large-file chunk merge and digest.
    large = WORKSPACE / "large.bin"
    large.write_bytes(bytes(range(256)) * 40_000)
    digest = hashlib.sha256(large.read_bytes()).hexdigest()
    merged = bytearray()
    offset = 0
    while offset < large.stat().st_size:
        response = request(client, "GET", f"/v1/workspaces/{wid}/file/stream?path=large.bin&offset={offset}&length=1048576", raw=True)
        assert response.headers["x-file-sha256"] == digest
        merged.extend(response.content)
        next_offset = int(response.headers["x-next-offset"])
        assert next_offset > offset
        offset = next_offset
    assert hashlib.sha256(merged).hexdigest() == digest and len(merged) == large.stat().st_size

    mark("F04")
    # F04 atomic write, optimistic conflict, and temp cleanup.
    atomic = WORKSPACE / "atomic.txt"
    atomic.write_text("before", encoding="utf-8")
    before_hash = hashlib.sha256(b"before").hexdigest()
    written = request(client, "PUT", f"/v1/workspaces/{wid}/file", json={"path": "atomic.txt", "content_base64": base64.b64encode(b"after").decode(), "expected_sha256": before_hash})
    assert written["sha256"] == hashlib.sha256(b"after").hexdigest() and atomic.read_text() == "after"
    conflict = request(client, "PUT", f"/v1/workspaces/{wid}/file", expected=409, json={"path": "atomic.txt", "content_base64": base64.b64encode(b"lost").decode(), "expected_sha256": before_hash})
    assert conflict["error"]["code"] == "file_conflict" and atomic.read_text() == "after"
    assert not list(WORKSPACE.glob(".atomic.txt.opendrsai-*.tmp"))

    mark("F05")
    # F05 watcher batches, rename, reconnect replay, and Workspace isolation.
    watch_path = f"/v1/workspaces/{wid}/watch"
    with client.websocket_connect(watch_path) as websocket:
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"], "after_sequence": 0})
        ready, _ = receive_until(websocket, lambda row, _: row.get("type") == "ready")
        watched = WORKSPACE / "watched.txt"
        watched.write_text("one", encoding="utf-8")
        created, _ = receive_until(websocket, lambda row, _: any(change["path"] == "watched.txt" for change in row.get("changes", [])))
        cursor = created["sequence"]
    renamed = WORKSPACE / "renamed.txt"
    watched.rename(renamed)
    renamed.write_text("two", encoding="utf-8")
    with client.websocket_connect(watch_path) as websocket:
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"], "after_sequence": cursor})
        replayed, _ = receive_until(websocket, lambda row, _: any(change["path"] == "renamed.txt" for change in row.get("changes", [])))
        assert replayed["replayed"] and all(len(row.get("changes", [])) <= 200 for row in [replayed])
        assert any(change["type"] in {"renamed", "created", "modified"} for change in replayed["changes"] if change["path"] == "renamed.txt")
    gateway._workspace_watch_scan(wid, WORKSPACE)
    (WORKSPACE_TWO / "other-workspace-only.txt").write_text("other", encoding="utf-8")
    gateway._workspace_watch_scan(second["workspace_id"], WORKSPACE_TWO)
    own_paths = {event["path"] for event in gateway._workspace_watch_journals[wid]["events"]}
    assert "other-workspace-only.txt" not in own_paths

    mark("F06")
    # Reset for deterministic Git cases.
    reset_workspace()
    tracked = WORKSPACE / "tracked.txt"
    tracked.write_text("line-1\nline-2\nline-3\n", encoding="utf-8")
    git("add", "tracked.txt"); git("commit", "-m", "m08 baseline")
    tracked.write_text("line-1 changed\nline-2\nline-3 changed\n", encoding="utf-8")
    (WORKSPACE / "untracked.txt").write_text("new", encoding="utf-8")
    status_payload = request(client, "GET", f"/v1/workspaces/{wid}/git/status")
    assert not status_payload["clean"] and {row["path"] for row in status_payload["entries"]} >= {"tracked.txt", "untracked.txt"}
    diff = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?path=tracked.txt")
    at_ref = request(client, "GET", f"/v1/workspaces/{wid}/git/file-at-ref?ref=HEAD&path=tracked.txt")
    assert "line-1 changed" in diff["diff"] and at_ref["content"] == "line-1\nline-2\nline-3\n"

    mark("F07")
    # F07 whole-file and hunk stage/unstage/revert with diff hash guards.
    patch = diff["diff"]
    request(client, "POST", f"/v1/workspaces/{wid}/git/stage-hunk", json={"path": "tracked.txt", "expected_diff_hash": diff["diff_hash"], "patch": patch})
    staged = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?staged=true&path=tracked.txt")
    assert staged["diff"]
    request(client, "POST", f"/v1/workspaces/{wid}/git/unstage-hunk", json={"path": "tracked.txt", "expected_diff_hash": staged["diff_hash"], "patch": staged["diff"]})
    unstaged = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?path=tracked.txt")
    request(client, "POST", f"/v1/workspaces/{wid}/git/revert-hunk", json={"path": "tracked.txt", "expected_diff_hash": unstaged["diff_hash"], "patch": unstaged["diff"]})
    assert tracked.read_text() == "line-1\nline-2\nline-3\n"
    tracked.write_text("whole-file\n", encoding="utf-8")
    whole = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?path=tracked.txt")
    request(client, "POST", f"/v1/workspaces/{wid}/git/stage", json={"path": "tracked.txt", "expected_diff_hash": whole["diff_hash"]})
    staged = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?staged=true&path=tracked.txt")
    request(client, "POST", f"/v1/workspaces/{wid}/git/unstage", json={"path": "tracked.txt", "expected_diff_hash": staged["diff_hash"], "staged": True})
    whole = request(client, "GET", f"/v1/workspaces/{wid}/git/diff?path=tracked.txt")
    request(client, "POST", f"/v1/workspaces/{wid}/git/revert", json={"path": "tracked.txt", "expected_diff_hash": whole["diff_hash"]})
    assert tracked.read_text() == "line-1\nline-2\nline-3\n"
    stale = request(client, "POST", f"/v1/workspaces/{wid}/git/stage", expected=409, json={"path": "untracked.txt", "expected_diff_hash": "0" * 64})
    assert stale["error"]["code"] == "http_409"

    mark("F08")
    # F08 empty/no-change/hook failure/success commit results.
    request(client, "POST", f"/v1/workspaces/{wid}/git/commit", expected=422, json={"message": ""})
    no_change = request(client, "POST", f"/v1/workspaces/{wid}/git/commit", expected=409, json={"message": "nothing"})
    assert no_change["error"]["code"] == "git_commit_failed"
    commit_target = WORKSPACE / "commit.txt"
    commit_target.write_text("commit", encoding="utf-8"); git("add", "commit.txt")
    hook = WORKSPACE / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\necho hook-denied >&2\nexit 7\n", encoding="utf-8"); hook.chmod(hook.stat().st_mode | stat.S_IXUSR)
    hook_failure = request(client, "POST", f"/v1/workspaces/{wid}/git/commit", expected=409, json={"message": "blocked"})
    assert hook_failure["error"]["code"] == "git_commit_failed" and "hook-denied" in hook_failure["error"]["message"]
    hook.unlink()
    committed = request(client, "POST", f"/v1/workspaces/{wid}/git/commit", json={"message": "successful commit", "idempotency_key": "approval:remote-response-lost"})
    assert committed["committed"] and not committed["replayed"] and len(committed["revision"]) == 40 and committed["exit_code"] == 0
    replayed = request(client, "POST", f"/v1/workspaces/{wid}/git/commit", json={"message": "successful commit", "idempotency_key": "approval:remote-response-lost"})
    assert replayed["committed"] and replayed["replayed"] and replayed["revision"] == committed["revision"]

    mark("F09-F10")
    # F09 create/write/resize/kill and F10 attach/bounded output buffer.
    with client.websocket_connect("/v1/pty") as websocket:
        mark("F09-auth")
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"]})
        websocket.send_json({"type": "create", "workspaceId": wid, "cwd": ".", "cols": 90, "rows": 25, "shell": "/bin/bash"})
        created, _ = receive_until(websocket, lambda row, _: row.get("type") == "created")
        mark("F09-created")
        pty_id = created["id"]
        websocket.send_json({"type": "resize", "id": pty_id, "cols": 123, "rows": 41})
        receive_until(websocket, lambda row, _: row.get("type") == "resized")
        mark("F09-resized")
        websocket.send_json({"type": "write", "id": pty_id, "data": "printf 'PTY_MARKER|'; hostname; pwd; stty size\n"})
        _, rows = receive_until(websocket, lambda row, seen: "PTY_MARKER" in "".join(item.get("data", "") for item in seen) and "41 123" in "".join(item.get("data", "") for item in seen))
        mark("F09-output")
        output = "".join(row.get("data", "") for row in rows)
        assert socket.gethostname() in output and str(WORKSPACE) in output and "41 123" in output
    mark("F10-detached")
    pty_manager.write(pty_id, "python3 -c \"print('B'*210000)\"\n")
    time.sleep(1.5)
    with client.websocket_connect("/v1/pty") as websocket:
        mark("F10-auth")
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"]})
        websocket.send_json({"type": "attach", "id": pty_id})
        attached, _ = receive_until(websocket, lambda row, _: row.get("type") == "attached")
        mark("F10-attached")
        assert attached["bufferTruncated"] and len(attached["buffer"].encode("utf-8")) <= 200000
        websocket.send_json({"type": "kill", "id": pty_id})
        receive_until(websocket, lambda row, _: row.get("type") == "killed")
        mark("F10-killed")
    assert pty_id not in pty_manager.sessions

    mark("F11")
    # F11 create/preview/restore/accept with modified, added, deleted, and skipped large file.
    baseline = WORKSPACE / "baseline.txt"
    baseline.write_text("base", encoding="utf-8"); git("add", "baseline.txt"); git("commit", "-m", "checkpoint baseline")
    baseline.write_text("checkpoint-version", encoding="utf-8")
    added = WORKSPACE / "added-at-checkpoint.txt"; added.write_text("added", encoding="utf-8")
    deleted = WORKSPACE / "deleted-at-checkpoint.txt"; deleted.write_text("delete me", encoding="utf-8"); git("add", deleted.name); git("commit", "-m", "add deleted target"); deleted.unlink()
    oversized = WORKSPACE / "oversized.bin"; oversized.write_bytes(b"x" * 9000)
    checkpoint = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints", json={"label": "M08", "maxFiles": 20, "maxBytesPerFile": 8000})
    assert checkpoint["storedFileCount"] >= 2 and checkpoint["skippedFileCount"] >= 1
    baseline.write_text("later", encoding="utf-8"); added.unlink(); deleted.write_text("recreated", encoding="utf-8"); oversized.write_bytes(b"later")
    preview = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints/preview", json={"checkpointId": checkpoint["id"]})
    assert preview["changedEntryCount"] >= 3 and preview["skippedEntryCount"] >= 1
    restored = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints/restore", json={"checkpointId": checkpoint["id"]})
    assert restored["restored"] and baseline.read_text() == "checkpoint-version" and added.read_text() == "added" and not deleted.exists()
    assert oversized.read_bytes() == b"later"
    accepted = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints/accept", json={"checkpointId": checkpoint["id"]})
    assert accepted["reviewStatus"] == "accepted"

    mark("F12")
    # F12 Runtime Checkpoint and Workspace Version remain separate stores and schemas.
    session = request(client, "POST", "/v1/sessions", json={"workspace_id": wid, "title": "M08 separation"})
    run = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={"Idempotency-Key": "m08-separation"}, json={"agent_definition": "separation@1"})
    runtime_checkpoint = request(client, "POST", f"/v1/runs/{run['run_id']}/checkpoint", json={"state": {"agent": {"turn": 2}}})
    assert runtime_checkpoint["checkpoint_id"].startswith("checkpoint-") and checkpoint["id"].startswith("wcp-")
    assert "state" in runtime_checkpoint and "entries" not in runtime_checkpoint
    assert "entries" in checkpoint and "state" not in checkpoint
    assert (HOME / "runtime" / "engine.sqlite3").is_file()
    workspace_store = Path.home() / ".local" / "share" / "opendrsai" / "remote" / "checkpoints" / wid / checkpoint["id"] / "meta.json"
    assert workspace_store.is_file() and HOME / "runtime" / "engine.sqlite3" != workspace_store

print(json.dumps({
    "marker": "Real Workspace Resources API verification passed.",
    "remote_hostname": socket.gethostname(),
    "workspace_id": wid,
    "file_digest": digest,
    "workspace_checkpoint": checkpoint["id"],
    "runtime_checkpoint": runtime_checkpoint["checkpoint_id"],
}))
