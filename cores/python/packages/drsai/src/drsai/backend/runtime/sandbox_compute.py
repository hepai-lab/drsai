from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
import math
import statistics
import time
from typing import Any, Callable


POLICY_VERSION = "p9-declarative-compute-v1"
MAX_VALUES = 10_000
MAX_INPUT_BYTES = 256 * 1024
MAX_BINS = 100
TIME_BUDGET_SECONDS = 0.25
OPERATIONS = frozenset({"count", "sum", "mean", "median", "min", "max", "sort", "histogram"})


def execute_declarative_compute(
    arguments: Mapping[str, Any], *, clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Run bounded numeric operations; accepts no source code, imports, paths, or URLs."""
    if set(arguments) - {"operation", "values", "bins"}:
        raise ValueError("compute_argument_forbidden")
    operation = arguments.get("operation")
    values = arguments.get("values")
    if operation not in OPERATIONS:
        raise ValueError("compute_operation_invalid")
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes, bytearray)):
        raise ValueError("compute_values_invalid")
    if not values or len(values) > MAX_VALUES:
        raise ValueError("compute_values_limit")
    if len(json.dumps(dict(arguments), separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > MAX_INPUT_BYTES:
        raise ValueError("compute_input_limit")
    numbers: list[float] = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError("compute_value_invalid")
        numbers.append(float(value))
    started = clock()
    if operation == "count":
        result: Any = len(numbers)
    elif operation == "sum":
        result = math.fsum(numbers)
    elif operation == "mean":
        result = statistics.fmean(numbers)
    elif operation == "median":
        result = statistics.median(numbers)
    elif operation == "min":
        result = min(numbers)
    elif operation == "max":
        result = max(numbers)
    elif operation == "sort":
        result = sorted(numbers)
    else:
        bins = arguments.get("bins", 10)
        if isinstance(bins, bool) or not isinstance(bins, int) or bins not in range(1, MAX_BINS + 1):
            raise ValueError("compute_bins_invalid")
        low, high = min(numbers), max(numbers)
        counts = [0] * bins
        if low == high:
            counts[0] = len(numbers)
        else:
            width = (high - low) / bins
            for value in numbers:
                index = min(int((value - low) / width), bins - 1)
                counts[index] += 1
        result = {"min": low, "max": high, "bins": bins, "counts": counts}
    if clock() - started > TIME_BUDGET_SECONDS:
        raise TimeoutError("compute_timeout")
    return {"policy_version": POLICY_VERSION, "operation": operation, "count": len(numbers), "result": result}
