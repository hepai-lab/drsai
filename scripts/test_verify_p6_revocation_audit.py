from __future__ import annotations

import verify_p6_revocation_audit as verifier


def test_revocation_and_audit_gate_covers_all_product_boundaries() -> None:
    result = verifier.verify()
    assert result["passed"] is True
    assert result["check_count"] == 5
    assert all(result["checks"].values())
