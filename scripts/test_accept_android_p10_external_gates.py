import pytest

from accept_android_p10_physical_device_matrix import classify_device, validate_matrix, validate_observations
from accept_android_p10_usability import evaluate


def participant(index: int, *, assisted: bool = False, seconds: int = 150) -> dict:
    return {
        "participant_id": f"participant-{index}", "is_developer": False,
        "tasks": {name: "completed" for name in ("first_configuration", "search", "file_task", "error_recovery")},
        "first_success_seconds": seconds, "assistance_count": 1 if assisted else 0,
        "critical_misauthorizations": 0,
    }


def test_usability_accepts_exactly_four_unassisted_and_three_minute_median():
    result = evaluate({"participants": [participant(i, assisted=i == 4) for i in range(5)], "issues": []})
    assert result["passed"] is True
    assert result["metrics"]["unassisted_complete"] == 4


def test_usability_fails_closed_for_misauthorization_and_open_issue():
    rows = [participant(i) for i in range(5)]
    rows[0]["critical_misauthorizations"] = 1
    assert evaluate({"participants": rows, "issues": []})["passed"] is False
    with pytest.raises(ValueError, match="closure"):
        evaluate({"participants": rows, "issues": [{"description": "confusing", "status": "open"}]})


def test_usability_rejects_developers_or_incomplete_cohort():
    with pytest.raises(ValueError, match="exactly_five"):
        evaluate({"participants": [participant(i) for i in range(4)], "issues": []})
    rows = [participant(i) for i in range(5)]
    rows[0]["is_developer"] = True
    with pytest.raises(ValueError, match="non_developers"):
        evaluate({"participants": rows, "issues": []})


def test_physical_matrix_classifies_phone_and_tablet_and_validates_pair():
    phone = classify_device(serial="phone", state="device", qemu="0", abi="arm64-v8a", api=35, size="Physical size: 1080x2400", density="Physical density: 420")
    tablet = classify_device(serial="tablet", state="device", qemu="0", abi="arm64-v8a", api=36, size="Physical size: 1600x2560", density="Physical density: 320")
    assert phone["form_factor"] == "phone"
    assert tablet["form_factor"] == "tablet"
    validate_matrix([phone, tablet])


def test_physical_matrix_rejects_emulator_non_arm64_or_one_form_factor():
    with pytest.raises(RuntimeError, match="physical_device"):
        classify_device(serial="emulator-5554", state="device", qemu="1", abi="x86_64", api=35, size="1080x2400", density="420")
    phone = classify_device(serial="phone", state="device", qemu="0", abi="arm64-v8a", api=35, size="1080x2400", density="420")
    with pytest.raises(RuntimeError, match="phone_and_tablet"):
        validate_matrix([phone])


def test_physical_observations_require_every_journey_and_media():
    journeys = {name: True for name in ("login", "first_success", "tools", "approval", "background", "recovery", "accessibility")}
    assert validate_observations({"devices": [{"serial": "phone", "journeys": journeys, "evidence": ["phone.mp4"]}]}, {"phone"})["phone"]["journeys"] == journeys
    broken = dict(journeys)
    broken["login"] = False
    with pytest.raises(ValueError, match="all_observed"):
        validate_observations({"devices": [{"serial": "phone", "journeys": broken, "evidence": ["phone.mp4"]}]}, {"phone"})
