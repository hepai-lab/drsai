from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from drsai.backend.runtime.agent import RuntimeExecutionError, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="opendrsai-m06-ledger-") as temporary:
        root = Path(temporary)
        workspace = root / "中文 空格工作区"
        workspace.mkdir()
        registry = RuntimeRegistry(root / "registry.sqlite3")
        workspace_record = registry.open_workspace(str(workspace))
        database = root / "engine.sqlite3"
        engine = RuntimeEngine(
            database,
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda workspace_id: registry.get_workspace(workspace_id) is not None,
        )
        session = engine.create_session(workspace_record.workspace_id, "M06 side-effect ledger")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "m06-crash-before-write")
        engine.transition_run(run["run_id"], "running")
        approval = engine.request_approval(run["run_id"], {
            "operation": "tool:write", "risk_summary": "Write one approved file", "scope": "workspace",
        })
        approval_id = approval["approval_id"]
        requested = engine.get_side_effect(approval_id)
        engine.resolve_approval(approval_id, "approved", {"idempotency_key": "m06-approve-once"})
        approved = engine.get_side_effect(approval_id)
        target = workspace / "approved-once.txt"

        restarted = RuntimeEngine(
            database,
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda workspace_id: registry.get_workspace(workspace_id) is not None,
        )
        calls = {"count": 0}

        def write_once(_context, _arguments):
            calls["count"] += 1
            target.write_text("written-once", encoding="utf-8")
            return {"path": target.name, "sha256": "fixture-written-once"}

        dispatcher = RuntimeToolDispatcher(restarted, tools={"write": write_once, "delete": write_once})
        context = RuntimeRunContext(
            registry.identity.runtime_id, registry.identity.instance_id,
            workspace_record.workspace_id, workspace, session["session_id"], run["run_id"],
            "opendrsai", "1", permissions=frozenset({"tool:write", "tool:delete"}),
        )
        before_recovery = {"file_exists": target.exists(), "ledger_status": approved["status"]}
        dispatcher.dispatch(context, "tool", "write", {}, approval_id=approval_id, recovered=True)
        completed = restarted.get_side_effect(approval_id)
        duplicate_blocked = False
        try:
            dispatcher.dispatch(context, "tool", "write", {}, approval_id=approval_id, recovered=True)
        except RuntimeExecutionError as error:
            duplicate_blocked = error.code == "side_effect_not_executable"

        mismatch_run, _ = restarted.create_run(session["session_id"], "opendrsai@1", "m06-mismatch")
        restarted.transition_run(mismatch_run["run_id"], "running")
        mismatch = restarted.request_approval(mismatch_run["run_id"], {"operation": "tool:write", "scope": "workspace"})
        restarted.resolve_approval(mismatch["approval_id"], "approved")
        mismatch_context = RuntimeRunContext(
            registry.identity.runtime_id, registry.identity.instance_id,
            workspace_record.workspace_id, workspace, session["session_id"], mismatch_run["run_id"],
            "opendrsai", "1", permissions=frozenset({"tool:write", "tool:delete"}),
        )
        mismatch_blocked = False
        try:
            dispatcher.dispatch(mismatch_context, "tool", "delete", {}, approval_id=mismatch["approval_id"])
        except RuntimeExecutionError as error:
            mismatch_blocked = error.code == "side_effect_not_executable"

        unknown_run, _ = restarted.create_run(session["session_id"], "opendrsai@1", "m06-unknown")
        restarted.transition_run(unknown_run["run_id"], "running")
        unknown = restarted.request_approval(unknown_run["run_id"], {"operation": "tool:write", "scope": "workspace"})
        restarted.resolve_approval(unknown["approval_id"], "approved")
        restarted.claim_side_effect(unknown["approval_id"], unknown_run["run_id"], "tool:write")
        unknown_context = RuntimeRunContext(
            registry.identity.runtime_id, registry.identity.instance_id,
            workspace_record.workspace_id, workspace, session["session_id"], unknown_run["run_id"],
            "opendrsai", "1", permissions=frozenset({"tool:write"}),
        )
        unknown_blocked = False
        try:
            dispatcher.dispatch(unknown_context, "tool", "write", {}, approval_id=unknown["approval_id"], recovered=True)
        except RuntimeExecutionError as error:
            unknown_blocked = error.code == "side_effect_not_executable"

        checks = {
            "requestRecorded": requested["status"] == "requested",
            "approvalRecorded": before_recovery["ledger_status"] == "approved",
            "stableIdempotencyKey": requested["idempotency_key"] == f"side-effect:{approval_id}",
            "crashBeforeWriteHasNoEffect": before_recovery["file_exists"] is False,
            "recoveredExecutionCompleted": completed["status"] == "completed" and completed["recovered_at"] is not None,
            "durableResultDigest": str(completed["result_digest"]).startswith("sha256:"),
            "effectWrittenExactlyOnce": calls["count"] == 1 and target.read_text(encoding="utf-8") == "written-once",
            "duplicateBlocked": duplicate_blocked,
            "mismatchedApprovalBlocked": mismatch_blocked,
            "unknownOutcomeBlocked": unknown_blocked,
        }
        payload = {
            "ok": all(checks.values()), "checks": checks, "checkCount": len(checks),
            "ledger": completed, "workspace": str(workspace), "python": sys.executable,
        }
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        if not payload["ok"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
