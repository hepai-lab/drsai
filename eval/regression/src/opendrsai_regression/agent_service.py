from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .catalog_api import RegressionCatalogApi
from .model_capability_runner import ModelCapabilityError, evaluate_case_model_preflight

TERMINAL_STATES = {"passed", "failed", "blocked", "cancelled"}
_PROCESSES: dict[str, subprocess.Popen[str]] = {}
_LOCK = threading.RLock()


class AgentRegressionService:
    """Persistent, conversational regression orchestration for the Agent Skill."""

    def __init__(self, catalog_root: str | Path, output_root: str | Path, workspace_path: str | Path | None = None):
        self.catalog_root = Path(catalog_root).resolve()
        self.output_root = Path(output_root).resolve()
        self.output_root.mkdir(parents=True, exist_ok=True)
        self.catalog = RegressionCatalogApi(self.catalog_root)
        self.workspace_path = Path(workspace_path).resolve() if workspace_path else None

    def preflight(self, suite_id: str, case_ids: list[str]) -> dict[str, Any]:
        listing = self.catalog.list_cases(suite_id)
        selected = self._select(listing, case_ids)
        risks = sorted({risk for item in selected for risk in _case_risks(self.catalog.get_case(item["id"]))})
        fixture = os.getenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE") == "1"
        missing = []
        gateway_available = bool(os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL") or os.getenv("DRSAI_API_PORT") or os.getenv("OPENDRSAI_GATEWAY_PORT"))
        if not fixture and not gateway_available:
            missing.append("gateway_url")
        if not fixture and gateway_available and self._workspace_id() is None:
            missing.append("workspace_registration")
        model_provider_status = None
        if not fixture and gateway_available and self.workspace_path is not None and "workspace_registration" not in missing:
            model_provider_status = self._model_provider_status()
            if model_provider_status.get("status") != "ready":
                missing.append(str(model_provider_status.get("missing") or "model_provider_status"))
        model_snapshot = self._model_snapshot()
        if not fixture and model_snapshot is None:
            missing.append("model_capability_snapshot")
        selected_cases = self.catalog.catalog.load_cases()
        selected_definitions = [selected_cases[item["id"]] for item in selected]
        model_prerequisites: list[str] = []
        if not fixture and model_snapshot is not None and not missing:
            try:
                base_model_id = str((model_provider_status or {}).get("model_id") or "")
                if not base_model_id:
                    raise ModelCapabilityError("Agent effective model is unavailable")
                model_ready, model_prerequisites = evaluate_case_model_preflight(
                    selected_definitions, model_snapshot, base_model_id=base_model_id,
                    role_models=dict((model_provider_status or {}).get("role_models") or {}),
                    expected_agent_id=(model_provider_status or {}).get("agent_id"),
                    expected_agent_policy_revision=(model_provider_status or {}).get("agent_policy_revision"),
                )
            except (OSError, json.JSONDecodeError, ModelCapabilityError) as exc:
                model_ready = False
                model_prerequisites = [f"capability snapshot invalid: {type(exc).__name__}"]
            if not model_ready:
                missing.append("model_prerequisites")
        required_skills = sorted({
            str(skill)
            for case in selected_definitions
            for skill in (case.data.get("environment") or {}).get("required_skills") or []
        })
        skill_status = None
        if not fixture and gateway_available and required_skills and not missing:
            skill_status = self._agent_skill_status(required_skills)
            if skill_status.get("status") != "ready":
                missing.append("agent_skills")
        confirmation_required = len(selected) > 1 or bool(risks)
        scope = {"suite_id": suite_id, "case_ids": [item["id"] for item in selected], "catalog_revision": listing["catalog_revision"], "risks": risks, "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}
        return {"status": "blocked" if missing else "ready", **scope, "confirmation_required": confirmation_required, "confirmation_token": self._sign(scope) if confirmation_required and not missing else None, "missing": list(dict.fromkeys(missing)), "adapter": "fixture" if fixture else "gateway", "model_capability_snapshot": str(model_snapshot) if model_snapshot else None, "model_prerequisites": model_prerequisites, "model_provider_status": model_provider_status, "skill_status": skill_status}

    def _agent_skill_status(self, required: list[str]) -> dict[str, Any]:
        url = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL")
        if not url:
            port = os.getenv("DRSAI_API_PORT") or os.getenv("OPENDRSAI_GATEWAY_PORT")
            url = f"http://127.0.0.1:{port}" if port else None
        if not url:
            return {"status": "blocked", "missing_ids": required}
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        token = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN") or os.getenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN")
        if token:
            headers["X-OpenDrSai-Gateway-Token"] = token
        agent_id = os.getenv("OPENDRSAI_REGRESSION_AGENT_ID", "opendrsai")
        request = urllib.request.Request(
            f"{url.rstrip('/')}/v1/config/agents/{urllib.parse.quote(agent_id, safe='')}/skills/preview",
            data=b"{}", headers=headers, method="POST",
        )
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
                value = json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
            return {"status": "blocked", "missing_ids": required, "error": "skill_preview_unavailable"}
        enabled = {str(item) for item in value.get("enabled_ids") or []} if isinstance(value, dict) else set()
        missing = sorted(set(required) - enabled)
        return {
            "status": "ready" if not missing else "blocked",
            "required_ids": required, "enabled_ids": sorted(enabled & set(required)), "missing_ids": missing,
            "revision": value.get("revision") if isinstance(value, dict) else None,
        }

    def start(self, suite_id: str, case_ids: list[str], catalog_revision: str, confirmation_token: str | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        preflight = self.preflight(suite_id, case_ids)
        if preflight["status"] != "ready":
            raise ValueError("regression_preflight_blocked:" + ",".join(preflight["missing"]))
        if preflight["catalog_revision"] != catalog_revision:
            raise ValueError("regression_catalog_revision_changed")
        if preflight["confirmation_required"]:
            self._verify(confirmation_token, preflight)
        normalized_options = _normalize_options(options)
        identity = hashlib.sha256(json.dumps({"suite_id": suite_id, "case_ids": preflight["case_ids"], "catalog_revision": catalog_revision, "options": normalized_options}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with _LOCK:
            existing = self._active_by_identity(identity)
            if existing:
                return existing
            evaluation_id = f"eval-{uuid.uuid4()}"
            now = _now()
            record = {"evaluation_id": evaluation_id, "suite_id": suite_id, "case_ids": preflight["case_ids"], "catalog_revision": catalog_revision, "options": normalized_options, "status": "preparing_environment", "created_at": now, "updated_at": now, "idempotency_key": identity, "adapter": preflight["adapter"], "scope_confirmed": bool(preflight["confirmation_required"]), "result": None, "error_code": None, "error_message": None}
            self._write(record)
            self._event(evaluation_id, "evaluation_started", {"status": record["status"], "case_ids": record["case_ids"]})
            threading.Thread(target=self._run, args=(evaluation_id,), daemon=True, name=f"regression-{evaluation_id[-8:]}").start()
            return record

    def get(self, evaluation_id: str) -> dict[str, Any]:
        return self._read(evaluation_id)

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        if limit < 1 or limit > 500:
            raise ValueError("regression_history_limit_invalid")
        values = []
        for path in self.output_root.glob("eval-*/evaluation.json"):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(value, dict) and isinstance(value.get("case_ids"), list):
                value = self._reconcile_interrupted(value)
                values.append(value)
        return sorted(values, key=lambda item: item.get("updated_at", ""), reverse=True)[:limit]

    def events(self, evaluation_id: str, after_cursor: int = 0) -> dict[str, Any]:
        path = self._dir(evaluation_id) / "events.jsonl"
        events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.is_file() else []
        if after_cursor < 0 or after_cursor > len(events):
            raise ValueError("regression_event_cursor_invalid")
        projected = [dict(event, cursor=index) for index, event in enumerate(events[after_cursor:], start=after_cursor + 1)]
        return {"events": projected, "next_cursor": len(events)}

    def cancel(self, evaluation_id: str) -> dict[str, Any]:
        with _LOCK:
            record = self._read(evaluation_id)
            if record["status"] in TERMINAL_STATES:
                return record
            process = _PROCESSES.get(evaluation_id)
            cancelled_run_ids = self._cancel_active_runs(evaluation_id)
            if process and process.poll() is None:
                process.terminate()
            partial = self._partial_result(evaluation_id, record.get("case_ids") or [])
            record.update(
                status="cancelled", updated_at=_now(), error_code="regression_cancelled",
                error_message=None, runner_pid=None, result=partial,
            )
            self._write(record)
            self._event(evaluation_id, "evaluation_status", {
                "status": "cancelled", "completed_cases": partial["total"],
                "not_run_case_ids": partial["not_run_case_ids"],
                "cancelled_run_ids": cancelled_run_ids, "result": partial,
            })
            return record

    def _run(self, evaluation_id: str) -> None:
        record = self._read(evaluation_id); directory = self._dir(evaluation_id); result_root = directory / "run-results"
        # The CLI's selection semantics intentionally union --suite and --case.
        # P4 already resolved and pinned the exact Suite subset, so pass only
        # those case IDs to prevent an individual request widening to the Suite.
        command = [sys.executable, str(self.catalog_root / "run_regression.py"), "run"]
        for case_id in record["case_ids"]: command.extend(["--case", case_id])
        command.extend(["--output", str(result_root), "--execution-id", evaluation_id, "--concurrency", "1"])
        if (record.get("options") or {}).get("failure_policy") == "stop":
            command.append("--stop-on-failure")
        if record.get("scope_confirmed") is True:
            command.append("--scope-confirmed")
        command.extend(["--adapter", "fixture", "--fixture-dir", str(self.catalog_root / "assets" / "evidence")] if record["adapter"] == "fixture" else ["--adapter", "gateway"])
        try:
            with _LOCK:
                record = self._read(evaluation_id)
                if record["status"] == "cancelled":
                    return
                record.update(status="running", updated_at=_now()); self._write(record); self._event(evaluation_id, "evaluation_status", {"status": "running"})
            with (directory / "runner.log").open("w", encoding="utf-8") as log:
                runner_env = os.environ.copy()
                progress_path = directory / "runner-progress.jsonl"
                runner_env["OPENDRSAI_REGRESSION_PROGRESS_PATH"] = str(progress_path)
                runner_env.setdefault("OPENDRSAI_REGRESSION_TEMP_ROOT", str(self.output_root / "fixtures"))
                port = runner_env.get("DRSAI_API_PORT") or runner_env.get("OPENDRSAI_GATEWAY_PORT")
                if port:
                    runner_env.setdefault("OPENDRSAI_REGRESSION_GATEWAY_URL", f"http://127.0.0.1:{port}")
                if runner_env.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN"):
                    runner_env.setdefault("OPENDRSAI_REGRESSION_GATEWAY_TOKEN", runner_env["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"])
                workspace_id = self._workspace_id()
                if workspace_id:
                    runner_env.setdefault("OPENDRSAI_REGRESSION_WORKSPACE_ID", workspace_id)
                snapshot = self._model_snapshot()
                if snapshot:
                    runner_env.setdefault("OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT", str(snapshot))
                process = subprocess.Popen(command, cwd=self.catalog_root.parent.parent, env=runner_env, stdout=log, stderr=subprocess.STDOUT, text=True)
                with _LOCK:
                    current = self._read(evaluation_id)
                    if current["status"] == "cancelled":
                        process.terminate()
                        return
                    current.update(runner_pid=process.pid, updated_at=_now()); self._write(current)
                    _PROCESSES[evaluation_id] = process
                results_path = result_root / evaluation_id / "results.jsonl"
                emitted_results = 0; emitted_progress = 0
                while process.poll() is None:
                    emitted_results = self._emit_case_events(evaluation_id, results_path, emitted_results)
                    emitted_progress = self._emit_runner_progress(evaluation_id, progress_path, emitted_progress)
                    time.sleep(0.25)
                return_code = process.returncode
                self._emit_case_events(evaluation_id, results_path, emitted_results)
                self._emit_runner_progress(evaluation_id, progress_path, emitted_progress)
            current = self._read(evaluation_id)
            if current["status"] == "cancelled": return
            current.update(status="collecting_evidence", updated_at=_now()); self._write(current); self._event(evaluation_id, "evaluation_status", {"status": "collecting_evidence"})
            summary_path = result_root / evaluation_id / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else None
            current.update(status="evaluating", updated_at=_now()); self._write(current); self._event(evaluation_id, "evaluation_status", {"status": "evaluating"})
            if summary:
                status = _summary_status(summary, len(current["case_ids"]))
                current["result"] = _safe_summary(summary, evaluation_id, current["case_ids"])
                _write_reference_documents(directory, current["result"], summary, evaluation_id)
                current["error_code"] = None if status == "passed" else "regression_assertions_not_passed"
            else:
                status = "failed"; current["error_code"] = "regression_runner_failed"; current["error_message"] = f"runner exited {return_code} without summary"
            current.update(status=status, updated_at=_now(), runner_pid=None); self._write(current); self._event(evaluation_id, "evaluation_status", {"status": status, "result": current.get("result")})
        except Exception as exc:
            current = self._read(evaluation_id)
            if current["status"] != "cancelled":
                current.update(status="failed", updated_at=_now(), error_code="regression_runner_failed", error_message=str(exc)[:500]); self._write(current); self._event(evaluation_id, "evaluation_status", {"status": "failed", "error_code": current["error_code"]})
        finally:
            with _LOCK: _PROCESSES.pop(evaluation_id, None)

    def _partial_result(self, evaluation_id: str, requested_case_ids: list[str]) -> dict[str, Any]:
        path = self._dir(evaluation_id) / "run-results" / evaluation_id / "results.jsonl"
        rows: list[dict[str, Any]] = []
        if path.is_file():
            try:
                rows = [
                    value for line in path.read_text(encoding="utf-8").splitlines()
                    if line.strip() and isinstance((value := json.loads(line)), dict)
                ]
            except (OSError, json.JSONDecodeError):
                rows = []
        summary = {
            "total": len(rows), "attempts": len(rows),
            "passed": sum(row.get("status") == "passed" for row in rows),
            "failed": sum(row.get("status") == "failed" for row in rows),
            "error": sum(row.get("status") == "error" for row in rows),
            "inconclusive": sum(row.get("status") == "inconclusive" for row in rows),
            "results": rows,
        }
        safe = _safe_summary(summary, evaluation_id, requested_case_ids)
        _write_reference_documents(self._dir(evaluation_id), safe, summary, evaluation_id)
        return safe

    def _select(self, listing: dict[str, Any], case_ids: list[str]) -> list[dict[str, Any]]:
        if not case_ids: raise ValueError("regression_case_selection_empty")
        requested = list(dict.fromkeys(str(item) for item in case_ids)); available = {item["id"]: item for item in listing["cases"]}; missing = [item for item in requested if item not in available]
        if missing: raise ValueError("regression_case_unknown:" + ",".join(missing))
        return [available[item] for item in requested]

    def _emit_case_events(self, evaluation_id: str, path: Path, emitted: int) -> int:
        if not path.is_file():
            return emitted
        try:
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        except (OSError, json.JSONDecodeError):
            return emitted
        for item in rows[emitted:]:
            self._event(evaluation_id, "case_completed", {
                "case_id": item.get("case_id"), "attempt": item.get("attempt"),
                "status": item.get("status"), "run_id": item.get("run_id"),
            })
        return len(rows)

    def _runner_progress(self, evaluation_id: str) -> list[dict[str, Any]]:
        path = self._dir(evaluation_id) / "runner-progress.jsonl"
        if not path.is_file():
            return []
        try:
            return [
                value for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip() and isinstance((value := json.loads(line)), dict)
            ]
        except (OSError, json.JSONDecodeError):
            return []

    def _emit_runner_progress(self, evaluation_id: str, path: Path, emitted: int) -> int:
        rows = self._runner_progress(evaluation_id)
        for item in rows[emitted:]:
            kind = str(item.get("type") or "runner_progress")
            data = item.get("data") if isinstance(item.get("data"), dict) else {}
            self._event(evaluation_id, kind, _safe_tree(data))
        return len(rows)

    def _cancel_active_runs(self, evaluation_id: str) -> list[str]:
        terminal: set[str] = set()
        created: list[str] = []
        for item in self._runner_progress(evaluation_id):
            data = item.get("data") if isinstance(item.get("data"), dict) else {}
            run_id = str(data.get("run_id") or "")
            if not re.fullmatch(r"run-[A-Za-z0-9-]+", run_id):
                continue
            if item.get("type") == "case_run_created" and run_id not in created:
                created.append(run_id)
            if item.get("type") == "case_run_terminal":
                terminal.add(run_id)
        active = [run_id for run_id in created if run_id not in terminal]
        if not active:
            return []
        url = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL")
        if not url:
            port = os.getenv("DRSAI_API_PORT") or os.getenv("OPENDRSAI_GATEWAY_PORT")
            url = f"http://127.0.0.1:{port}" if port else None
        if not url:
            return []
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        token = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN") or os.getenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN")
        if token:
            headers["X-OpenDrSai-Gateway-Token"] = token
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        cancelled: list[str] = []
        for run_id in active:
            request = urllib.request.Request(
                f"{url.rstrip('/')}/v1/runs/{run_id}/cancel", data=b"{}",
                headers=headers, method="POST",
            )
            try:
                with opener.open(request, timeout=5):
                    cancelled.append(run_id)
            except (OSError, urllib.error.URLError, urllib.error.HTTPError):
                continue
        return cancelled

    def _model_snapshot(self) -> Path | None:
        configured = os.getenv("OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT")
        candidates = [Path(configured)] if configured else []
        data_home = os.getenv("DRSAI_HOME")
        if data_home:
            candidates.extend(Path(data_home).expanduser().glob("model-capabilities/**/capability-snapshot.json"))
        candidates.extend((self.catalog_root / "model_capabilities" / "baselines").glob("*.json"))
        # Source-tree development keeps P2 evidence under tmp/eval-results.
        repository_root = self.catalog_root.parent.parent
        candidates.extend((repository_root / "tmp" / "eval-results").glob("**/capability-snapshot.json"))
        valid: list[Path] = []
        for candidate in candidates:
            try:
                resolved = candidate.expanduser().resolve()
                value = json.loads(resolved.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(value, dict) and value.get("schema_version") == "opendrsai.model-capability-snapshot/1" and isinstance(value.get("results"), list):
                valid.append(resolved)
        return max(valid, key=lambda path: path.stat().st_mtime) if valid else None

    def _workspace_id(self) -> str | None:
        configured = os.getenv("OPENDRSAI_REGRESSION_WORKSPACE_ID")
        if configured:
            return configured
        if self.workspace_path is None:
            return None
        url = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL")
        if not url:
            port = os.getenv("DRSAI_API_PORT") or os.getenv("OPENDRSAI_GATEWAY_PORT")
            url = f"http://127.0.0.1:{port}" if port else None
        if not url:
            return None
        headers = {"Accept": "application/json"}
        token = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN") or os.getenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN")
        if token:
            headers["X-OpenDrSai-Gateway-Token"] = token
        request = urllib.request.Request(f"{url.rstrip('/')}/v1/workspaces", headers=headers, method="GET")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=5) as response:
                value = json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            return None
        rows = value.get("data") if isinstance(value, dict) else None
        if not isinstance(rows, list):
            return None
        for row in rows:
            try:
                registered = Path(str(row.get("path"))).resolve() if isinstance(row, dict) else None
            except OSError:
                continue
            if registered == self.workspace_path and row.get("open") is not False:
                workspace_id = row.get("workspace_id")
                return str(workspace_id) if workspace_id else None
        return None

    def _model_provider_status(self) -> dict[str, Any]:
        """Verify that the Agent's authoritative Provider credential is usable.

        This is a local configuration check only.  It intentionally does not
        send a paid model request during preflight.
        """
        url = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL")
        if not url:
            port = os.getenv("DRSAI_API_PORT") or os.getenv("OPENDRSAI_GATEWAY_PORT")
            url = f"http://127.0.0.1:{port}" if port else None
        if not url:
            return {"status": "blocked", "missing": "gateway_url"}
        headers = {"Accept": "application/json"}
        token = os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN") or os.getenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN")
        if token:
            headers["X-OpenDrSai-Gateway-Token"] = token
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def get(path: str) -> dict[str, Any]:
            request = urllib.request.Request(url.rstrip("/") + path, headers=headers, method="GET")
            with opener.open(request, timeout=5) as response:
                value = json.loads(response.read().decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("gateway_configuration_response_invalid")
            return value

        agent_id = os.getenv("OPENDRSAI_REGRESSION_AGENT_ID", "opendrsai")
        try:
            policy = get(f"/v1/config/agents/{urllib.parse.quote(agent_id, safe='')}/models")
            providers = get("/v1/config/model-providers").get("providers")
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, ValueError) as exc:
            return {"status": "blocked", "missing": "model_provider_status", "error": type(exc).__name__}
        effective = policy.get("effective_ref")
        provider_id = str(effective.get("provider_id") or "") if isinstance(effective, dict) else ""
        model_id = str(effective.get("model_id") or "") if isinstance(effective, dict) else ""
        if not provider_id or not model_id:
            return {"status": "blocked", "missing": "agent_model_policy", "agent_id": agent_id}
        provider = next((row for row in providers or [] if isinstance(row, dict) and row.get("name") == provider_id), None)
        if not isinstance(provider, dict):
            return {"status": "blocked", "missing": "model_provider", "provider_id": provider_id, "model_id": model_id}
        if provider.get("requires_api_key") is True and provider.get("has_api_key") is not True:
            return {"status": "blocked", "missing": "model_provider_credential", "provider_id": provider_id, "model_id": model_id}
        def role_model(key: str) -> str | None:
            value = policy.get(key)
            return str(value.get("model_id")) if isinstance(value, dict) and value.get("model_id") else None

        return {
            "status": "ready", "agent_id": agent_id, "provider_id": provider_id, "model_id": model_id,
            "agent_policy_revision": policy.get("revision"),
            "role_models": {
                key: value for key, value in {
                    "image_understanding": role_model("effective_image_understanding_ref"),
                    "image_generation": role_model("effective_image_generation_ref"),
                    "text_to_speech": role_model("effective_text_to_speech_ref"),
                    "speech_to_text": role_model("effective_speech_to_text_ref"),
                }.items() if value
            },
        }

    def _active_by_identity(self, identity: str) -> dict[str, Any] | None:
        return next((value for value in self.history(500) if value.get("idempotency_key") == identity and value.get("status") not in TERMINAL_STATES), None)

    def _reconcile_interrupted(self, record: dict[str, Any]) -> dict[str, Any]:
        evaluation_id = str(record.get("evaluation_id") or "")
        if record.get("status") in TERMINAL_STATES or evaluation_id in _PROCESSES:
            return record
        summary_path = self._dir(evaluation_id) / "run-results" / evaluation_id / "summary.json"
        if summary_path.is_file():
            try:
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                summary = None
            if isinstance(summary, dict):
                status = _summary_status(summary, len(record.get("case_ids") or []))
                record.update(
                    status=status, updated_at=_now(), runner_pid=None,
                    result=_safe_summary(summary, evaluation_id, record.get("case_ids") or []),
                    error_code=None if status == "passed" else "regression_assertions_not_passed",
                    error_message=None,
                )
                _write_reference_documents(self._dir(evaluation_id), record["result"], summary, evaluation_id)
                self._write(record)
                self._event(evaluation_id, "evaluation_recovered", {"status": status, "result": record["result"]})
                return record
        runner_pid = record.get("runner_pid")
        if isinstance(runner_pid, int) and runner_pid > 0 and _pid_exists(runner_pid):
            return record
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(str(record["updated_at"]))
        except (KeyError, TypeError, ValueError):
            return record
        if age < timedelta(seconds=30):
            return record
        record.update(status="blocked", updated_at=_now(), error_code="regression_execution_interrupted", error_message="The persisted evaluation has no live Runner process after restart.")
        self._write(record); self._event(evaluation_id, "evaluation_status", {"status": "blocked", "error_code": record["error_code"]})
        return record

    def _secret(self) -> bytes:
        path = self.output_root / ".confirmation-key"
        if not path.exists():
            temporary = path.with_suffix(".tmp"); temporary.write_bytes(secrets.token_bytes(32)); os.replace(temporary, path)
        return path.read_bytes()

    def _sign(self, scope: dict[str, Any]) -> str:
        payload = json.dumps(scope, sort_keys=True, separators=(",", ":")).encode(); signature = hmac.new(self._secret(), payload, hashlib.sha256).digest()
        encoded_payload = base64.urlsafe_b64encode(payload).decode().rstrip("=")
        encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        return f"{encoded_payload}.{encoded_signature}"

    def _verify(self, token: str | None, preflight: dict[str, Any]) -> None:
        if not token: raise ValueError("regression_confirmation_required")
        try:
            encoded_payload, encoded_signature = token.split(".", 1)
            payload = base64.urlsafe_b64decode((encoded_payload + "=" * (-len(encoded_payload) % 4)).encode())
            signature = base64.urlsafe_b64decode((encoded_signature + "=" * (-len(encoded_signature) % 4)).encode())
            scope = json.loads(payload)
        except Exception as exc: raise ValueError("regression_confirmation_invalid") from exc
        if not hmac.compare_digest(signature, hmac.new(self._secret(), payload, hashlib.sha256).digest()): raise ValueError("regression_confirmation_invalid")
        stable_keys = ("suite_id", "case_ids", "catalog_revision", "risks")
        if any(scope.get(key) != preflight[key] for key in stable_keys) or datetime.fromisoformat(scope["expires_at"]) < datetime.now(timezone.utc):
            raise ValueError("regression_confirmation_expired_or_scope_changed")

    def _dir(self, evaluation_id: str) -> Path:
        if not evaluation_id.startswith("eval-") or not all(char.isalnum() or char == "-" for char in evaluation_id): raise ValueError("regression_evaluation_id_invalid")
        return self.output_root / evaluation_id

    def _read(self, evaluation_id: str) -> dict[str, Any]:
        path = self._dir(evaluation_id) / "evaluation.json"
        if not path.is_file(): raise KeyError("regression_evaluation_not_found")
        return json.loads(path.read_text(encoding="utf-8"))

    def _write(self, record: dict[str, Any]) -> None:
        directory = self._dir(record["evaluation_id"]); directory.mkdir(parents=True, exist_ok=True); temporary = directory / "evaluation.json.tmp"
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"); os.replace(temporary, directory / "evaluation.json")

    def _event(self, evaluation_id: str, kind: str, data: dict[str, Any]) -> None:
        directory = self._dir(evaluation_id); directory.mkdir(parents=True, exist_ok=True)
        with _LOCK:
            with (directory / "events.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": kind, "at": _now(), "data": data}, ensure_ascii=False, separators=(",", ":")) + "\n"); handle.flush(); os.fsync(handle.fileno())


def _case_risks(detail: dict[str, Any]) -> set[str]:
    environment = detail.get("environment") or {}; risks = set()
    if environment.get("approval_harness"): risks.add("approval")
    if environment.get("network") not in (None, "disabled", "none"): risks.add("network")
    tags = {str(tag).replace("_", "-").casefold() for tag in detail.get("tags") or []}
    if tags.intersection({"write", "image-generation", "presentation", "artifact"}):
        risks.add("resource_or_write")
    return risks


def _normalize_options(options: dict[str, Any] | None) -> dict[str, Any]:
    value = dict(options or {})
    unknown = set(value) - {"failure_policy"}
    if unknown:
        raise ValueError("regression_options_unknown:" + ",".join(sorted(unknown)))
    failure_policy = str(value.get("failure_policy") or "continue")
    if failure_policy not in {"continue", "stop"}:
        raise ValueError("regression_failure_policy_invalid")
    return {"failure_policy": failure_policy}


def _safe_summary(summary: dict[str, Any], evaluation_id: str, requested_case_ids: list[str] | None = None) -> dict[str, Any]:
    results = []
    for item in summary.get("results") or []:
        assertions = [{
            key: _safe_scalar(assertion.get(key))
            for key in ("path", "operator", "expected", "actual", "passed", "message", "critical")
        } for assertion in item.get("assertions") or []]
        evidence = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
        manifest = evidence.get("manifest") if isinstance(evidence.get("manifest"), dict) else {}
        results.append({
            "case_id": item.get("case_id"), "case_revision": item.get("case_revision"),
            "case_snapshot_sha256": item.get("case_snapshot_sha256"),
            "attempt": item.get("attempt"), "status": item.get("status"),
            "run_id": item.get("run_id"), "thread_id": item.get("session_id"),
            "duration_seconds": item.get("duration_seconds"),
            "error_category": item.get("error_category"), "error": _safe_scalar(item.get("error")),
            "assertions": assertions, "model": _safe_tree(manifest.get("model")),
        })
    completed = {str(item.get("case_id")) for item in summary.get("results") or []}
    not_run = [case_id for case_id in (requested_case_ids or []) if case_id not in completed]
    duration = sum(float(item.get("duration_seconds") or 0) for item in summary.get("results") or [])
    return {key: summary.get(key) for key in ("total", "attempts", "passed", "failed", "error", "inconclusive")} | {"duration_seconds": duration, "requested_total": len(requested_case_ids or []) or summary.get("total"), "not_run_case_ids": not_run, "results": results, "references": [{"kind": "result", "uri": f"opendrsai://regression/evaluations/{evaluation_id}/summary"}, {"kind": "evidence", "uri": f"opendrsai://regression/evaluations/{evaluation_id}/evidence"}]}


def _summary_status(summary: dict[str, Any], expected_total: int | None = None) -> str:
    total = int(summary.get("total") or 0)
    if expected_total is not None and total != expected_total:
        return "failed"
    return "passed" if total > 0 and summary.get("passed") == total else "blocked" if summary.get("inconclusive") else "failed"


def _pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _write_reference_documents(directory: Path, safe_summary: dict[str, Any], raw_summary: dict[str, Any], evaluation_id: str) -> None:
    summary_document = {
        "schema_version": "opendrsai.regression-reference/1", "kind": "summary",
        "evaluation_id": evaluation_id, "result": safe_summary,
    }
    evidence_cases = []
    for item in raw_summary.get("results") or []:
        evidence = item.get("evidence") if isinstance(item, dict) and isinstance(item.get("evidence"), dict) else {}
        manifest = evidence.get("manifest") if isinstance(evidence.get("manifest"), dict) else None
        semantic = evidence.get("semantic_evaluation") if isinstance(evidence.get("semantic_evaluation"), dict) else None
        evidence_cases.append({
            "case_id": item.get("case_id"), "case_revision": item.get("case_revision"),
            "status": item.get("status"), "run_id": item.get("run_id"), "session_id": item.get("session_id"),
            "case_snapshot_sha256": item.get("case_snapshot_sha256"),
            "manifest": _safe_tree(manifest), "semantic_evaluation": _safe_tree(semantic),
            "tool_calls": _safe_tree(evidence.get("tool_calls")),
            "approvals": _safe_tree(evidence.get("approvals")),
            "artifacts": _safe_tree(evidence.get("artifacts")),
            "citations": _safe_tree(evidence.get("citations")),
            "side_effects": _safe_tree(evidence.get("side_effects")),
            "environment": _safe_tree(evidence.get("environment")),
        })
    evidence_document = {
        "schema_version": "opendrsai.regression-reference/1", "kind": "evidence",
        "evaluation_id": evaluation_id, "cases": evidence_cases,
    }
    for name, value in (("summary.json", summary_document), ("evidence.json", evidence_document)):
        temporary = directory / f"{name}.tmp"
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, directory / name)


def _safe_tree(value: Any, depth: int = 0) -> Any:
    if depth > 12:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            str(key)[:200]: _safe_tree(item, depth + 1)
            for key, item in value.items()
            if str(key).lower() not in {"api_key", "access_token", "authorization", "gateway_token", "idempotency_key", "raw"}
        }
    if isinstance(value, list):
        return [_safe_tree(item, depth + 1) for item in value[:1000]]
    return _safe_scalar(value)


def _safe_scalar(value: Any) -> Any:
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = str(value)
    text = re.sub(r"(?i)\bBearer\s+[^\s\"',;]+", "Bearer [REDACTED]", text)
    text = re.sub(
        r'''(?ix)(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&}\]]+''',
        r"\1[REDACTED]", text,
    )
    text = re.sub(r"(?:[A-Za-z]:\\|/)(?:[^\s:]+[\\/])+[^\s:]+", "[path]", text)
    return text[:1000]


def _now() -> str: return datetime.now(timezone.utc).isoformat()
