from copy import deepcopy

import pytest

from assemble_remote_workspace_stability_p5 import assemble
from finalize_remote_workspace_p5 import REQUIRED_FAULTS


DIGEST = "a" * 64


def base() -> dict:
    return {
        "passed": True, "required_duration_seconds": 3600, "observed_duration_seconds": 3601,
        "probe_error_count": 0, "duplicate_sequence_count": 0, "missing_sequence_count": 0,
        "reexecuted_side_effect_count": 0, "relay_latency_p95_ms": 100,
        "windows_memory_slope_bytes_per_second": 1, "windows_handle_slope_per_second": 0,
        "faults": [{"name": name, "status": "passed", "sequence_preserved": True,
                    "oaep_hash_preserved": True, "duplicate_sequence_count": 0,
                    "missing_sequence_count": 0, "reexecuted_side_effect_count": 0}
                   for name in sorted(REQUIRED_FAULTS)],
    }


def endpoints() -> list[dict]:
    return [{"schema_version": "p5-stability-endpoint/1", "environment_id": "env", "boundary": boundary,
             "transcript_sha256": DIGEST, "passed": True}
            for boundary in ("android", "desktop", "runtime")]


def test_assembles_same_environment_content_free_attestations() -> None:
    assert assemble(base(), endpoints(), "env")["passed"] is True


@pytest.mark.parametrize("mutation,code", [
    (lambda b, e: b.update(observed_duration_seconds=3599), "duration"),
    (lambda b, e: e[0].update(environment_id="other"), "mixed_environment"),
    (lambda b, e: e[0].update(transcript_sha256="b" * 64), "transcript_mismatch"),
    (lambda b, e: b["faults"][0].update(reexecuted_side_effect_count=1), "fault_failed"),
])
def test_incomplete_or_mixed_stability_fails_closed(mutation, code: str) -> None:
    report, rows = deepcopy(base()), deepcopy(endpoints())
    mutation(report, rows)
    with pytest.raises(RuntimeError, match=code):
        assemble(report, rows, "env")
