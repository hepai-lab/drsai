from __future__ import annotations

import pytest

from p5_secret_canary import (
    canary_set_sha256,
    derive_canaries,
    expected_canary_set_sha256,
)


def test_canary_set_is_deterministic_unique_and_run_bound() -> None:
    first = derive_canaries("p5-run-one")
    assert first == derive_canaries("p5-run-one")
    assert len(first) == len(set(first)) == 4
    assert all(value.startswith("p5-canary-v1-") and len(value) == 77 for value in first)
    assert first != derive_canaries("p5-run-two")
    assert canary_set_sha256(first) == expected_canary_set_sha256("p5-run-one")


@pytest.mark.parametrize("value", ["", "short", "contains space", "x" * 129])
def test_invalid_run_id_fails_closed(value: str) -> None:
    with pytest.raises(RuntimeError, match="p5_secret_canary_run_id_invalid"):
        derive_canaries(value)


def test_wrong_set_cardinality_fails_closed() -> None:
    with pytest.raises(RuntimeError, match="p5_secret_canary_set_invalid"):
        canary_set_sha256(["duplicate"] * 4)
