"""Asynchronous feedback triage Agent and email notification worker."""

from __future__ import annotations

import asyncio
import json
import os
import smtplib
import ssl
import threading
import time
from dataclasses import dataclass, asdict
from email.message import EmailMessage
from typing import Any

import httpx

from drsai.backend.feedback_service import FeedbackStore, redact


TRIAGE_SYSTEM_PROMPT = """You are Dr. Zhengde, OpenDrSai's operations feedback triage agent.
Analyze only the supplied redacted feedback facts. Never invent reproduction evidence or claim a fix.
Return one JSON object with: summary, category, module, severity, recommended_owner, needs_more_info.
category must be bug, usability, suggestion, or feature_request. severity must be low, medium,
high, critical, or unknown. High/critical decisions are recommendations requiring human review."""


@dataclass
class FeedbackWorkerStatus:
    running: bool = False
    triage_configured: bool = False
    mail_configured: bool = False
    last_run_at: str | None = None
    completed_jobs: int = 0
    failed_jobs: int = 0
    deferred_jobs: int = 0
    last_error: str | None = None


class DrZhengdeFeedbackAgent:
    """Bounded JSON-only Agent adapter for feedback classification."""

    def __init__(self, *, base_url: str, api_key: str, model: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @classmethod
    def from_environment(cls) -> DrZhengdeFeedbackAgent | None:
        base_url = os.getenv("OPENDRSAI_FEEDBACK_AGENT_BASE_URL", "").strip()
        api_key = os.getenv("OPENDRSAI_FEEDBACK_AGENT_API_KEY", "").strip()
        model = os.getenv("OPENDRSAI_FEEDBACK_AGENT_MODEL", "").strip()
        if not (base_url and api_key and model):
            return None
        return cls(base_url=base_url, api_key=api_key, model=model)

    def triage(self, report: dict[str, Any]) -> dict[str, Any]:
        safe_report = {
            "feedback_id": report.get("feedback_id"),
            "category": report.get("category"),
            "source": report.get("source"),
            "user_description": report.get("user_description"),
            "context": report.get("context"),
            "error_fingerprint": report.get("error_fingerprint"),
            "diagnostics": report.get("diagnostics"),
        }
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json={
                "model": self.model,
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(safe_report, ensure_ascii=False)},
                ],
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        body = response.json()
        content = body.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str) or len(content) > 20_000:
            raise ValueError("Feedback Agent returned an invalid response.")
        result = json.loads(content)
        if not isinstance(result, dict):
            raise ValueError("Feedback Agent result must be an object.")
        return result


class FeedbackEmailNotifier:
    """SMTP notification adapter; it never receives diagnostic attachment bytes."""

    def __init__(self, *, host: str, port: int, sender: str, recipients: list[str], username: str = "", password: str = "", use_tls: bool = True):
        self.host = host
        self.port = port
        self.sender = sender
        self.recipients = recipients
        self.username = username
        self.password = password
        self.use_tls = use_tls

    @classmethod
    def from_environment(cls) -> FeedbackEmailNotifier | None:
        host = os.getenv("OPENDRSAI_FEEDBACK_SMTP_HOST", "").strip()
        sender = os.getenv("OPENDRSAI_FEEDBACK_MAIL_FROM", "").strip()
        recipients = [item.strip() for item in os.getenv("OPENDRSAI_FEEDBACK_MAIL_TO", "").split(",") if item.strip()]
        if not (host and sender and recipients):
            return None
        return cls(
            host=host,
            port=int(os.getenv("OPENDRSAI_FEEDBACK_SMTP_PORT", "587")),
            sender=sender,
            recipients=recipients,
            username=os.getenv("OPENDRSAI_FEEDBACK_SMTP_USERNAME", ""),
            password=os.getenv("OPENDRSAI_FEEDBACK_SMTP_PASSWORD", ""),
            use_tls=os.getenv("OPENDRSAI_FEEDBACK_SMTP_TLS", "1") != "0",
        )

    def notify(self, report: dict[str, Any]) -> None:
        triage = report.get("triage") or {}
        severity = triage.get("severity") or "untriaged"
        message = EmailMessage()
        message["Subject"] = f"[OpenDrSai feedback][{severity}] {report['feedback_id']}"
        message["From"] = self.sender
        message["To"] = ", ".join(self.recipients)
        # No raw contact address, diagnostics, screenshot, conversation, local
        # path, or attachment is placed in email. Operators follow the id into
        # the audited feedback service.
        message.set_content(
            "\n".join([
                f"Feedback ID: {report['feedback_id']}",
                f"Category: {report['category']}",
                f"Source: {report['source']}",
                f"Status: {report['status']}",
                f"Severity: {severity}",
                f"Module: {triage.get('module') or report.get('context', {}).get('module', 'unknown')}",
                "Open the protected feedback console to review authorized evidence.",
            ])
        )
        with smtplib.SMTP(self.host, self.port, timeout=15) as client:
            if self.use_tls:
                client.starttls(context=ssl.create_default_context())
            if self.username:
                client.login(self.username, self.password)
            client.send_message(message)


class FeedbackWorker:
    def __init__(self, store: FeedbackStore, *, interval_seconds: float = 5.0):
        self.store = store
        self.interval_seconds = max(0.25, interval_seconds)
        self.agent = DrZhengdeFeedbackAgent.from_environment()
        self.notifier = FeedbackEmailNotifier.from_environment()
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._status = FeedbackWorkerStatus(
            triage_configured=self.agent is not None,
            mail_configured=self.notifier is not None,
        )
        self._status_lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        with self._status_lock:
            return asdict(self._status)

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="feedback-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=max(2.0, self.interval_seconds + 1))
            except TimeoutError:
                self._task.cancel()
            self._task = None

    async def run_once(self) -> dict[str, int]:
        try:
            await asyncio.to_thread(self.store.enforce_retention, int(os.getenv("OPENDRSAI_FEEDBACK_RETENTION_DAYS", "30")))
            result = await asyncio.to_thread(
                self.store.run_pending_jobs,
                self.agent.triage if self.agent else None,
                self.notifier.notify if self.notifier else None,
            )
            with self._status_lock:
                self._status.last_run_at = utc_now()
                self._status.completed_jobs += result["completed"]
                self._status.failed_jobs += result["failed"]
                self._status.deferred_jobs += result["deferred"]
                self._status.last_error = None
            return result
        except Exception as exc:
            with self._status_lock:
                self._status.last_run_at = utc_now()
                self._status.last_error = str(redact(str(exc)).value)[:500]
            return {"completed": 0, "failed": 1, "deferred": 0}

    async def _run(self) -> None:
        with self._status_lock:
            self._status.running = True
        try:
            while not self._stop.is_set():
                await self.run_once()
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self.interval_seconds)
                except TimeoutError:
                    pass
        finally:
            with self._status_lock:
                self._status.running = False


def utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
