from src.runtime_metrics import success_rate


def test_success_rate_empty_returns_zero() -> None:
    assert success_rate([]) == 0.0


def test_success_rate_counts_completed_events() -> None:
    events = [
        {"status": "completed"},
        {"status": "failed"},
        {"status": "completed"},
    ]

    assert success_rate(events) == 2 / 3
