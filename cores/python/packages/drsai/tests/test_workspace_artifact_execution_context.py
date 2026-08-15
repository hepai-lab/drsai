from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from drsai.backend.run_drsai_agent_factory import _build_cwd_prompt
from drsai.modules.agents.skills_agent import drsai_assistant as assistant_module
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant
from drsai.modules.agents.skills_agent.managers import get_managers_tools


def test_create_local_venv_separates_process_cwd_from_environment(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "中文 workspace"
    private_storage = tmp_path / "private"
    observed: dict[str, Path] = {}

    class FakeBuilder:
        def __init__(self, *, with_pip: bool):
            assert with_pip is True

        def create(self, path: Path) -> None:
            observed["venv"] = path

        def ensure_directories(self, path: Path):
            return SimpleNamespace(env_dir=str(path))

    class FakeExecutor:
        def __init__(self, *, work_dir: Path, virtual_env_context):
            observed["cwd"] = work_dir
            observed["context"] = Path(virtual_env_context.env_dir)

    monkeypatch.setattr(get_managers_tools.venv, "EnvBuilder", FakeBuilder)
    monkeypatch.setattr(get_managers_tools, "LocalCommandLineCodeExecutor", FakeExecutor)

    get_managers_tools.create_local_venv(
        workspace, environment_dir=private_storage,
    )

    assert observed["cwd"] == workspace
    assert observed["venv"] == private_storage / ".venv"
    assert observed["context"] == private_storage / ".venv"
    assert workspace.is_dir()
    assert private_storage.is_dir()
    assert not (workspace / ".venv").exists()


def test_code_executor_uses_current_runtime_workspace_and_private_environment(
    tmp_path: Path, monkeypatch,
) -> None:
    workspace = tmp_path / "默认 工作区"
    private_tmp = tmp_path / "runs" / "user" / "tmp"
    observed: dict[str, Path] = {}

    def fake_create_local_venv(*, work_dir, environment_dir=None):
        observed["cwd"] = Path(work_dir)
        observed["environment"] = Path(environment_dir)
        return object()

    class FakeCodeExecutorAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def lazy_init(self) -> None:
            return None

    monkeypatch.setattr(assistant_module, "create_local_venv", fake_create_local_venv)
    monkeypatch.setattr(assistant_module, "CodeExecutorAgent", FakeCodeExecutorAgent)

    assistant = object.__new__(DrSaiAssistant)
    assistant._user_sub_agents = {
        "code_executor": {"type": "CodeExecutorAgent", "description": "exec", "tools": "*"},
    }
    assistant._local_executor = None
    assistant._runtime_workspace_path = workspace
    assistant._user_profile_manager = SimpleNamespace(tmp_dir=private_tmp)

    child = asyncio.run(assistant.get_sub_agent_instance("code_executor", object()))

    assert isinstance(child, FakeCodeExecutorAgent)
    assert observed == {"cwd": workspace, "environment": private_tmp}
    assert (workspace / "artifacts").is_dir()


def test_workspace_prompt_distinguishes_deliverables_from_private_temp(tmp_path: Path) -> None:
    workspace = tmp_path / "默认 工作区"
    prompt = _build_cwd_prompt({}, str(workspace))

    assert str(workspace) in prompt
    assert "`artifacts/`" in prompt
    assert "private temporary storage" in prompt
    assert "never report an internal storage path" in prompt


def test_configured_code_executor_venv_does_not_replace_workspace_cwd(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    configured_venv_root = tmp_path / "managed-environment"
    observed = {}

    def fake_create_local_venv(*, work_dir, environment_dir=None):
        observed.update(work_dir=Path(work_dir), environment_dir=Path(environment_dir))
        return object()

    class FakeCodeExecutorAgent:
        def __init__(self, **_kwargs):
            pass

        async def lazy_init(self) -> None:
            return None

    monkeypatch.setattr(assistant_module, "create_local_venv", fake_create_local_venv)
    monkeypatch.setattr(assistant_module, "CodeExecutorAgent", FakeCodeExecutorAgent)
    assistant = object.__new__(DrSaiAssistant)
    assistant._user_sub_agents = {
        "code_executor": {"type": "CodeExecutorAgent", "venv_path": str(configured_venv_root)},
    }
    assistant._local_executor = None
    assistant._runtime_workspace_path = workspace
    assistant._user_profile_manager = SimpleNamespace(tmp_dir=tmp_path / "private-tmp")

    asyncio.run(assistant.get_sub_agent_instance("code_executor", object()))

    assert observed == {"work_dir": workspace, "environment_dir": configured_venv_root}
