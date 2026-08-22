from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

from opendrsai_regression.desktop_p3 import DesktopAutomationError, DesktopEvidence, DesktopStep, ElectronE2eTransport, summarize_runtime_evidence_for_persistence, validate_evidence, write_case_evidence


CASE = {"input": {"messages": [{"parts": [{"type": "text", "text": "hello"}]}]}}


def evidence() -> DesktopEvidence:
    return DesktopEvidence(
        transport="windows_native", window_pid=41, session_id="session-p3",
        input_sha256=hashlib.sha256(b"hello").hexdigest(), user_message_visible=True,
        final_response_visible=True, no_error_banner=True, final_screenshot="ui-final.png",
        steps=(DesktopStep("send", "2026-08-06T00:00:00Z", "ui-final.png", "chat-composer"),), run_id="run-p3",
    )


def test_validates_real_ui_proof(tmp_path: Path) -> None:
    (tmp_path / "ui-final.png").write_bytes(b"png")
    value = validate_evidence(CASE, evidence(), tmp_path)
    assert value["transport"] == "windows_native"
    assert value["final_screenshot_sha256"] == hashlib.sha256(b"png").hexdigest()


def test_rejects_gateway_like_evidence_without_visible_message(tmp_path: Path) -> None:
    (tmp_path / "ui-final.png").write_bytes(b"png")
    value = evidence()
    invalid = DesktopEvidence(**{**value.to_dict(), "user_message_visible": False})
    with pytest.raises(DesktopAutomationError, match="desktop_ui_send_not_visible"):
        validate_evidence(CASE, invalid, tmp_path)


def test_writes_auditable_summary(tmp_path: Path) -> None:
    (tmp_path / "ui-final.png").write_bytes(b"png")
    path = write_case_evidence(tmp_path, "qa.greeting.hello", evidence(), CASE)
    assert '"case_id": "qa.greeting.hello"' in path.read_text(encoding="utf-8")


def test_electron_transport_requires_ui_result_fields(tmp_path: Path) -> None:
    source = tmp_path / "source.png"; source.write_bytes(b"png")
    result = tmp_path / "result.json"
    result.write_text(json.dumps({"details": {"screenshotPath": str(source), "windowPid": 9, "sessionId": "s", "runId": "r", "userMessageVisible": True, "finalResponseVisible": True}}), encoding="utf-8")
    evidence_root = tmp_path / "evidence"
    evidence_root.mkdir()
    (evidence_root / "runtime-raw.json").write_text(json.dumps({"run": {"status": "completed"}}), encoding="utf-8")
    transport = ElectronE2eTransport([sys.executable, "-c", "pass"], result, evidence_root)
    actual = transport.send_and_wait(text="hello", timeout_seconds=5)
    assert actual.transport == "electron_e2e"
    assert actual.final_screenshot == "ui-final.png"
    assert actual.runtime_payload == {"run": {"status": "completed"}}
    assert not (evidence_root / "runtime-raw.json").exists()


def test_electron_transport_classifies_model_login_failure(tmp_path: Path) -> None:
    result = tmp_path / "result.json"
    result.write_text(json.dumps({"details": {"modelVerification": "anonymous"}}), encoding="utf-8")
    transport = ElectronE2eTransport([sys.executable, "-c", "import sys; sys.exit(1)"], result, tmp_path / "evidence")
    with pytest.raises(DesktopAutomationError, match="desktop_ui_model_verification_requires_login"):
        transport.send_and_wait(text="hello", timeout_seconds=5)


def test_electron_transport_classifies_model_verification_timeout(tmp_path: Path) -> None:
    result = tmp_path / "result.json"
    result.write_text(json.dumps({"details": {"modelVerification": "timed_out"}}), encoding="utf-8")
    transport = ElectronE2eTransport([sys.executable, "-c", "import sys; sys.exit(1)"], result, tmp_path / "evidence")
    with pytest.raises(DesktopAutomationError, match="desktop_ui_model_verification_timeout"):
        transport.send_and_wait(text="hello", timeout_seconds=5)


def test_runtime_persistence_summary_does_not_keep_response_or_raw_event_content() -> None:
    summary = summarize_runtime_evidence_for_persistence({
        "output": "private model response", "run": {"id": "run-1", "status": "completed", "output": "private"},
        "items": [{"id": "event-1", "type": "tool_call", "content": {"text": "private"}}],
        "capabilities": ["web_search"], "available": {"run": True}, "evidence_complete": True,
    })
    serialized = json.dumps(summary)
    assert "private model response" not in serialized
    assert '"content"' not in serialized
    assert summary["output_sha256"] == hashlib.sha256(b"private model response").hexdigest()
