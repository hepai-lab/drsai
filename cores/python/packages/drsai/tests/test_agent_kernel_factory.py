from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

from drsai.backend import run_drsai_agent_factory as desktop_factory
from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel, kernel_factory_identity
from drsai.backend.runtime.mobile_adapter import DesktopMobileCoreAdapter, TuiMobileCoreAdapter
from drsai.backend.runtime.mobile_core import DrSaiAgentKernel
from drsai.config.loader import parse_user_config


class _Client:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _assistant(**kwargs):
    return kwargs


class _AssistantObject:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def test_all_surface_factories_return_same_agent_type_and_kernel_digest() -> None:
    kernels = [create_agent_kernel(surface=surface) for surface in ("desktop", "tui", "android", "test")]

    assert {type(kernel) for kernel in kernels} == {DrSaiAgentKernel}
    assert {kernel.agent_type for kernel in kernels} == {"drsai-agent-kernel"}
    assert len({kernel_factory_identity(kernel)["kernel_sha256"] for kernel in kernels}) == 1
    assert len({kernel_factory_identity(kernel)["base_prompt_sha256"] for kernel in kernels}) == 1
    assert kernel_factory_identity(kernels[0])["capability_manifest_sha256"] != kernel_factory_identity(kernels[2])[
        "capability_manifest_sha256"
    ]
    assert [kernel._factory_runtime_surface for kernel in kernels] == ["desktop", "desktop", "android", "desktop"]


def test_factory_rejects_unknown_surface_and_non_factory_instance() -> None:
    with pytest.raises(ValueError, match="agent_kernel_surface_invalid"):
        create_agent_kernel(surface="ios")
    with pytest.raises(RuntimeError, match="agent_kernel_factory_identity_missing"):
        kernel_factory_identity(DrSaiAgentKernel())


def test_desktop_and_tui_adapters_use_the_only_kernel_factory() -> None:
    desktop = DesktopMobileCoreAdapter()
    tui = TuiMobileCoreAdapter()

    assert desktop.agent_type == tui.agent_type == "drsai-agent-kernel"
    assert type(desktop._core) is type(tui._core) is DrSaiAgentKernel
    assert desktop.kernel_identity["kernel_sha256"] == tui.kernel_identity["kernel_sha256"]


def test_desktop_production_factory_attaches_shared_kernel(monkeypatch, tmp_path: Path) -> None:
    config = parse_user_config({
        "model": "factory-model",
        "model_provider": "factory-provider",
        "model_providers": {
            "factory-provider": {"base_url": "https://provider.example/v1", "api_key": "not-live"},
        },
    })
    monkeypatch.setattr(desktop_factory, "load_user_config", lambda: config)
    monkeypatch.setattr(desktop_factory, "HepAIChatCompletionClient", _Client)

    desktop = desktop_factory.create_agent(
        cli_cfg={"workspace_enabled": True}, assistant_cls=_assistant, work_dir=str(tmp_path),
    )
    tui = desktop_factory.create_agent(
        cli_cfg={"workspace_enabled": True}, assistant_cls=_assistant, work_dir=str(tmp_path), kernel_surface="tui",
    )

    assert type(desktop["_shared_agent_kernel"]) is type(tui["_shared_agent_kernel"]) is DrSaiAgentKernel
    assert desktop["_shared_agent_kernel"]._factory_surface == "desktop"
    assert tui["_shared_agent_kernel"]._factory_surface == "tui"


def test_desktop_production_factory_cannot_be_switched_back_to_a_legacy_loop(monkeypatch, tmp_path: Path) -> None:
    config = parse_user_config({
        "model": "factory-model", "model_provider": "factory-provider",
        "model_providers": {"factory-provider": {"base_url": "https://provider.example/v1", "api_key": "not-live"}},
    })
    monkeypatch.setattr(desktop_factory, "load_user_config", lambda: config)
    monkeypatch.setattr(desktop_factory, "HepAIChatCompletionClient", _Client)
    monkeypatch.setenv("DRSAI_P9_DESKTOP_KERNEL_LEGACY", "1")
    agent = desktop_factory.create_agent(
        cli_cfg={"workspace_enabled": True}, assistant_cls=_AssistantObject, work_dir=str(tmp_path),
    )
    assert type(agent._shared_agent_kernel) is DrSaiAgentKernel
    assert not hasattr(agent, "_use_shared_agent_kernel_run_stream")


def test_android_probe_uses_same_factory_type_and_identity() -> None:
    repo = Path(__file__).parents[5]
    runtime_root = repo / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    sys.path[:0] = [str(runtime_root), str(android_python)]
    try:
        probe = importlib.import_module("runtime_probe")
        probe.reset()
        health = json.loads(probe.health())
        assert type(probe._core).__name__ == DrSaiAgentKernel.__name__
        assert health["agent_type"] == "drsai-agent-kernel"
        assert health["agent_kernel"]["kernel_sha256"] == kernel_factory_identity(
            create_agent_kernel(surface="desktop")
        )["kernel_sha256"]
    finally:
        sys.path.remove(str(runtime_root))
        sys.path.remove(str(android_python))
        sys.modules.pop("runtime_probe", None)


def test_production_adapters_do_not_construct_agent_loop_directly() -> None:
    repo = Path(__file__).parents[5]
    paths = [
        repo / "apps/android/app/src/main/python/runtime_probe.py",
        repo / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_adapter.py",
        repo / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/factory.py",
        repo / "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py",
    ]
    for path in paths:
        source = path.read_text(encoding="utf-8")
        assert "DrSaiAgentKernel(" not in source
        assert "MobileAgentCore(" not in source
    assert "DRSAI_P9_DESKTOP_KERNEL_LEGACY" not in paths[-1].read_text(encoding="utf-8")
