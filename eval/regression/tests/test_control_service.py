from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_regression.control_service import RegressionControlService


ROOT = Path(__file__).resolve().parents[1]


def begin(service: RegressionControlService) -> dict:
    case = service.catalog_api.get_case("qa.greeting.hello")
    return service.begin_evaluation(
        suite_id="p3-desktop",
        case_id=case["id"],
        case_revision=case["revision"],
        definition_sha256=case["definition_sha256"],
    )


def test_persists_visible_desktop_lifecycle_and_run_identity(tmp_path: Path) -> None:
    service = RegressionControlService(ROOT, tmp_path)
    value = begin(service)
    evaluation_id = value["evaluation_id"]
    service.transition(evaluation_id, "preparing_session")
    service.transition(evaluation_id, "filling_composer")
    service.transition(evaluation_id, "ready_to_send")
    service.transition(evaluation_id, "sending")
    running = service.attach_run(evaluation_id, thread_id="thread-1", run_id="run-1", input_sha256="a" * 64)
    assert running["status"] == "running"
    assert running["thread_id"] == "thread-1"
    assert service.list_history()[0]["evaluation_id"] == evaluation_id
    assert [event["data"]["status"] for event in service.list_events(evaluation_id)] == [
        "preflighting", "preparing_session", "filling_composer", "ready_to_send", "sending", "running"
    ]


def test_rejects_stale_case_revision_or_hash(tmp_path: Path) -> None:
    service = RegressionControlService(ROOT, tmp_path)
    case = service.catalog_api.get_case("qa.greeting.hello")
    with pytest.raises(ValueError, match="regression_case_definition_changed"):
        service.begin_evaluation(
            suite_id="p3-desktop", case_id=case["id"], case_revision=case["revision"] + 1,
            definition_sha256=case["definition_sha256"],
        )


def test_enforces_state_machine_and_idempotent_terminal_cancel(tmp_path: Path) -> None:
    service = RegressionControlService(ROOT, tmp_path)
    value = begin(service)
    with pytest.raises(ValueError, match="Invalid evaluation transition"):
        service.transition(value["evaluation_id"], "running")
    cancelled = service.cancel(value["evaluation_id"])
    assert cancelled["status"] == "cancelled"
    assert service.cancel(value["evaluation_id"])["status"] == "cancelled"
