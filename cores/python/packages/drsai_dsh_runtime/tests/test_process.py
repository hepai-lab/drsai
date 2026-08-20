from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.process import (
    BoundedDiagnosticTail,
    HarnessProcessSpec,
    HarnessProcessSupervisor,
    build_harness_environment,
)


def test_environment_is_allowlisted_and_managed_keys_are_validated() -> None:
    result = build_harness_environment(
        inherited={"PATH": "bin", "UNSAFE_AMBIENT": "value"},
        managed={"DSH_CWD": "/workspace", "DEEPSEEK_API_KEY": "secret"},
    )
    assert result == {"PATH": "bin", "DSH_CWD": "/workspace", "DEEPSEEK_API_KEY": "secret"}
    with pytest.raises(ValueError):
        build_harness_environment(inherited={}, managed={"UNREVIEWED_KEY": "value"})
    with pytest.raises(ValueError):
        build_harness_environment(inherited={}, managed={"DSH_CWD": "bad\nvalue"})


def test_process_spec_requires_existing_workspace_and_nonempty_argv(tmp_path: Path) -> None:
    spec = HarnessProcessSpec.create(
        [sys.executable, "-V"],
        cwd=tmp_path,
        inherited_environment=os.environ,
        managed_environment={"DSH_CWD": str(tmp_path)},
    )
    assert spec.cwd == tmp_path.resolve()
    with pytest.raises(ValueError):
        HarnessProcessSpec.create([], cwd=tmp_path, inherited_environment={}, managed_environment={})
    with pytest.raises(ValueError):
        HarnessProcessSpec.create(["missing"], cwd=tmp_path / "missing", inherited_environment={}, managed_environment={})


def test_diagnostic_tail_is_bounded() -> None:
    tail = BoundedDiagnosticTail(max_bytes=1024)
    for index in range(100):
        tail.append(f"line-{index}-" + ("x" * 40) + "\n")
    assert len(tail.text().encode("utf-8")) <= 1024
    assert "line-99" in tail.text()
    assert "line-0-" not in tail.text()


@pytest.mark.asyncio
async def test_supervisor_runs_without_shell_redacts_stderr_and_fences_generation(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures/jsonrpc_echo_server.py"
    secret = "dsh-test-secret"
    spec = HarnessProcessSpec.create(
        [sys.executable, "-u", str(fixture), str(tmp_path), secret],
        cwd=tmp_path,
        inherited_environment=os.environ,
        managed_environment={"DSH_CWD": str(tmp_path), "DEEPSEEK_API_KEY": secret},
    )
    supervisor = HarnessProcessSupervisor(spec)
    first = await supervisor.start()
    assert first.generation == 1
    result = await first.peer.request("echo", {"value": 1})
    assert result == {"value": 1}

    await first.peer.request("shutdown")
    assert await first.wait() == 0
    diagnostic = first.diagnostic_tail.text()
    assert secret not in diagnostic
    assert str(tmp_path) not in diagnostic
    assert "<redacted>" in diagnostic and "<workspace>" in diagnostic

    second = await supervisor.restart()
    assert second.generation == 2
    assert second.peer.generation == 2
    await second.peer.request("shutdown")
    assert await second.wait() == 0
    await supervisor.close()
