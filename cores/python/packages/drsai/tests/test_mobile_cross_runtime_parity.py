import importlib
import json
import sys
from pathlib import Path

from drsai.backend.runtime.mobile_adapter import (
    DesktopMobileCoreAdapter,
    TuiMobileCoreAdapter,
    create_surface_mobile_core,
)
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


REPO = Path(__file__).parents[5]
FIXTURE = REPO / "cores/protocol/android-runtime/fixtures/mobile-core-parity-v1.json"


def normalized_events(outbound: list[dict] | tuple[RuntimeEnvelope, ...]) -> list[dict]:
    values = [item.to_dict() if isinstance(item, RuntimeEnvelope) else item for item in outbound]
    return [item["payload"] for item in values if item["message_type"] == MessageType.RUNTIME_EVENT.value]


def test_desktop_tui_and_android_probe_have_exact_event_parity() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    runtime_root = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = REPO / "apps/android/app/src/main/python"
    sys.path[:0] = [str(runtime_root), str(android_python)]
    try:
        probe = importlib.import_module("runtime_probe")
        for scenario in fixture["scenarios"]:
            commands = [RuntimeEnvelope.from_dict(value) for value in scenario["commands"]]
            desktop = DesktopMobileCoreAdapter().execute_many(commands)
            tui = TuiMobileCoreAdapter().execute_many(commands)
            probe.reset()
            android = []
            for value in scenario["commands"]:
                android.extend(json.loads(probe.execute(json.dumps(value)))["outbound"])

            expected = scenario["expected_events"]
            desktop_events = normalized_events(desktop)
            assert [item["kind"] for item in desktop_events] == expected
            assert normalized_events(tui) == desktop_events
            assert normalized_events(android) == desktop_events
    finally:
        sys.path.remove(str(runtime_root))
        sys.path.remove(str(android_python))
        sys.modules.pop("runtime_probe", None)


def test_production_surface_factory_selects_shared_core_adapters() -> None:
    assert isinstance(create_surface_mobile_core("desktop"), DesktopMobileCoreAdapter)
    assert isinstance(create_surface_mobile_core("tui"), TuiMobileCoreAdapter)
