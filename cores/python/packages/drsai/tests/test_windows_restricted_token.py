from __future__ import annotations

import os
import sys
import tempfile
import socket
import threading
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    WindowsRestrictedTokenFactory,
    WindowsRestrictedWorkerLauncher,
    WindowsTokenError,
)


pytestmark = pytest.mark.skipif(os.name != "nt", reason="Restricted token acceptance requires Windows")


def test_windows_restricted_token_is_verified_or_fails_closed() -> None:
    try:
        token = WindowsRestrictedTokenFactory().create()
    except WindowsTokenError as error:
        # Some managed/contained Windows hosts reject CreateRestrictedToken.
        # This is an unavailable capability, never permission to use the
        # caller token as a fallback.
        assert error.code in {
            "restricted_token_create_failed", "restricted_token_verification_failed",
            "restricted_token_duplicate_failed", "restricted_token_privileges_failed",
            "restricted_token_integrity_failed",
        }
        return
    with token:
        assert token.handle > 0
        assert token.evidence.elevated is False
        assert token.evidence.administrator_member is False
        assert token.evidence.enabled_privilege_count == 0
        assert token.evidence.non_admin_verified is True
        # Medium-or-lower mandatory integrity; a high-integrity token is >= 0x3000.
        assert token.evidence.integrity_level_rid < 0x3000


def test_restricted_primary_token_launches_real_worker_with_verified_token(tmp_path: Path) -> None:
    environment = {
        "SystemRoot": os.environ["SystemRoot"],
        "TEMP": tempfile.gettempdir(),
        "TMP": tempfile.gettempdir(),
        "PYTHONIOENCODING": "utf-8",
    }
    command = str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe")
    result = WindowsRestrictedWorkerLauncher().run(
        (command, "/d", "/c", "exit", "0"), cwd=tmp_path,
        environment=environment, timeout_seconds=10,
    )
    assert result.status == "succeeded" and result.exit_code == 0, result
    assert result.process_tree_empty_verified is True
    assert result.token_evidence.non_admin_verified
    assert result.token_evidence.integrity_level_rid == 4096


def test_low_integrity_worker_cannot_overwrite_medium_integrity_canary(tmp_path: Path) -> None:
    target = tmp_path / "medium-canary.txt"
    target.write_text("protected", encoding="utf-8")
    environment = {
        "SystemRoot": os.environ["SystemRoot"],
        "TEMP": tempfile.gettempdir(),
        "TMP": tempfile.gettempdir(),
    }
    command = str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe")
    result = WindowsRestrictedWorkerLauncher().run(
        (command, "/d", "/c", f"echo escaped>{target}"), cwd=tmp_path,
        environment=environment, timeout_seconds=10,
    )
    assert result.status == "failed"
    assert target.read_text(encoding="utf-8") == "protected"


def test_restricted_worker_receives_only_explicit_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPEN_DRSAI_SECRET_CANARY", "must-not-inherit")
    environment = {"SystemRoot": os.environ["SystemRoot"], "TEMP": tempfile.gettempdir(), "TMP": tempfile.gettempdir()}
    command = str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe")
    result = WindowsRestrictedWorkerLauncher().run(
        (command, "/d", "/c", "if defined OPEN_DRSAI_SECRET_CANARY (exit 20) else (exit 0)"),
        cwd=tmp_path, environment=environment, timeout_seconds=10,
    )
    assert result.status == "succeeded" and result.exit_code == 0


def test_low_integrity_is_not_filesystem_projection_and_external_read_remains_possible(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside-canary.txt"
    outside.write_text("outside-readable", encoding="utf-8")
    environment = {"SystemRoot": os.environ["SystemRoot"], "TEMP": tempfile.gettempdir(), "TMP": tempfile.gettempdir()}
    command = str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe")
    result = WindowsRestrictedWorkerLauncher().run(
        (command, "/d", "/c", f"type {outside}>nul"), cwd=workspace,
        environment=environment, timeout_seconds=10,
    )
    # This is a negative acceptance canary: identity restriction alone is not
    # a filesystem sandbox, so the backend must not attest filesystem_enforced.
    assert result.status == "succeeded" and result.exit_code == 0


def test_low_integrity_is_not_network_isolation_and_direct_socket_remains_possible(tmp_path: Path) -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(10)
    connected = threading.Event()

    def serve() -> None:
        try:
            connection, _address = listener.accept()
            with connection:
                connection.recv(4096)
                connected.set()
                connection.sendall(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
        finally:
            listener.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    port = listener.getsockname()[1]
    environment = {"SystemRoot": os.environ["SystemRoot"], "TEMP": tempfile.gettempdir(), "TMP": tempfile.gettempdir()}
    curl = str(Path(os.environ["SystemRoot"]) / "System32" / "curl.exe")
    if not Path(curl).is_file():
        pytest.skip("Windows curl.exe is unavailable for direct socket canary")
    result = WindowsRestrictedWorkerLauncher().run(
        (curl, "--noproxy", "*", "--silent", "--fail", f"http://127.0.0.1:{port}/"),
        cwd=tmp_path, environment=environment, timeout_seconds=10,
    )
    thread.join(timeout=10)
    # Negative acceptance canary: token restriction did not block a raw client.
    assert result.status == "succeeded" and connected.is_set()
