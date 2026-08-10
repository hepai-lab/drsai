"""P3 Desktop acceptance primitives.

The Gateway is intentionally not a UI transport.  A transport must operate a
real OpenDrSai window and return independently verifiable UI evidence.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol


class DesktopAutomationError(RuntimeError):
    """A stable P3 Desktop automation failure."""


@dataclass(frozen=True)
class DesktopStep:
    name: str
    timestamp: str
    screenshot: str | None = None
    target: str | None = None
    retries: int = 0


@dataclass(frozen=True)
class DesktopEvidence:
    transport: str
    window_pid: int
    session_id: str
    input_sha256: str
    user_message_visible: bool
    final_response_visible: bool
    no_error_banner: bool
    final_screenshot: str
    steps: tuple[DesktopStep, ...]
    run_id: str | None = None
    final_response_text: str = ""
    runtime_payload: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class DesktopUiTransport(Protocol):
    name: str

    def send_and_wait(self, *, text: str, timeout_seconds: int) -> DesktopEvidence:
        """Send text through the visible Desktop chat UI and wait for completion."""


class ElectronE2eTransport:
    """Consumes a real Electron E2E invocation's UI evidence.

    The command is deliberately supplied by the caller: it may launch an
    unpacked app or a development app, but it must write the OpenDrSai E2E
    result file and screenshot itself.  This prevents the regression runner
    from silently creating a Gateway-only substitute.
    """

    name = "electron_e2e"

    def __init__(self, command: list[str], result_path: Path, evidence_root: Path, extra_env: dict[str, str] | None = None):
        self.command = command
        self.result_path = result_path
        self.evidence_root = evidence_root
        self.extra_env = extra_env or {}

    def send_and_wait(self, *, text: str, timeout_seconds: int) -> DesktopEvidence:
        if not self.command:
            raise DesktopAutomationError("desktop_automation_transport_unavailable")
        screenshot = self.evidence_root / "ui-final.png"
        runtime_payload = self.evidence_root / "runtime-raw.json"
        env = {**os.environ, **self.extra_env, "OPENDRSAI_P3_INPUT": text, "OPENDRSAI_E2E_RESULT": str(self.result_path), "OPENDRSAI_E2E_SCREENSHOT": str(screenshot), "OPENDRSAI_E2E_RUNTIME_EVIDENCE": str(runtime_payload)}
        try:
            completed = subprocess.run(self.command, env=env, timeout=timeout_seconds, capture_output=True, text=True, encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired as exc:
            tail = exc.stderr or exc.stdout or b""
            if isinstance(tail, bytes):
                tail = tail.decode("utf-8", errors="replace")
            raise DesktopAutomationError(f"desktop_ui_timeout: {str(tail).replace(chr(10), ' ')[-800:]}") from exc
        if completed.returncode != 0:
            if self.result_path.is_file():
                try:
                    failed_payload = json.loads(self.result_path.read_text(encoding="utf-8"))
                    failed_details = failed_payload.get("details") if isinstance(failed_payload.get("details"), dict) else {}
                    verification = str(failed_details.get("modelVerification") or "")
                    if verification in {"anonymous", "requires_login", "auth_required"}:
                        raise DesktopAutomationError("desktop_ui_model_verification_requires_login")
                    if verification == "timed_out":
                        raise DesktopAutomationError("desktop_ui_model_verification_timeout")
                except json.JSONDecodeError:
                    pass
            tail = (completed.stderr or completed.stdout or "").strip().replace("\r", "").replace("\n", " ")[-800:]
            raise DesktopAutomationError(f"desktop_ui_electron_e2e_failed: {tail or 'no process output'}")
        if not self.result_path.is_file():
            raise DesktopAutomationError("desktop_ui_electron_e2e_result_missing")
        payload = json.loads(self.result_path.read_text(encoding="utf-8"))
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        source_screenshot = details.get("screenshotPath") or payload.get("screenshotPath")
        if not isinstance(source_screenshot, str) or not source_screenshot:
            raise DesktopAutomationError("desktop_ui_screenshot_missing")
        source = Path(source_screenshot)
        if not source.is_file():
            raise DesktopAutomationError("desktop_ui_screenshot_missing")
        self.evidence_root.mkdir(parents=True, exist_ok=True)
        target = screenshot
        if source.resolve() != target.resolve():
            target.write_bytes(source.read_bytes())
        visible = bool(details.get("userMessageVisible", payload.get("userMessageVisible", False)))
        response = bool(details.get("finalResponseVisible", payload.get("finalResponseVisible", False)))
        runtime_evidence = None
        if runtime_payload.is_file():
            try:
                candidate = json.loads(runtime_payload.read_text(encoding="utf-8"))
                runtime_evidence = candidate if isinstance(candidate, dict) else None
            except json.JSONDecodeError as exc:
                raise DesktopAutomationError("desktop_ui_runtime_evidence_invalid") from exc
            finally:
                # Raw Gateway payloads are an ephemeral assertion input only;
                # reports retain the redacted, summarized evidence below.
                runtime_payload.unlink(missing_ok=True)
        return DesktopEvidence(
            transport=self.name, window_pid=int(details.get("windowPid") or payload.get("windowPid") or 0),
            session_id=str(details.get("sessionId") or payload.get("sessionId") or ""),
            input_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(), user_message_visible=visible,
            final_response_visible=response, no_error_banner=not bool(details.get("errorBannerVisible", False)),
            final_screenshot=target.name, steps=(DesktopStep("electron_e2e", datetime.now(timezone.utc).isoformat(), target.name),),
            run_id=details.get("runId") or payload.get("runId"), final_response_text=str(details.get("finalResponseText") or ""), runtime_payload=runtime_evidence,
        )


def input_text(case: dict) -> str:
    messages = case.get("input", {}).get("messages", [])
    parts = messages[0].get("parts", []) if messages else []
    text = "\n".join(str(part.get("text", "")) for part in parts if part.get("type") == "text")
    if not text:
        raise DesktopAutomationError("desktop_ui_input_missing")
    return text


def validate_evidence(case: dict, evidence: DesktopEvidence, evidence_root: Path) -> dict:
    """Validate P3's non-negotiable UI proof, without inspecting Gateway output."""
    expected = hashlib.sha256(input_text(case).encode("utf-8")).hexdigest()
    screenshot = evidence_root / evidence.final_screenshot
    if evidence.transport not in {"computer_use", "windows_native", "electron_e2e"}:
        raise DesktopAutomationError("desktop_automation_transport_invalid")
    if evidence.window_pid <= 0 or not evidence.session_id:
        raise DesktopAutomationError("desktop_ui_window_binding_invalid")
    if evidence.input_sha256 != expected:
        raise DesktopAutomationError("desktop_ui_input_mismatch")
    if not evidence.user_message_visible:
        raise DesktopAutomationError("desktop_ui_send_not_visible")
    if not evidence.final_response_visible:
        raise DesktopAutomationError("desktop_ui_response_not_visible")
    if not evidence.no_error_banner:
        raise DesktopAutomationError("desktop_ui_error_banner_visible")
    if not screenshot.is_file() or screenshot.stat().st_size == 0:
        raise DesktopAutomationError("desktop_ui_screenshot_missing")
    return {
        "transport": evidence.transport,
        "window_pid": evidence.window_pid,
        "session_id": evidence.session_id,
        "run_id": evidence.run_id,
        "input_sha256": evidence.input_sha256,
        "final_response_sha256": hashlib.sha256(evidence.final_response_text.encode("utf-8")).hexdigest(),
        "final_screenshot": evidence.final_screenshot,
        "final_screenshot_sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest(),
        "steps": [asdict(step) for step in evidence.steps],
        "accepted_at": datetime.now(timezone.utc).isoformat(),
    }


def write_case_evidence(root: Path, case_id: str, evidence: DesktopEvidence, case: dict) -> Path:
    """Write redacted P3 UI evidence next to the screenshot, not into case data."""
    root.mkdir(parents=True, exist_ok=True)
    payload = {
        "case_id": case_id,
        "ui": validate_evidence(case, evidence, root),
        # Keep the visual response in the screenshot; the summary only retains
        # a digest so a report cannot accidentally persist an upstream response.
        "final_response_sha256": hashlib.sha256(evidence.final_response_text.encode("utf-8")).hexdigest(),
    }
    destination = root / "run-summary.json"
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return destination


def summarize_runtime_evidence_for_persistence(evidence: dict) -> dict:
    """Keep P3 reports auditable without persisting model replies or raw events."""
    event_keys = ("id", "type", "kind", "status", "tool", "tool_name", "skill", "skill_id", "operation", "name", "relative_path")

    def event(value: object) -> dict:
        return {key: item for key in event_keys if (item := value.get(key)) is not None} if isinstance(value, dict) else {}

    groups = (
        "items", "tool_calls", "tool_attempts", "citations", "artifacts", "skill_activations", "knowledge_queries",
        "approvals", "operation_calls", "shell_commands", "workspace_reads", "workspace_writes", "retrieved_documents",
        "external_writes", "external_network_calls", "network_calls", "unauthorized_writes", "writes_outside_allowed_root",
        "file_creations", "file_deletions", "patch_operations", "git_write_operations", "workspace_search_calls",
        "unrelated_tool_calls", "unrelated_skill_activations",
    )
    persisted = {key: [event(item) for item in evidence.get(key, []) if isinstance(item, dict)] for key in groups}
    persisted.update({
        "run": event(evidence.get("run")),
        "manifest": event(evidence.get("manifest")),
        "capabilities": list(evidence.get("capabilities") or []),
        "logical_tool_call_count": evidence.get("logical_tool_call_count", 0),
        "available": dict(evidence.get("available") or {}),
        "missing": list(evidence.get("missing") or []),
        "evidence_complete": bool(evidence.get("evidence_complete")),
        "output_sha256": hashlib.sha256(str(evidence.get("output") or "").encode("utf-8")).hexdigest(),
    })
    return persisted
