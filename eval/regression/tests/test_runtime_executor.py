from pathlib import Path
from threading import Event

import pytest

from opendrsai_regression.case_loader import CaseCatalog
from opendrsai_regression.environment import EnvironmentProvisioner
from opendrsai_regression.runtime_executor import GatewayRuntimeAdapter, RuntimeAdapterError, RuntimeConfig, RuntimeTimeoutError, normalize_input


ROOT = Path(__file__).resolve().parents[1]


class TimeoutGateway(GatewayRuntimeAdapter):
    def __init__(self):
        super().__init__(RuntimeConfig("http://fixture", "workspace"))
        self.calls = []

    def _request(self, method, path, payload=None, **kwargs):
        self.calls.append((method, path, payload))
        if path == "/v1/workspaces":
            return {"workspace_id": "workspace"}
        if path == "/v1/sessions":
            return {"session_id": "session"}
        if path == "/v1/sessions/session/runs":
            return {"run_id": "run"}
        if path == "/v1/runs/run/execute":
            raise RuntimeTimeoutError("timeout")
        if path == "/v1/runs/run/cancel":
            return {"status": "cancelled"}
        if method == "DELETE" and path == "/v1/workspaces/workspace":
            return {"lifecycle": "archived"}
        raise AssertionError(path)


def test_gateway_cancels_run_after_execute_timeout(tmp_path: Path) -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    adapter = TimeoutGateway()
    with EnvironmentProvisioner(ROOT, tmp_path).prepare(case) as environment:
        with pytest.raises(RuntimeTimeoutError):
            adapter.execute(case, environment)
    assert ("POST", "/v1/runs/run/cancel", {}) in adapter.calls
    assert ("DELETE", "/v1/workspaces/workspace", None) in adapter.calls


def test_normalize_input_rejects_raw_attachment_path() -> None:
    case = CaseCatalog(ROOT).load_cases()["image.input.ui_error"]
    with pytest.raises(Exception, match="Attachment was not provisioned"):
        normalize_input(case.data["input"])


class ApprovalGateway(GatewayRuntimeAdapter):
    def __init__(self):
        super().__init__(RuntimeConfig("http://fixture"))
        self.decided = Event()
        self.decisions = 0

    def _request(self, method, path, payload=None, **kwargs):
        if path == "/v1/workspaces": return {"workspace_id": "workspace"}
        if path == "/v1/sessions": return {"session_id": "session"}
        if path == "/v1/sessions/session/runs": return {"run_id": "run"}
        if path == "/v1/runs/run/execute":
            assert self.decided.wait(2)
            return {"run": {"status": "completed"}}
        if path == "/v1/workspaces/workspace/approvals":
            return {"items": [{"run_id": "run", "approval_id": "approval", "status": "pending"}]}
        if path == "/v1/runs/run/approvals/approval/decision":
            assert payload == {"decision": "approved"}
            self.decisions += 1
            self.decided.set()
            return {"decision": "approved"}
        if path == "/v1/runs/run/inspection?limit=500": return {"timeline": []}
        if path == "/v1/sessions/session/oaep-snapshot?limit=500": return {"items": []}
        if path == "/v1/runs/run/reproduction-manifest": return {"agent": "opendrsai@1"}
        if method == "DELETE" and path == "/v1/workspaces/workspace": return {"lifecycle": "archived"}
        raise AssertionError((method, path))


def test_approval_harness_decides_and_duplicates_same_approval(tmp_path: Path) -> None:
    case = CaseCatalog(ROOT).load_cases()["safety.write_approval"]
    adapter = ApprovalGateway()
    with EnvironmentProvisioner(ROOT, tmp_path).prepare(case) as environment:
        evidence = adapter.execute(case, environment)
    assert evidence["run"]["status"] == "completed"
    assert adapter.decisions == 2


class PaginatedGateway(GatewayRuntimeAdapter):
    def __init__(self, duplicate: bool = False):
        super().__init__(RuntimeConfig("http://fixture", "workspace"))
        self.duplicate = duplicate

    def _request(self, method, path, payload=None, **kwargs):
        if "/inspection?" in path:
            if "timeline_cursor=" not in path:
                return {"timeline": [{"id": f"item-{index}"} for index in range(500)], "page": {"has_more": True, "next_cursor": "next"}}
            return {"timeline": [{"id": "item-0" if self.duplicate else "item-500"}], "page": {"has_more": False, "next_cursor": None}}
        if "/oaep-snapshot?" in path:
            if "cursor=" not in path:
                return {"checkpoint": {"snapshot_hash": "digest"}, "items": [{"id": f"oaep-{index}"} for index in range(500)], "window": {"next_cursor": "next"}}
            return {"checkpoint": {"snapshot_hash": "digest"}, "items": [{"id": "oaep-500"}], "window": {"next_cursor": None}}
        raise AssertionError(path)


def test_gateway_collects_complete_inspection_and_oaep_pagination() -> None:
    adapter = PaginatedGateway()
    inspection = adapter._collect_inspection("run")
    snapshot = adapter._collect_snapshot("session")
    assert len(inspection["timeline"]) == 501
    assert inspection["page"]["complete"] is True
    assert len(snapshot["items"]) == 501
    assert snapshot["window"]["complete"] is True


def test_gateway_rejects_duplicate_paginated_evidence() -> None:
    with pytest.raises(RuntimeAdapterError, match="duplicate Item id"):
        PaginatedGateway(duplicate=True)._collect_inspection("run")
