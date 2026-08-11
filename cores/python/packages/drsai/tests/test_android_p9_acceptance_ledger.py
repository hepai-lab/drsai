import json
from pathlib import Path


REPO = Path(__file__).parents[5]
LEDGER = REPO / "docs/android/reports/progress/ANDROID_P9_ACCEPTANCE_LEDGER.json"


def test_p9_ledger_is_complete_unique_and_only_accepts_items_with_evidence() -> None:
    value = json.loads(LEDGER.read_text(encoding="utf-8"))
    expected = [f"M{module:02d}-F{feature:02d}" for module in range(1, 13) for feature in range(1, 7)]
    items = value["items"]

    assert value["schema_version"] == 1
    assert value["expected_total"] == 72
    assert [item["id"] for item in items] == expected
    assert len({item["id"] for item in items}) == 72
    assert {item["status"] for item in items} <= {"pending", "accepted"}
    for item in items:
        if item["status"] != "accepted":
            continue
        assert item["tests"], item["id"]
        assert item["evidence"], item["id"]
        for relative in [*item["tests"], *item["evidence"]]:
            assert (REPO / relative).is_file(), f"{item['id']}:{relative}"


def test_android_desktop_parity_claim_is_derived_from_all_72_accepted_items() -> None:
    gradle = (REPO / "apps/android/app/build.gradle.kts").read_text(encoding="utf-8")
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))

    assert "val desktopAgentParityComplete = p9AcceptanceItems.all" in gradle
    assert 'buildConfigField("boolean", "DESKTOP_AGENT_PARITY_COMPLETE", desktopAgentParityComplete.toString())' in gradle
    assert 'buildConfigField("boolean", "DESKTOP_AGENT_PARITY_COMPLETE", "true")' not in gradle
    assert not all(item["status"] == "accepted" for item in ledger["items"])
