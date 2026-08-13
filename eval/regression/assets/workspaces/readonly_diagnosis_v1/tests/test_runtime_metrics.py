import sys
from pathlib import Path


if __name__ == "__main__":
    # A directly executed script receives tests/ rather than the Workspace
    # root on sys.path.  Add only this frozen fixture root; no environment or
    # installed dependency is required.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.runtime_metrics import success_rate

# The first test is the frozen failing baseline used by the diagnosis case.

def test_success_rate_empty_returns_zero() -> None:
    assert success_rate([]) == 0.0


def test_success_rate_counts_completed_events() -> None:
    events = [
        {"status": "completed"},
        {"status": "failed"},
        {"status": "completed"},
    ]

    assert success_rate(events) == 2 / 3


if __name__ == "__main__":
    # Keep this frozen diagnostic fixture runnable in the packaged Runtime,
    # where development-only pytest is intentionally absent.  The uncaught
    # exception is the expected baseline evidence for the Agent to diagnose.
    test_success_rate_empty_returns_zero()
    test_success_rate_counts_completed_events()
