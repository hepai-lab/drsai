import json
from pathlib import Path


REPO = Path(__file__).parents[5]
LEDGER = REPO / "docs/android/reports/progress/ANDROID_P10_ACCEPTANCE_LEDGER.json"


def test_p10_ledger_is_complete_unique_and_fail_closed() -> None:
    value = json.loads(LEDGER.read_text(encoding="utf-8"))
    expected = [f"M{module:02d}-F{feature:02d}" for module in range(1, 11) for feature in range(1, 7)]
    items = value["items"]

    assert value["schema_version"] == 1
    assert value["expected_total"] == 60
    assert [item["id"] for item in items] == expected
    assert len({item["id"] for item in items}) == 60
    assert {item["status"] for item in items} <= {"pending", "accepted"}
    assert not all(item["status"] == "accepted" for item in items)
    for item in items:
        if item["status"] != "accepted":
            continue
        assert item["tests"], item["id"]
        assert item["evidence"], item["id"]
        for relative in [*item["tests"], *item["evidence"]]:
            assert (REPO / relative).is_file(), f"{item['id']}:{relative}"


def test_release_candidate_claim_depends_on_both_p9_and_p10_ledgers() -> None:
    gradle = (REPO / "apps/android/app/build.gradle.kts").read_text(encoding="utf-8")

    assert "val p10ProductizationComplete = p10AcceptanceItems.all" in gradle
    assert "val p10ReleaseCandidateReady = desktopAgentParityComplete && p10ProductizationComplete" in gradle
    assert 'buildConfigField("boolean", "P10_RELEASE_CANDIDATE_READY", p10ReleaseCandidateReady.toString())' in gradle
    assert 'buildConfigField("boolean", "P10_RELEASE_CANDIDATE_READY", "true")' not in gradle
