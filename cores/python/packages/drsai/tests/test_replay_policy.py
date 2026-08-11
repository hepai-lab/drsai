from __future__ import annotations

from drsai.backend.runtime.replay_policy import TOOL_POLICY_VERSION, decide_tool_replay


def _digest(char: str) -> str:
    return "sha256:" + char * 64


def test_pure_tool_reuse_requires_all_four_digests_and_source_event() -> None:
    evidence = {
        "classification": "pure", "tool_reference": "tool://calculator",
        "input_digest": _digest("1"), "implementation_digest": _digest("2"),
        "schema_digest": _digest("3"), "result_digest": _digest("4"),
        "source_event_id": "event-pure",
        "current": {
            "input_digest": _digest("1"), "implementation_digest": _digest("2"),
            "schema_digest": _digest("3"), "result_digest": _digest("4"),
        },
    }
    reused = decide_tool_replay(evidence)
    assert reused.decision == "reuse" and reused.source_event_id == "event-pure"
    for field in ("input_digest", "implementation_digest", "schema_digest", "result_digest"):
        changed = {**evidence, "current": {**evidence["current"], field: _digest("f")}}
        assert decide_tool_replay(changed).decision == "reexecute"
    assert decide_tool_replay({**evidence, "source_event_id": None}).decision == "reexecute"


def test_mutable_read_supports_historical_reread_and_compare() -> None:
    evidence = {"classification": "read_only_mutable", "tool_reference": "tool://web", "source_event_id": "event-web"}
    historical = decide_tool_replay(evidence, read_mode="historical")
    reread = decide_tool_replay(evidence, read_mode="reread")
    compare = decide_tool_replay(evidence, read_mode="compare")
    assert historical.decision == "reuse" and historical.external_change_possible
    assert reread.decision == "reexecute" and not reread.comparison_required
    assert compare.decision == "reexecute" and compare.comparison_required


def test_workspace_write_requires_isolated_worktree() -> None:
    evidence = {"classification": "workspace_write", "tool_reference": "tool://shell"}
    assert decide_tool_replay(evidence).decision == "block"
    isolated = decide_tool_replay(evidence, isolated_worktree_id="worktree-experiment")
    assert isolated.decision == "isolate"
    assert isolated.audit["worktree_id"] == "worktree-experiment"


def test_external_write_is_blocked_until_explicit_approval() -> None:
    evidence = {"classification": "external_write", "tool_reference": "tool://email-send"}
    assert decide_tool_replay(evidence).decision == "block"
    approved = decide_tool_replay(evidence, approval_id="approval-one")
    assert approved.decision == "reexecute" and approved.approval_required
    assert approved.audit["approval_id"] == "approval-one"


def test_unknown_tool_fails_closed_with_content_safe_audit() -> None:
    decision = decide_tool_replay({
        "classification": "new-unregistered-class", "tool_reference": "tool://future",
        "arguments": {"password": "must-not-appear"},
    })
    payload = decision.as_dict()
    assert payload["decision"] == "block"
    assert payload["reason_code"] == "unknown_tool_fail_closed"
    assert payload["policy_version"] == TOOL_POLICY_VERSION
    assert "must-not-appear" not in str(payload)
