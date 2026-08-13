"""Regression tests for profile storage path resolution."""

from pathlib import Path

from drsai.modules.agents.skills_agent.managers import user_profile_manager


def test_relative_profile_storage_is_rooted_under_runtime_home(tmp_path, monkeypatch):
    runtime_root = tmp_path / "drsai-home" / "workspace" / "runs"
    monkeypatch.setattr(user_profile_manager, "WORKSPACE_RUNS_DIR", str(runtime_root))

    manager = user_profile_manager.UserProfileManager(
        agent_name="test",
        work_dir="x",
        user_id="x",
        thread_id="test-thread",
    )

    assert manager.work_dir == runtime_root / "x"
    assert (manager.work_dir / "configs" / "USER_CONFIG.json").is_file()


def test_relative_profile_storage_cannot_escape_runtime_home(tmp_path, monkeypatch):
    runtime_root = tmp_path / "drsai-home" / "workspace" / "runs"
    monkeypatch.setattr(user_profile_manager, "WORKSPACE_RUNS_DIR", str(runtime_root))

    try:
        user_profile_manager.UserProfileManager("test", "../outside", "user", "test-thread")
    except ValueError as error:
        assert "inside DRSAI_HOME/workspace/runs" in str(error)
    else:
        raise AssertionError("Expected a relative path traversal attempt to be rejected.")
