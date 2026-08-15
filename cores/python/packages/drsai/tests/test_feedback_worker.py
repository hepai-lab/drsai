from __future__ import annotations

import asyncio
import json
from email import message_from_bytes

import httpx

from drsai.backend.feedback_service import FeedbackStore, FeedbackSubmitModel
from drsai.backend.feedback_worker import DrZhengdeFeedbackAgent, FeedbackEmailNotifier, FeedbackWorker


def stored_report(store: FeedbackStore) -> str:
    report = FeedbackSubmitModel.model_validate({
        "client_feedback_id": "worker-feedback-001",
        "category": "bug",
        "source": "error",
        "user_description": "Runtime failed",
        "context": {"module": "runtime.gateway", "error_code": "offline"},
        "consent": {"diagnostics": True},
        "diagnostics": {"status": "offline"},
    })
    record, _created = store.submit(report)
    return record["feedback_id"]


def test_dr_zhengde_agent_sends_only_bounded_redacted_facts(monkeypatch) -> None:
    captured = {}

    def post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "Runtime cannot connect", "category": "bug", "module": "runtime.gateway",
            "severity": "high", "recommended_owner": "desktop-runtime", "needs_more_info": False,
        })}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    agent = DrZhengdeFeedbackAgent(base_url="https://agent.example/v1", api_key="private-key", model="ops")
    result = agent.triage({
        "feedback_id": "FB-1", "category": "bug", "source": "error", "user_description": "failed",
        "context": {"module": "runtime.gateway"}, "error_fingerprint": "abc", "diagnostics": {"attached": True},
        "contact_address": "user@example.com", "fixed_in_version": "secret-version",
    })
    assert result["severity"] == "high"
    encoded = json.dumps(captured["json"])
    assert "user@example.com" not in encoded
    assert "secret-version" not in encoded
    assert captured["headers"]["Authorization"] == "Bearer private-key"


def test_email_notification_contains_reference_only(monkeypatch) -> None:
    sent = []

    class SMTP:
        def __init__(self, *_args, **_kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def starttls(self, **_kwargs): pass
        def login(self, *_args): pass
        def send_message(self, message): sent.append(message.as_bytes())

    monkeypatch.setattr("smtplib.SMTP", SMTP)
    notifier = FeedbackEmailNotifier(host="smtp.example", port=587, sender="feedback@example.com", recipients=["ops@example.com"], username="u", password="p")
    notifier.notify({
        "feedback_id": "FB-1", "category": "bug", "source": "crash", "status": "triaged",
        "triage": {"severity": "critical", "module": "desktop.main"},
        "contact_address": "user-private@example.com", "user_description": "private text",
        "diagnostics": {"attached": True, "sha256": "private-hash"},
    })
    assert len(sent) == 1
    raw = sent[0].decode(errors="replace")
    assert "FB-1" in raw
    assert "user-private@example.com" not in raw
    assert "private text" not in raw
    assert "private-hash" not in raw


def test_worker_defers_unconfigured_providers_without_losing_jobs(tmp_path) -> None:
    store = FeedbackStore(tmp_path / "feedback")
    feedback_id = stored_report(store)
    worker = FeedbackWorker(store, interval_seconds=0.01)
    assert asyncio.run(worker.run_once()) == {"completed": 0, "failed": 0, "deferred": 2}
    assert store.get(feedback_id)["status"] == "received"
    with store._connect() as connection:
        assert connection.execute("SELECT count(*) FROM feedback_jobs WHERE state = 'pending'").fetchone()[0] == 2


def test_worker_processes_agent_then_mail_and_exposes_health(tmp_path) -> None:
    store = FeedbackStore(tmp_path / "feedback")
    feedback_id = stored_report(store)
    worker = FeedbackWorker(store, interval_seconds=0.01)

    class Agent:
        def triage(self, _report):
            return {"summary": "Runtime offline", "category": "bug", "module": "runtime.gateway", "severity": "high", "recommended_owner": "runtime"}

    notified = []
    class Notifier:
        def notify(self, report): notified.append((report["feedback_id"], report["triage"]["summary"]))

    worker.agent = Agent()
    worker.notifier = Notifier()
    result = asyncio.run(worker.run_once())
    assert result == {"completed": 2, "failed": 0, "deferred": 0}
    assert notified == [(feedback_id, "Runtime offline")]
    assert store.get(feedback_id)["status"] == "triaged"
    assert worker.status()["completed_jobs"] == 2

