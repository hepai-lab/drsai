from __future__ import annotations

import os

import pytest

from drsai.backend.runtime.security_boundary import (
    AppContainerProfile,
    WindowsAppContainerError,
    WindowsAppContainerProfileFactory,
    WindowsAppContainerWorkerLauncher,
    WindowsIsolationProbe,
)


class FakeApi:
    def __init__(self, *, create_result: int = 0, sid: int = 1234, delete_result: int = 0):
        self.create_result = create_result
        self.sid = sid
        self.delete_result = delete_result
        self.created: list[str] = []
        self.deleted: list[str] = []
        self.freed: list[int] = []

    def create_profile(self, name: str) -> tuple[int, int]:
        self.created.append(name)
        return self.create_result, self.sid

    def delete_profile(self, name: str) -> int:
        self.deleted.append(name)
        return self.delete_result

    def free_sid(self, sid: int) -> None:
        self.freed.append(sid)

    def sid_to_string(self, sid: int) -> str:
        return f"S-1-15-2-{sid}"


def test_profile_names_are_unique_owned_and_do_not_disclose_run_id() -> None:
    api = FakeApi()
    factory = WindowsAppContainerProfileFactory(api)
    first = factory.create("run-with-secret-name")
    second = factory.create("run-with-secret-name")
    assert first.name != second.name
    assert "run-with-secret-name" not in first.name
    assert first.name.startswith("OpenDrSai.Worker.")
    assert len(first.name) <= 64
    first.close()
    second.close()
    assert api.freed == [1234, 1234]
    assert api.deleted == api.created


def test_profile_close_is_idempotent_and_cleanup_failure_is_visible() -> None:
    api = FakeApi(delete_result=-2147024891)  # 0x80070005
    profile = WindowsAppContainerProfileFactory(api).create("run-1")
    with pytest.raises(WindowsAppContainerError) as rejected:
        profile.close()
    assert rejected.value.code == "appcontainer_profile_delete_failed"
    assert rejected.value.hresult == 0x80070005
    # SID memory is released once, while profile deletion remains retryable.
    api.delete_result = 0
    profile.close()
    profile.close()
    assert len(api.deleted) == 2 and len(api.freed) == 1


@pytest.mark.parametrize("result,sid", [(-2147024894, 0), (0, 0), (-2147024891, 99)])
def test_failed_or_sidless_creation_never_deletes_unowned_profile(result: int, sid: int) -> None:
    api = FakeApi(create_result=result, sid=sid)
    with pytest.raises(WindowsAppContainerError) as rejected:
        WindowsAppContainerProfileFactory(api).create("run-2")
    assert rejected.value.code == "appcontainer_profile_create_failed"
    assert api.deleted == []
    assert api.freed == ([sid] if sid else [])


def test_missing_run_identity_fails_before_native_api() -> None:
    api = FakeApi()
    with pytest.raises(WindowsAppContainerError) as rejected:
        WindowsAppContainerProfileFactory(api).create("")
    assert rejected.value.code == "appcontainer_run_id_missing"
    assert api.created == []


@pytest.mark.skipif(os.name != "nt", reason="real AppContainer lifecycle requires Windows")
def test_real_profile_lifecycle_is_verified_or_reports_host_unavailable() -> None:
    try:
        profile = WindowsAppContainerProfileFactory().create("real-probe")
    except WindowsAppContainerError as error:
        # Managed Windows sandboxes can lack the AppModel repository required
        # by CreateAppContainerProfile.  This remains an explicit unavailable
        # state, never authority to launch with the caller token.
        assert error.code == "appcontainer_profile_create_failed"
        assert error.hresult is not None
        return
    profile.close()


@pytest.mark.skipif(os.name != "nt", reason="worker request validation requires Windows")
def test_worker_rejects_closed_profile_and_ambiguous_environment(tmp_path) -> None:
    launcher = WindowsAppContainerWorkerLauncher()
    closed = AppContainerProfile("closed", 0, "S-1-15-2-0", FakeApi(), True)
    with pytest.raises(WindowsAppContainerError) as rejected:
        launcher.run(closed, ("cmd.exe",), cwd=tmp_path, environment={}, timeout_seconds=1)
    assert rejected.value.code == "appcontainer_profile_closed"

    for environment in ({"BAD=KEY": "value"}, {"KEY": "bad\x00value"}):
        with pytest.raises(WindowsAppContainerError) as rejected:
            launcher._environment_block(environment)
        assert rejected.value.code == "appcontainer_environment_invalid"


@pytest.mark.skipif(os.name != "nt", reason="environment block requires Windows")
def test_worker_environment_block_contains_only_explicit_sorted_values() -> None:
    block = WindowsAppContainerWorkerLauncher._environment_block({"z": "last", "A": "first"})
    assert block.value == "A=first"
    assert "z=last\x00\x00" in "".join(block[:])
    assert "PATH=" not in "".join(block[:]).upper()


@pytest.mark.skipif(os.name != "nt", reason="Windows capability probe requires Windows")
def test_capability_probe_records_operational_profile_and_caches_mutating_check() -> None:
    api = FakeApi()
    probe = WindowsIsolationProbe(
        appcontainer_factory=WindowsAppContainerProfileFactory(api),
    )
    first = probe.probe()
    second = probe.probe()
    assert first.appcontainer_profile_operational is True
    assert first.appcontainer_profile_hresult is None
    assert second.appcontainer_profile_operational is True
    assert len(api.created) == len(api.deleted) == 1
