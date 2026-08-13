from __future__ import annotations

import verify_p6_full_boundary_secret_scan as verifier


def test_p6_eleven_source_pipeline_is_content_free_and_fail_closed() -> None:
    result = verifier.verify()
    assert result == {
        "passed": True,
        "source_count": 11,
        "encoding_mode_count": 6,
        "encoding_variant_count": 16,
        "encoding_variants_detected": 16,
        "raw_artifacts_exported": False,
        "missing_or_empty_source_fail_closed": True,
    }
