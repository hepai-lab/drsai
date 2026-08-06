from __future__ import annotations

import json
import time
import socket
import urllib.error
import urllib.request
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from dataclasses import dataclass
from typing import Any

from .case_loader import RegressionCase
from .evidence import collect_evidence
from .environment import PreparedEnvironment


class RuntimeAdapterError(RuntimeError):
    pass


class RuntimeTimeoutError(TimeoutError, RuntimeAdapterError):
    pass


@dataclass(frozen=True)
class RuntimeConfig:
    base_url: str
    workspace_id: str | None = None
    gateway_token: str | None = None
    access_token: str | None = None
    user_id: str | None = None


class GatewayRuntimeAdapter:
    """Thin client for the official OpenDrSai Runtime/Gateway API."""

    def __init__(self, config: RuntimeConfig):
        self.config = config

    adapter_name = "gateway"

    def execute(self, case: RegressionCase, environment: PreparedEnvironment | None = None) -> dict[str, Any]:
        agent = case.data["agent"]
        workspace_id = self.config.workspace_id
        registered_workspace = False
        if environment is not None:
            workspace = self._request("POST", "/v1/workspaces", {"path": str(environment.workspace)})
            workspace_id = str(workspace["workspace_id"])
            registered_workspace = True
        if not workspace_id:
            raise RuntimeAdapterError("A workspace id or prepared environment is required")
        try:
            session = self._request("POST", "/v1/sessions", {
                "workspace_id": workspace_id,
                "title": f"Regression: {case.id}",
                "agent_definition": agent["definition"],
            })
            session_id = str(session["session_id"])
            run = self._request("POST", f"/v1/sessions/{session_id}/runs", {
                "agent_definition": agent["definition"],
            }, idempotency_key=f"regression:{case.id}:{case.revision}:{uuid.uuid4()}")
            run_id = str(run["run_id"])
            prompt, attachment_refs = normalize_input(case.data["input"], environment.attachment_refs if environment else None)
            try:
                execute_payload = {
                    "prompt": prompt,
                    "user_id": self.config.user_id,
                    "model": None if agent.get("model_profile") == "default" else agent.get("model_profile"),
                    "thread_id": session_id,
                    "metadata": {"source_client": "runtime", "attachment_refs": attachment_refs, "input_resources": environment.manifest.get("input_resources", []) if environment else [], "regression_case_id": case.id},
                }
                approval_harness = (case.data.get("environment") or {}).get("approval_harness")
                execute = (self._execute_with_approval(run_id, workspace_id, execute_payload, approval_harness, int(case.data["execution"]["timeout_seconds"]))
                           if isinstance(approval_harness, dict) else
                           self._request("POST", f"/v1/runs/{run_id}/execute", execute_payload, timeout=int(case.data["execution"]["timeout_seconds"])))
            except RuntimeTimeoutError:
                try:
                    self._request("POST", f"/v1/runs/{run_id}/cancel", {})
                except RuntimeAdapterError:
                    pass
                raise
            current_run = execute.get("run") if isinstance(execute, dict) else None
            current_run = current_run if isinstance(current_run, dict) else self._request("GET", f"/v1/runs/{run_id}")
            inspection = self._collect_inspection(run_id)
            snapshot = self._collect_snapshot(session_id)
            manifest = self._request("GET", f"/v1/runs/{run_id}/reproduction-manifest")
            evidence = collect_evidence(run=current_run, inspection=inspection, snapshot=snapshot, manifest=manifest)
            evidence.update({"session_id": session_id, "run_id": run_id, "adapter": self.adapter_name})
            if environment:
                evidence["environment"] = environment.manifest
            return evidence
        finally:
            if registered_workspace:
                try:
                    self._request("DELETE", f"/v1/workspaces/{workspace_id}")
                except RuntimeAdapterError:
                    pass

    def _collect_inspection(self, run_id: str) -> dict[str, Any]:
        merged: dict[str, Any] | None = None
        seen: set[str] = set()
        cursor: str | None = None
        for _ in range(10_000):
            query = urllib.parse.urlencode({"limit": 500, **({"timeline_cursor": cursor} if cursor else {})})
            page = self._request("GET", f"/v1/runs/{run_id}/inspection?{query}")
            timeline = page.get("timeline")
            if not isinstance(timeline, list):
                raise RuntimeAdapterError("Run inspection has no timeline list")
            for item in timeline:
                identity = str(item.get("id") if isinstance(item, dict) else "")
                if not identity or identity in seen:
                    raise RuntimeAdapterError("Run inspection pagination contains a missing or duplicate Item id")
                seen.add(identity)
            if merged is None:
                merged = dict(page); merged["timeline"] = []; merged["_pagination_required"] = True
            merged["timeline"].extend(timeline)
            window = page.get("page") if isinstance(page.get("page"), dict) else {}
            next_cursor = window.get("next_cursor")
            if not window.get("has_more"):
                merged["page"] = {**window, "has_more": False, "next_cursor": None, "complete": True}
                return merged
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
                raise RuntimeAdapterError("Run inspection pagination did not advance")
            cursor = next_cursor
        raise RuntimeAdapterError("Run inspection exceeded the pagination safety limit")

    def _collect_snapshot(self, session_id: str) -> dict[str, Any]:
        merged: dict[str, Any] | None = None
        checkpoint: Any = None
        seen: set[str] = set()
        cursor: str | None = None
        for _ in range(10_000):
            query = urllib.parse.urlencode({"limit": 500, **({"cursor": cursor} if cursor else {})})
            page = self._request("GET", f"/v1/sessions/{session_id}/oaep-snapshot?{query}")
            items = page.get("items")
            if not isinstance(items, list):
                raise RuntimeAdapterError("OAEP Snapshot has no items list")
            if merged is None:
                merged = dict(page); merged["items"] = []; merged["_pagination_required"] = True; checkpoint = page.get("checkpoint")
            elif page.get("checkpoint") != checkpoint:
                raise RuntimeAdapterError("OAEP Snapshot checkpoint changed during pagination")
            for item in items:
                identity = str(item.get("id") if isinstance(item, dict) else "")
                if not identity or identity in seen:
                    raise RuntimeAdapterError("OAEP Snapshot pagination contains a missing or duplicate Item id")
                seen.add(identity)
            merged["items"].extend(items)
            window = page.get("window") if isinstance(page.get("window"), dict) else {}
            next_cursor = window.get("next_cursor")
            if not next_cursor:
                merged["window"] = {**window, "next_cursor": None, "complete": True}
                return merged
            if not isinstance(next_cursor, str) or next_cursor == cursor:
                raise RuntimeAdapterError("OAEP Snapshot pagination did not advance")
            cursor = next_cursor
        raise RuntimeAdapterError("OAEP Snapshot exceeded the pagination safety limit")

    def _execute_with_approval(self, run_id: str, workspace_id: str, payload: dict[str, Any], harness: dict[str, Any], timeout: int) -> dict[str, Any]:
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="regression-approval")
        future = executor.submit(self._request, "POST", f"/v1/runs/{run_id}/execute", payload, timeout=timeout)
        deadline = time.monotonic() + timeout
        approval_id = None
        try:
            while time.monotonic() < deadline and not future.done():
                approvals = self._request("GET", f"/v1/workspaces/{workspace_id}/approvals")
                items = approvals.get("items") or approvals.get("data") or []
                match = next((item for item in items if str(item.get("run_id")) == run_id and item.get("status") == "pending"), None)
                if match:
                    approval_id = str(match["approval_id"])
                    decision = str(harness.get("decision") or "denied")
                    self._request("POST", f"/v1/runs/{run_id}/approvals/{approval_id}/decision", {"decision": decision})
                    for _ in range(int(harness.get("duplicate_continue_requests") or 0)):
                        self._request("POST", f"/v1/runs/{run_id}/approvals/{approval_id}/decision", {"decision": decision})
                    break
                time.sleep(0.05)
            remaining = max(0.01, deadline - time.monotonic())
            return future.result(timeout=remaining)
        except FutureTimeoutError as exc:
            raise RuntimeTimeoutError(f"Approval-controlled Run {run_id} timed out") from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, *, timeout: int = 120, idempotency_key: str | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.config.gateway_token:
            headers["X-OpenDrSai-Gateway-Token"] = self.config.gateway_token
        if self.config.access_token:
            headers["Authorization"] = f"Bearer {self.config.access_token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            f"{self.config.base_url.rstrip('/')}{path}",
            data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                value = json.loads(response.read().decode("utf-8"))
        except (socket.timeout, TimeoutError) as exc:
            raise RuntimeTimeoutError(f"{method} {path} timed out: {exc}") from exc
        except urllib.error.HTTPError as exc:
            code = "gateway_http_error"
            message = f"Gateway returned HTTP {exc.code}"
            try:
                body = json.loads(exc.read(8_192).decode("utf-8"))
                detail = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), dict) else body.get("detail") if isinstance(body, dict) else None
                if isinstance(detail, dict):
                    code = str(detail.get("code") or code)[:120]
                    message = str(detail.get("message") or message)[:500]
                elif isinstance(detail, str):
                    message = detail[:500]
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
            raise RuntimeAdapterError(f"{method} {path} failed: {code}: {message}") from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                raise RuntimeTimeoutError(f"{method} {path} timed out: {exc.reason}") from exc
            raise RuntimeAdapterError(f"{method} {path} failed: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeAdapterError(f"{method} {path} failed: {exc}") from exc
        if not isinstance(value, dict):
            raise RuntimeAdapterError(f"{method} {path} returned a non-object response")
        return value


class FixtureRuntimeAdapter:
    """Deterministic adapter for framework tests; never valid for a release gate."""

    adapter_name = "fixture"

    def __init__(self, fixture_dir: str | Path):
        self.fixture_dir = Path(fixture_dir).resolve()

    def execute(self, case: RegressionCase, environment: PreparedEnvironment | None = None) -> dict[str, Any]:
        path = self.fixture_dir / f"{case.id}.json"
        if not path.is_file():
            raise RuntimeAdapterError(f"Evidence fixture not found: {path}")
        try:
            evidence = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeAdapterError(f"Cannot read evidence fixture {path}: {exc}") from exc
        if not isinstance(evidence, dict):
            raise RuntimeAdapterError(f"Evidence fixture must be an object: {path}")
        evidence = dict(evidence)
        evidence["adapter"] = self.adapter_name
        evidence.setdefault("run_id", f"fixture-{case.id}")
        evidence.setdefault("session_id", f"fixture-session-{case.id}")
        if environment:
            evidence["environment"] = environment.manifest
        return evidence


def normalize_input(value: dict[str, Any], attachment_mapping: dict[str, str] | None = None) -> tuple[str, list[str]]:
    lines: list[str] = []
    attachments: list[str] = []
    for message in value["messages"]:
        prefix = "" if message["role"] == "user" else f"[{message['role']}] "
        for part in message["parts"]:
            if part["type"] == "text":
                lines.append(prefix + part["text"])
            elif part.get("resource_ref"):
                attachments.append(part["resource_ref"])
            elif part.get("path"):
                raw = str(part["path"])
                if attachment_mapping is None or raw not in attachment_mapping:
                    raise RuntimeAdapterError(f"Attachment was not provisioned: {raw}")
                attachments.append(attachment_mapping[raw])
    return "\n\n".join(lines), attachments
