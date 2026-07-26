from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess, CodexRestartPolicy
from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, CodexBinaryProvider


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _development_provider(tmp_path: Path, executable: Path | None = None) -> CodexBinaryProvider:
    store = CodexArtifactStore(tmp_path / "unused-managed", {})
    return CodexBinaryProvider(store, mode="development", environ={"CODEX_BIN": str(executable or Path(sys.executable))})


@pytest.mark.anyio
async def test_runtime_shares_one_app_server_across_concurrent_callers(tmp_path: Path):
    code = "import sys,time; print('server-ready', file=sys.stderr, flush=True); time.sleep(30)"
    supervisor = CodexAppServerProcess(
        _development_provider(tmp_path), verify_binary=False,
        arguments=("-u", "-c", code), policy=CodexRestartPolicy(startup_grace=0.05),
    )
    try:
        processes = await asyncio.gather(*(supervisor.start() for _ in range(50)))
        assert len({process.pid for process in processes}) == 1
        assert supervisor.start_count == 1 and supervisor.generation == 1
        health = await supervisor.health()
        assert health["available"] is True and health["pid"] == processes[0].pid
    finally:
        await supervisor.close()
    assert processes[0].returncode is not None
    assert (await supervisor.health())["reason"] == "closed"


@pytest.mark.anyio
async def test_failure_backoff_circuit_breaker_and_controlled_restart(tmp_path: Path):
    delays: list[float] = []

    async def observed_sleep(delay: float):
        delays.append(delay)
        await asyncio.sleep(0.05 if delay == 0.05 else 0)

    supervisor = CodexAppServerProcess(
        _development_provider(tmp_path), verify_binary=False,
        arguments=("-c", "raise SystemExit(7)"),
        policy=CodexRestartPolicy(base_delay=0.01, max_delay=0.02, failure_window=60,
                                  max_failures=3, startup_grace=0.05),
        sleep=observed_sleep,
    )
    try:
        for _ in range(3):
            with pytest.raises(RuntimeExecutionError) as caught:
                await supervisor.start()
            assert caught.value.code == "codex_app_server_exited_early"
        with pytest.raises(RuntimeExecutionError) as caught:
            await supervisor.start()
        assert caught.value.code == "codex_app_server_restart_exhausted"
        assert supervisor.start_count == 3
        assert delays.count(0.01) == 1
        assert delays.count(0.02) == 1
    finally:
        await supervisor.close()

    healthy = CodexAppServerProcess(
        _development_provider(tmp_path / "healthy"), verify_binary=False,
        arguments=("-c", "import time; time.sleep(30)"),
        policy=CodexRestartPolicy(startup_grace=0.02),
    )
    try:
        first = await healthy.start()
        second = await healthy.restart()
        assert first.pid != second.pid
        assert (await healthy.health())["recent_failures"] == 0
    finally:
        await healthy.close()


@pytest.mark.anyio
async def test_stderr_is_bounded_redacted_and_close_cleans_resources(tmp_path: Path):
    secret = "SECRET-CANARY-123"
    code = (
        "import sys,time; "
        "sys.stderr.write('X'*100000 + ' api_key=SECRET-CANARY-123 Authorization: Bearer abc.def Cookie=session-cookie'); "
        "sys.stderr.flush(); time.sleep(30)"
    )
    supervisor = CodexAppServerProcess(
        _development_provider(tmp_path), verify_binary=False,
        arguments=("-u", "-c", code), stderr_limit=4096, explicit_secrets=(secret,),
        policy=CodexRestartPolicy(startup_grace=0.1),
    )
    temporary = tmp_path / "codex-temp.json"
    temporary.write_text("temporary")
    supervisor.register_temporary_file(temporary)
    process = await supervisor.start()
    await asyncio.sleep(0.05)
    health = await supervisor.health()
    serialized = str(health)
    assert len(supervisor.stderr) <= 4096
    assert secret not in serialized and "abc.def" not in serialized and "session-cookie" not in serialized
    assert "[REDACTED]" in serialized
    await supervisor.close()
    assert process.returncode is not None
    assert not temporary.exists()
    assert supervisor._stderr_task is None and supervisor._wait_task is None


@pytest.mark.anyio
@pytest.mark.skipif(os.name != "nt", reason="Windows wrapper behavior")
async def test_windows_cmd_wrapper_starts_as_app_server(tmp_path: Path):
    script = tmp_path / "fake-app-server.py"
    script.write_text("import time; time.sleep(30)", encoding="utf-8")
    wrapper = tmp_path / "codex.cmd"
    wrapper.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n', encoding="utf-8")
    supervisor = CodexAppServerProcess(
        _development_provider(tmp_path, wrapper), verify_binary=False,
        policy=CodexRestartPolicy(startup_grace=0.1),
    )
    try:
        process = await supervisor.start()
        assert process.returncode is None
        assert (await supervisor.health())["available"] is True
    finally:
        await supervisor.close()


@pytest.mark.anyio
@pytest.mark.skipif(os.name != "nt", reason="Windows managed exe behavior")
async def test_signed_managed_exe_is_started_by_product_supervisor(tmp_path: Path):
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    executable = artifact / "codex.exe"
    native_exe = shutil.which("ping.exe")
    assert native_exe
    shutil.copy2(native_exe, executable)
    schema = artifact / "app-server.schema.json"
    schema.write_text('{"api":"stable"}', encoding="utf-8")
    digest = lambda path: f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    manifest = {
        "version": "0.142.5", "platform": "windows-x86_64", "executable": "codex.exe",
        "binary_digest": digest(executable), "schema": schema.name, "schema_digest": digest(schema),
        "publisher": "opendrsai-release",
    }
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    manifest["signature"] = base64.b64encode(private.sign(payload)).decode()
    (artifact / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    store = CodexArtifactStore(tmp_path / "managed", {"opendrsai-release": public})
    store.install(artifact)
    supervisor = CodexAppServerProcess(
        CodexBinaryProvider(store, mode="product", environ={}), verify_binary=False,
        command_factory=lambda binary, _args: [str(binary.path), "-n", "30", "127.0.0.1"],
        policy=CodexRestartPolicy(startup_grace=0.05),
    )
    try:
        process = await supervisor.start()
        assert process.returncode is None
        assert supervisor.binary and supervisor.binary.source == "managed" and supervisor.binary.release_safe
    finally:
        await supervisor.close()
