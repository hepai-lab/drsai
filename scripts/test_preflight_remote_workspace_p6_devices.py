from __future__ import annotations

import json
from pathlib import Path
import subprocess

import pytest

import preflight_remote_workspace_p6_devices as preflight


class FakeRunner:
    def __init__(self, devices: str, properties: dict[tuple[str, str], str] | None = None):
        self.devices = devices
        self.properties = properties or {}

    def __call__(self, command, **kwargs):
        if command[1:] == ["devices"]:
            output = self.devices
        else:
            serial = command[2]
            prop = command[-1]
            output = self.properties.get((serial, prop), "")
        return subprocess.CompletedProcess(command, 0, output + ("\n" if output else ""), "")


def _properties(*serials: str) -> dict[tuple[str, str], str]:
    values: dict[tuple[str, str], str] = {}
    for serial in serials:
        values[(serial, "ro.kernel.qemu")] = "0"
        values[(serial, "ro.product.cpu.abi")] = "arm64-v8a"
        values[(serial, "ro.product.manufacturer")] = "hardware-vendor"
        values[(serial, "ro.build.fingerprint")] = f"release/{serial}"
    return values


def test_two_distinct_physical_devices_pass_without_raw_identity() -> None:
    runner = FakeRunner(
        "List of devices attached\nhardware-a\tdevice\nhardware-b\tdevice\n",
        _properties("hardware-a", "hardware-b"),
    )
    report = preflight.collect(Path("adb"), runner=runner)
    assert report["passed"] is True
    assert report["online_physical_devices"] == 2
    encoded = json.dumps(report)
    assert "hardware-a" not in encoded
    assert "hardware-b" not in encoded
    assert report["raw_device_identity_exported"] is False


def test_emulator_unauthorized_and_offline_are_excluded() -> None:
    properties = _properties("hardware-a")
    properties[("emulator-5554", "ro.kernel.qemu")] = "1"
    properties[("emulator-5554", "ro.product.cpu.abi")] = "x86_64"
    properties[("emulator-5554", "ro.product.manufacturer")] = "Google"
    properties[("emulator-5554", "ro.build.fingerprint")] = "sdk"
    runner = FakeRunner(
        "List of devices attached\nemulator-5554\tdevice\nhardware-a\tdevice\n"
        "hardware-b\tunauthorized\nhardware-c\toffline\n",
        properties,
    )
    report = preflight.collect(Path("adb"), runner=runner)
    assert report["passed"] is False
    assert report["online_physical_devices"] == 1
    assert report["emulator_count"] == 1
    assert report["unauthorized_count"] == 1
    assert report["offline_count"] == 1


def test_incomplete_or_duplicate_device_identity_fails_closed() -> None:
    runner = FakeRunner("List of devices attached\nhardware-a\tdevice\n", {})
    with pytest.raises(RuntimeError, match="identity_incomplete"):
        preflight.collect(Path("adb"), runner=runner)
    properties = _properties("same")
    runner = FakeRunner("List of devices attached\nsame\tdevice\nsame\tdevice\n", properties)
    with pytest.raises(RuntimeError, match="duplicate_device"):
        preflight.collect(Path("adb"), runner=runner)


def test_required_count_cannot_weaken_two_device_gate() -> None:
    with pytest.raises(ValueError, match="two_devices_required"):
        preflight.collect(Path("adb"), required_devices=1, runner=FakeRunner("List of devices attached\n"))

