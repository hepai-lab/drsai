from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

from drsai.owop import InProcessWorkspaceOperationsClient, OWOPProtocol
from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal


SCHEMA = Path(__file__).resolve().parents[5] / "cores" / "protocol" / "owop" / "owop.schema.json"


@pytest.fixture()
def local_workspace(tmp_path: Path):
    root = tmp_path / "workspace"
    root.mkdir()
    journal = WorkspaceWatchJournal(tmp_path / "watch.sqlite3")
    operations = LocalWorkspaceOperations("workspace-one", root, journal)
    protocol = OWOPProtocol(SCHEMA)
    client = InProcessWorkspaceOperationsClient(protocol, operations.handlers())

    async def call(operation: str, params: dict):
        return await client.execute({
            "version": "1.0",
            "request_id": f"request-{operation.replace('.', '-')}",
            "correlation_id": "correlation-local",
            "workspace_id": "workspace-one",
            "operation": operation,
            "params": params,
            "binding": {"kind": "in_process"},
        })

    yield root, journal, operations, call
    asyncio.run(client.close())


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def test_file_tree_search_preview_binary_and_large_chunking(local_workspace) -> None:
    root, _journal, _operations, call = local_workspace
    (root / "src").mkdir()
    (root / "src" / "alpha.txt").write_text("Needle in UTF-8 text", encoding="utf-8")
    (root / "src" / "binary.bin").write_bytes(b"\x00\x01\x02")
    (root / ".git").mkdir()
    (root / ".git" / "ignored").write_text("Needle", encoding="utf-8")

    first = asyncio.run(call("files.list", {"path": ".", "limit": 2}))
    assert first["ok"] and len(first["result"]["entries"]) == 2 and first["result"]["cursor"]
    second = asyncio.run(call("files.list", {"path": ".", "limit": 20, "cursor": first["result"]["cursor"]}))
    listed = [item["path"] for item in [*first["result"]["entries"], *second["result"]["entries"]]]
    assert "src/alpha.txt" in listed and not any(path.startswith(".git") for path in listed)

    search = asyncio.run(call("search.query", {"query": "needle", "path": ".", "limit": 10}))
    assert search["result"]["matches"] == [{"path": "src/alpha.txt", "match": "content"}]
    binary = asyncio.run(call("files.read", {"path": "src/binary.bin", "offset": 0, "length": 2}))
    assert binary["result"]["binary"] and base64.b64decode(binary["result"]["content_base64"]) == b"\x00\x01"

    large = bytes((index % 251 for index in range(10 * 1024 * 1024)))
    (root / "large.bin").write_bytes(large)
    rebuilt = bytearray()
    offset = 0
    while offset < len(large):
        response = asyncio.run(call("files.read", {"path": "large.bin", "offset": offset, "length": 1024 * 1024}))
        chunk = base64.b64decode(response["result"]["content_base64"])
        rebuilt.extend(chunk)
        offset += len(chunk)
    assert bytes(rebuilt) == large
    assert response["result"]["digest"] == digest(large) and response["result"]["eof"]


def test_atomic_write_digest_conflict_move_remove_and_no_temp_residue(local_workspace) -> None:
    root, _journal, _operations, call = local_workspace
    original = b"original"
    target = root / "document.txt"
    target.write_bytes(original)
    replacement = b"replacement"

    written = asyncio.run(call("files.write", {
        "path": "document.txt",
        "content_base64": base64.b64encode(replacement).decode(),
        "expected_digest": digest(original),
    }))
    assert written["ok"] and target.read_bytes() == replacement
    conflict = asyncio.run(call("files.write", {
        "path": "document.txt",
        "content_base64": base64.b64encode(b"must-not-win").decode(),
        "expected_digest": digest(original),
    }))
    assert conflict["error"]["code"] == "owop_conflict"
    assert conflict["error"]["correlation_id"] == "correlation-local"
    assert target.read_bytes() == replacement
    assert not list(root.glob(".*.owop-*"))

    moved = asyncio.run(call("files.move", {"source": "document.txt", "destination": "archive/document.txt"}))
    assert moved["ok"] and (root / "archive" / "document.txt").read_bytes() == replacement
    removed = asyncio.run(call("files.remove", {"path": "archive/document.txt", "expected_digest": digest(replacement)}))
    assert removed["ok"] and not (root / "archive" / "document.txt").exists()


def test_watch_journal_batch_dedupe_resume_and_workspace_isolation(local_workspace, tmp_path: Path) -> None:
    _root, journal, _operations, call = local_workspace
    for index in range(12):
        response = asyncio.run(call("files.write", {
            "path": f"batch/{index}.txt",
            "content_base64": base64.b64encode(str(index).encode()).decode(),
            "create_parents": True,
        }))
        assert response["ok"]
    first = asyncio.run(call("watch.subscribe", {"after_sequence": 0, "limit": 5}))
    assert [event["sequence"] for event in first["result"]["events"]] == [1, 2, 3, 4, 5]
    resumed_journal = WorkspaceWatchJournal(tmp_path / "watch.sqlite3")
    resumed = resumed_journal.list("workspace-one", 5, 100)
    assert [event["sequence"] for event in resumed] == list(range(6, 13))
    assert resumed_journal.list("workspace-two", 0, 100) == []

    duplicate_one = journal.append("workspace-one", "file.changed", {"path": "same"}, dedupe_key="stable-dedupe")
    duplicate_two = journal.append("workspace-one", "file.changed", {"path": "changed"}, dedupe_key="stable-dedupe")
    assert duplicate_one == duplicate_two


def test_absolute_traversal_symlink_junction_and_case_boundary_are_rejected(local_workspace, tmp_path: Path) -> None:
    root, _journal, _operations, call = local_workspace
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret", encoding="utf-8")
    attacks = ["../outside/secret.txt", str(outside / "secret.txt"), r"C:\\Windows\\win.ini", r"\\server\share\secret"]
    for attack in attacks:
        response = asyncio.run(call("files.stat", {"path": attack}))
        assert not response["ok"]

    link = root / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        link = None
    if link is not None:
        response = asyncio.run(call("files.stat", {"path": "link/secret.txt"}))
        assert response["error"]["code"] == "workspace_reparse_point_rejected"

    if os.name == "nt":
        junction = root / "junction"
        created = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True, text=True)
        assert created.returncode == 0, created.stderr or created.stdout
        response = asyncio.run(call("files.stat", {"path": "junction/secret.txt"}))
        assert response["error"]["code"] == "workspace_reparse_point_rejected"
        junction.rmdir()

        _operations._assert_boundary(Path(str(root).swapcase()) / "case-insensitive-child")
        with pytest.raises(Exception):
            _operations._assert_boundary(root.parent / f"{root.name}-evil" / "secret.txt")


def test_parent_replaced_by_reparse_point_during_atomic_write_is_rejected(local_workspace, tmp_path: Path) -> None:
    root, _journal, operations, call = local_workspace
    safe = root / "safe"
    safe.mkdir()
    backup = root / "safe-backup"
    outside = tmp_path / "race-outside"
    outside.mkdir()
    original = operations._reject_reparse
    calls = 0

    def inject_race(parts, *, include_leaf):
        nonlocal calls
        calls += 1
        if calls == 2:
            safe.rename(backup)
            if os.name == "nt":
                created = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(safe), str(outside)], capture_output=True, text=True)
                assert created.returncode == 0, created.stderr or created.stdout
            else:
                safe.symlink_to(outside, target_is_directory=True)
        return original(parts, include_leaf=include_leaf)

    operations._reject_reparse = inject_race
    response = asyncio.run(call("files.write", {
        "path": "safe/target.txt",
        "content_base64": base64.b64encode(b"must-stay-contained").decode(),
    }))
    assert response["error"]["code"] == "workspace_reparse_point_rejected"
    assert not (outside / "target.txt").exists()
    assert not list(outside.glob(".*.owop-*"))
    if safe.is_symlink():
        safe.unlink()
    elif os.name == "nt":
        safe.rmdir()
    backup.rename(safe)


@pytest.mark.slow
def test_file_tree_first_page_with_one_hundred_thousand_files(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    for directory_index in range(100):
        directory = root / f"d{directory_index:03d}"
        directory.mkdir()
        for file_index in range(1000):
            (directory / f"f{file_index:04d}.txt").touch()
    operations = LocalWorkspaceOperations(
        "workspace-large",
        root,
        WorkspaceWatchJournal(tmp_path / "large-watch.sqlite3"),
    )
    first = operations.list_files({"path": ".", "limit": 100})
    assert len(first["entries"]) == 100
    assert first["total"] == 100100
    assert first["cursor"] == "100"
