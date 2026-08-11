from pathlib import Path

from drsai.relay.device_audit import DeviceActionAudit, DeviceActionKey


def test_device_labels_are_user_readable_content_free_and_bounded() -> None:
    audit = DeviceActionAudit(capacity=2)
    first = DeviceActionKey("runtime", "workspace", "run-one", "run.created")
    second = DeviceActionKey("runtime", "workspace", "run-two", "run.cancelled")
    third = DeviceActionKey("runtime", "workspace", "run-three", "approval.approved")
    audit.record(first, "device-a")
    assert audit.label(first, "device-a") == "此设备"
    assert audit.label(first, "device-b") == "另一台已授权设备"
    audit.record(second, "device-b")
    audit.record(third, "device-c")
    assert audit.label(first, "device-a") == "已授权设备"


def test_device_actor_digest_survives_restart_without_raw_identifier(tmp_path: Path) -> None:
    path = tmp_path / "audit.sqlite3"
    key = DeviceActionKey("runtime", "workspace", "run", "run.created")
    first = DeviceActionAudit(path=path)
    first.record(key, "device-secret")
    first.close()
    assert b"device-secret" not in path.read_bytes()
    restored = DeviceActionAudit(path=path)
    assert restored.label(key, "device-secret") == "此设备"
    assert restored.label(key, "device-other") == "另一台已授权设备"
