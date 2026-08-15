from __future__ import annotations

import json
import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from drsai.backend.feedback_service import FeedbackError, FeedbackStore, create_router


def report(**overrides):
    value = {
        "client_feedback_id": "desktop-feedback-0001",
        "category": "bug",
        "source": "error",
        "user_description": "Gateway failed using token=secret-value at C:\\Users\\alice\\project",
        "context": {
            "module": "runtime.gateway",
            "page": "chat",
            "app_version": "1.2.3",
            "runtime_version": "1.2.3",
            "electron_version": "39.8.10",
            "platform": "win32",
            "locale": "zh-CN",
            "workspace_id": "workspace-1",
            "thread_id": "thread-1",
            "run_id": "run-1",
            "trace_id": "trace-1",
            "error_code": "gateway_unavailable",
            "error_type": "ConnectionError",
            "breadcrumbs": [{"action": "send", "authorization": "Bearer private-token"}],
        },
        "consent": {"diagnostics": True, "contact": False},
        "diagnostics": {
            "health": "degraded",
            "api_key": "sk-this-must-not-survive",
            "message": "contact alice@example.com from 192.168.1.10",
        },
    }
    value.update(overrides)
    return value


@pytest.fixture()
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENDRSAI_FEEDBACK_ADMIN_TOKEN", "test-admin-token")
    store = FeedbackStore(tmp_path / "feedback")
    app = FastAPI()
    app.include_router(create_router(store))
    client = TestClient(app)
    client.headers.update({"X-OpenDrSai-Feedback-Admin": "test-admin-token"})
    return store, client


def test_intake_commits_redacted_encrypted_report_and_returns_stable_id(setup) -> None:
    store, client = setup
    payload = report()
    response = client.post(
        "/v1/feedback",
        headers={"Idempotency-Key": payload["client_feedback_id"]},
        json=payload,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["feedback_id"].startswith("FB-")
    assert body["status"] == "received"
    assert body["idempotent_replay"] is False
    assert body["diagnostics"]["attached"] is True
    assert body["diagnostics"]["sensitive_matches_removed"] >= 4
    assert "alice" not in body["user_description"]
    assert "secret-value" not in body["user_description"]

    attachment_files = list((store.attachments).glob("*.odfeedback"))
    assert len(attachment_files) == 1
    raw = attachment_files[0].read_bytes()
    assert b"sk-this-must-not-survive" not in raw
    assert b"degraded" not in raw  # the entire attachment is encrypted at rest
    diagnostics = store.diagnostic_payload(body["feedback_id"])
    assert diagnostics == {
        "api_key": "[REDACTED]",
        "health": "degraded",
        "message": "contact [EMAIL] from [IP]",
    }


def test_idempotency_replay_does_not_duplicate_record_or_jobs(setup) -> None:
    store, client = setup
    payload = report()
    headers = {"Idempotency-Key": payload["client_feedback_id"]}
    first = client.post("/v1/feedback", headers=headers, json=payload).json()
    second = client.post("/v1/feedback", headers=headers, json=payload).json()
    assert second["feedback_id"] == first["feedback_id"]
    assert second["idempotent_replay"] is True
    assert len(store.list()) == 1
    with store._connect() as connection:
        assert connection.execute("SELECT count(*) FROM feedback_jobs").fetchone()[0] == 2


def test_intake_rejects_mismatched_idempotency_and_unconsented_diagnostics(setup) -> None:
    store, client = setup
    payload = report(consent={"diagnostics": False}, diagnostics={"token": "secret"})
    mismatch = client.post("/v1/feedback", headers={"Idempotency-Key": "another-key"}, json=payload)
    assert mismatch.status_code == 400
    response = client.post(
        "/v1/feedback",
        headers={"Idempotency-Key": payload["client_feedback_id"]},
        json=payload,
    )
    assert response.status_code == 201
    assert response.json()["diagnostics"]["attached"] is False
    assert store.diagnostic_payload(response.json()["feedback_id"]) is None


def test_suggestions_require_description_and_unknown_fields_are_rejected(setup) -> None:
    _store, client = setup
    payload = report(category="suggestion", source="global", user_description="")
    response = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload)
    assert response.status_code == 422
    payload = report(unexpected="data")
    response = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload)
    assert response.status_code == 422


def test_triage_is_async_validated_duplicate_aware_and_model_failure_safe(setup) -> None:
    store, client = setup
    first_payload = report()
    first = client.post(
        "/v1/feedback", headers={"Idempotency-Key": first_payload["client_feedback_id"]}, json=first_payload
    ).json()
    second_payload = report(client_feedback_id="desktop-feedback-0002", user_description="Same failure")
    second = client.post(
        "/v1/feedback", headers={"Idempotency-Key": second_payload["client_feedback_id"]}, json=second_payload
    ).json()

    notified: list[str] = []

    def triage(item):
        return {
            "summary": "Gateway connection failure",
            "category": "bug",
            "module": "runtime.gateway",
            "severity": "high",
            "recommended_owner": "desktop-runtime",
        }

    result = store.run_pending_jobs(triage=triage, notify=lambda item: notified.append(item["feedback_id"]))
    assert result == {"completed": 4, "failed": 0, "deferred": 0}
    assert store.get(first["feedback_id"])["status"] == "triaged"
    assert store.get(second["feedback_id"])["duplicate_of"] == first["feedback_id"]
    assert set(notified) == {first["feedback_id"], second["feedback_id"]}

    third_payload = report(client_feedback_id="desktop-feedback-0003", context={**report()["context"], "error_code": "new"})
    third = client.post(
        "/v1/feedback", headers={"Idempotency-Key": third_payload["client_feedback_id"]}, json=third_payload
    ).json()
    failed = store.run_pending_jobs(triage=lambda _item: (_ for _ in ()).throw(RuntimeError("model token=secret")))
    assert failed["failed"] == 1
    assert store.get(third["feedback_id"])["status"] == "received"
    with store._connect() as connection:
        job = connection.execute("SELECT * FROM feedback_jobs WHERE feedback_id = ? AND kind = 'triage'", (third["feedback_id"],)).fetchone()
        assert job["state"] == "retry"
        assert "secret" not in (job["last_error"] or "")


def test_status_machine_and_public_contract_do_not_expose_contact_address(setup) -> None:
    store, client = setup
    payload = report(
        consent={"diagnostics": True, "contact": True},
        contact_address="maintainer@example.com",
    )
    created = client.post(
        "/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload
    ).json()
    assert "contact_address" not in created
    invalid = client.post(f"/v1/feedback/{created['feedback_id']}/status", json={"status": "fixed"})
    assert invalid.status_code == 409
    assert store.update_status(created["feedback_id"], type("Update", (), {"status": "triaged", "fixed_in_version": None, "note": ""})())["status"] == "triaged"
    investigating = client.post(f"/v1/feedback/{created['feedback_id']}/status", json={"status": "investigating"})
    assert investigating.status_code == 200
    listing = client.get("/v1/feedback").json()
    assert listing["count"] == 1
    assert "maintainer@example.com" not in json.dumps(listing)


def test_diagnostic_size_is_bounded_without_partial_commit(setup) -> None:
    store, client = setup
    payload = report(diagnostics={"data": "x" * 1_100_000})
    response = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload)
    assert response.status_code == 413
    assert store.list() == []


def test_corrupt_encrypted_attachment_fails_integrity_closed(setup) -> None:
    store, client = setup
    payload = report()
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    attachment = next(store.attachments.glob("*.odfeedback"))
    attachment.write_bytes(b"corrupt")
    with pytest.raises(FeedbackError, match="cannot be opened"):
        store.diagnostic_payload(created["feedback_id"])


def test_screenshot_requires_explicit_consent_and_is_encrypted_separately(setup) -> None:
    store, client = setup
    png = b"\x89PNG\r\n\x1a\n" + b"safe-image-bytes"
    data_url = "data:image/png;base64," + base64.b64encode(png).decode()
    payload = report(
        client_feedback_id="desktop-feedback-screenshot",
        consent={"diagnostics": True, "screenshot": True},
        screenshot_data_url=data_url,
        attachment_manifest=[{"kind": "screenshot", "byte_length": len(png)}],
    )
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    assert store.attachment_payload(created["feedback_id"], "screenshot") == png
    encrypted = next(store.attachments.glob("*.screenshot")).read_bytes()
    assert png not in encrypted

    payload = report(client_feedback_id="desktop-feedback-no-screenshot", consent={"diagnostics": True, "screenshot": False}, screenshot_data_url=data_url)
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    assert store.attachment_payload(created["feedback_id"], "screenshot") is None


def test_invalid_or_oversized_screenshot_fails_without_partial_commit(setup) -> None:
    store, client = setup
    payload = report(client_feedback_id="desktop-feedback-invalid-shot", consent={"diagnostics": True, "screenshot": True}, screenshot_data_url="data:image/png;base64,YmFk")
    response = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload)
    assert response.status_code == 400
    assert store.list() == []


def test_admin_endpoints_require_separate_operator_authorization(setup) -> None:
    _store, client = setup
    payload = report()
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    unauthorized = TestClient(client.app)
    assert unauthorized.get("/v1/feedback").status_code == 403
    assert unauthorized.get(f"/v1/feedback/{created['feedback_id']}").status_code == 403
    assert unauthorized.delete(f"/v1/feedback/{created['feedback_id']}").status_code == 403


def test_crash_dump_is_recovery_only_encrypted_and_deleted_with_feedback(setup) -> None:
    store, client = setup
    crash = b"MDMP" + b"crash-evidence"
    payload = report(
        client_feedback_id="desktop-feedback-crash",
        source="recovery",
        crash_dump_base64=base64.b64encode(crash).decode(),
        crash_dump_name="sample.dmp",
    )
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    assert store.attachment_payload(created["feedback_id"], "crash_dump") == crash
    crash_file = next(store.attachments.glob("*.minidump"))
    assert crash not in crash_file.read_bytes()
    deleted = client.delete(f"/v1/feedback/{created['feedback_id']}")
    assert deleted.status_code == 200
    assert not crash_file.exists()
    assert store.get(created["feedback_id"]) is None
    assert any(item["action"] == "feedback.delete" for item in store.audit(created["feedback_id"]))


def test_contact_address_is_encrypted_at_rest(setup) -> None:
    store, client = setup
    payload = report(consent={"diagnostics": True, "contact": True}, contact_address="private@example.com")
    response = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload)
    assert response.status_code == 201
    assert "private@example.com" not in store.database.read_bytes().decode("latin1")
    feedback_id = response.json()["feedback_id"]
    reveal = client.get(
        f"/v1/feedback/{feedback_id}/contact",
        headers={"X-OpenDrSai-Principal": "support@example.test"},
    )
    assert reveal.json()["contact_address"] == "private@example.com"
    audit = store.audit(feedback_id)
    assert any(item["action"] == "contact.read" and item["actor"] == "support@example.test" for item in audit)


def test_contact_reveal_requires_user_consent_and_operator_authorization(setup) -> None:
    store, client = setup
    payload = report(client_feedback_id="desktop-feedback-no-contact")
    created = client.post("/v1/feedback", headers={"Idempotency-Key": payload["client_feedback_id"]}, json=payload).json()
    assert client.get(f"/v1/feedback/{created['feedback_id']}/contact").status_code == 403
    unauthorized = TestClient(client.app)
    assert unauthorized.get(f"/v1/feedback/{created['feedback_id']}/contact").status_code == 403
    assert any(item["action"] == "contact.read" and item["result"] == "denied" for item in store.audit(created["feedback_id"]))


def test_remote_intake_is_opt_in_and_requires_bearer_token(tmp_path, monkeypatch) -> None:
    store = FeedbackStore(tmp_path / "feedback")
    app = FastAPI()
    app.include_router(create_router(store))
    remote = TestClient(app, client=("203.0.113.8", 41234))
    payload = report(client_feedback_id="desktop-feedback-remote")
    headers = {"Idempotency-Key": payload["client_feedback_id"]}
    assert remote.post("/v1/feedback", headers=headers, json=payload).status_code == 403
    monkeypatch.setenv("OPENDRSAI_FEEDBACK_ALLOW_REMOTE", "1")
    monkeypatch.setenv("OPENDRSAI_FEEDBACK_INTAKE_TOKEN", "remote-intake-secret")
    assert remote.post("/v1/feedback", headers=headers, json=payload).status_code == 403
    response = remote.post(
        "/v1/feedback",
        headers={**headers, "Authorization": "Bearer remote-intake-secret"},
        json=payload,
    )
    assert response.status_code == 201
