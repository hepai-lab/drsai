from __future__ import annotations

import pytest

from drsai.backend.runtime.sandbox_compute import MAX_VALUES, execute_declarative_compute


def test_whitelisted_numeric_operations_are_deterministic() -> None:
    assert execute_declarative_compute({"operation": "sum", "values": [0.1, 0.2, 0.3]})["result"] == pytest.approx(0.6)
    assert execute_declarative_compute({"operation": "median", "values": [9, 1, 3]})["result"] == 3
    histogram = execute_declarative_compute({"operation": "histogram", "values": [0, 1, 2, 3], "bins": 2})
    assert histogram["result"]["counts"] == [2, 2]


@pytest.mark.parametrize("argument", [
    {"operation": "eval", "values": [1]},
    {"operation": "sum", "values": [1], "code": "__import__('os')"},
    {"operation": "sum", "values": [1], "path": "/data/data/private"},
    {"operation": "sum", "values": [1], "url": "https://example.com"},
    {"operation": "sum", "values": [float("inf")]},
    {"operation": "sum", "values": [1] * (MAX_VALUES + 1)},
])
def test_code_import_file_network_nonfinite_and_memory_escape_inputs_fail_closed(argument: dict) -> None:
    with pytest.raises(ValueError):
        execute_declarative_compute(argument)


def test_cpu_budget_exhaustion_terminates_with_stable_error() -> None:
    ticks = iter((0.0, 1.0))
    with pytest.raises(TimeoutError, match="compute_timeout"):
        execute_declarative_compute({"operation": "sort", "values": [3, 2, 1]}, clock=lambda: next(ticks))
