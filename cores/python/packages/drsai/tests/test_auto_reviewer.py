from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    AutoReviewerConfig,
    AutoReviewerService,
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    ModeSelection,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
    evaluate_auto_reviewer,
    load_evaluation_fixture,
)
from drsai.backend.runtime.security_boundary import ActionProposal


class StaticModel:
    model_version = "review-model/1"

    def __init__(self, value):
        self.value = value
        self.calls = 0

    def review(self, context):
        self.calls += 1
        if isinstance(self.value, BaseException):
            raise self.value
        return self.value


class SlowModel(StaticModel):
    def review(self, context):
        time.sleep(0.1)
        return super().review(context)


def effective(*, capabilities=DEVELOPMENT_CAPABILITIES):
    return PermissionProfileResolver().resolve(
        ModeSelection(
            "auto_reviewed", "user", False,
            requested_capabilities=frozenset(capabilities),
        ),
        administrator=AdministratorPolicy(
            "organization-default", 1, True,
            allowed_modes=frozenset(BUILTIN_MODES), capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )


def proposal(*, risk="local_write", categories=(), capabilities=("file.write",), payload=None, operation="file.write"):
    return ActionProposal.create(
        proposal_id=f"proposal-{operation}-{'-'.join(categories)}", run_id="run-1", operation=operation,
        payload=payload if payload is not None else {"path": "safe.txt", "token": "review-secret"},
        risk=risk, required_capabilities=capabilities, effect_categories=categories,
    )


def config(**changes):
    values = {
        "enabled": True, "allowed_model_versions": frozenset({"review-model/1"}),
        "minimum_confidence": 0.95, "timeout_seconds": 0.5,
    }
    values.update(changes)
    return AutoReviewerConfig(**values)


def test_disabled_auto_reviewer_escalates_and_never_calls_model(tmp_path: Path) -> None:
    model = StaticModel({"outcome": "approve", "reason_code": "model_safe", "confidence": 1})
    service = AutoReviewerService(tmp_path / "runtime.sqlite3", config(enabled=False), model)
    decision = service.review(proposal(), effective(), idempotency_key="review-1", now=100)
    assert decision.outcome == "escalate" and decision.reason_code == "auto_reviewer_disabled"
    assert model.calls == 0


@pytest.mark.parametrize("category", [
    "credential_theft", "security_control_tampering", "data_exfiltration", "prompt_injection_execution",
])
def test_deny_rules_cannot_be_overridden_by_approve_all_model(tmp_path: Path, category: str) -> None:
    model = StaticModel({"outcome": "approve", "reason_code": "approve_everything", "confidence": 1})
    service = AutoReviewerService(tmp_path / f"{category}.sqlite3", config(), model)
    decision = service.review(
        proposal(risk="critical", categories=(category,), capabilities=(), operation="shell.execute"),
        effective(), idempotency_key=f"review-{category}", now=100,
    )
    assert decision.outcome == "deny" and decision.decision_source == "rule"
    assert model.calls == 0


@pytest.mark.parametrize("category", sorted(BUILTIN_MODES["auto_reviewed"].mandatory_human_categories))
def test_every_mandatory_human_category_escalates_before_model(tmp_path: Path, category: str) -> None:
    model = StaticModel({"outcome": "approve", "reason_code": "approve_everything", "confidence": 1})
    service = AutoReviewerService(tmp_path / f"mandatory-{category}.sqlite3", config(), model)
    decision = service.review(
        proposal(categories=(category,), capabilities=()), effective(),
        idempotency_key=f"review-{category}", now=100,
    )
    assert decision.outcome == "escalate"
    assert decision.reason_code == f"mandatory_human.{category}"
    assert model.calls == 0


def test_capability_denial_and_safe_read_are_deterministic(tmp_path: Path) -> None:
    model = StaticModel(RuntimeError("must not run"))
    service = AutoReviewerService(tmp_path / "runtime.sqlite3", config(), model)
    denied = service.review(
        proposal(capabilities=("file.write",)), effective(capabilities=frozenset({"file.read"})),
        idempotency_key="denied", now=100,
    )
    safe = service.review(
        proposal(risk="local_read", capabilities=("file.read",), operation="file.read"), effective(),
        idempotency_key="safe", now=101,
    )
    assert (denied.outcome, denied.reason_code) == ("deny", "profile_capability_denied")
    assert (safe.outcome, safe.reason_code) == ("approve", "deterministic_safe_read")
    assert model.calls == 0


@pytest.mark.parametrize(
    "operation,payload",
    [
        ("file.write", {
            "relative_path": "notes.txt", "content_digest": "sha256:result", "size_bytes": 6,
        }),
        ("file.edit", {
            "relative_path": "notes.txt", "source_content_digest": "sha256:source",
            "old_text_digest": "sha256:old", "new_text_digest": "sha256:new",
            "match_count": 1, "result_content_digest": "sha256:result",
            "result_size_bytes": 6,
        }),
    ],
)
def test_exact_bounded_workspace_mutations_are_rule_approved_without_model(
    tmp_path: Path, operation: str, payload: dict[str, object],
) -> None:
    model = StaticModel(RuntimeError("bounded mutation must not call model"))
    service = AutoReviewerService(tmp_path / f"{operation}.sqlite3", config(), model)
    decision = service.review(
        proposal(
            risk="write", capabilities=("filesystem.write",),
            operation=operation, payload=payload,
        ),
        effective(), idempotency_key=f"bounded-{operation}", now=100,
    )
    assert decision.outcome == "approve"
    assert decision.reason_code == "deterministic_bounded_local_mutation"
    assert decision.decision_source == "rule" and model.calls == 0


def test_incomplete_or_categorized_workspace_mutation_never_hits_bounded_auto_rule(tmp_path: Path) -> None:
    model = StaticModel({"outcome": "escalate", "reason_code": "model_requires_human", "confidence": 1})
    service = AutoReviewerService(tmp_path / "incomplete.sqlite3", config(), model)
    incomplete = service.review(
        proposal(
            risk="write", capabilities=("filesystem.write",), operation="file.write",
            payload={"relative_path": "notes.txt"},
        ),
        effective(), idempotency_key="incomplete-write", now=100,
    )
    categorized = service.review(
        proposal(
            risk="write", capabilities=("filesystem.write",), operation="file.write",
            payload={
                "relative_path": "notes.txt", "content_digest": "sha256:result", "size_bytes": 6,
            }, categories=("production_target",),
        ),
        effective(), idempotency_key="production-write", now=101,
    )
    assert incomplete.outcome == "escalate" and incomplete.decision_source == "model"
    assert categorized.outcome == "escalate"
    assert categorized.reason_code == "mandatory_human.production_target"


@pytest.mark.parametrize("relative_path", [".git/config", ".codex/policy.toml", ".agents/rules.md"])
def test_control_path_mutations_are_auto_denied_before_model(tmp_path: Path, relative_path: str) -> None:
    model = StaticModel({"outcome": "approve", "reason_code": "model_unsafe", "confidence": 1})
    service = AutoReviewerService(tmp_path / (relative_path.split("/")[0] + ".sqlite3"), config(), model)
    decision = service.review(
        proposal(
            risk="write", capabilities=("filesystem.write",), operation="file.write",
            payload={
                "relative_path": relative_path,
                "content_digest": "sha256:result", "size_bytes": 6,
            },
        ),
        effective(), idempotency_key=f"control-{relative_path}", now=100,
    )
    assert decision.outcome == "deny" and decision.reason_code == "auto_deny.control_path"
    assert model.calls == 0


def test_valid_pinned_model_can_decide_only_gray_area(tmp_path: Path) -> None:
    model = StaticModel({"outcome": "approve", "reason_code": "model_local_write_safe", "confidence": 0.99})
    service = AutoReviewerService(tmp_path / "runtime.sqlite3", config(), model)
    decision = service.review(proposal(), effective(), idempotency_key="review-1", now=100)
    assert decision.outcome == "approve" and decision.decision_source == "model"
    assert decision.model_version == "review-model/1" and model.calls == 1


@pytest.mark.parametrize("value,reason", [
    ({"outcome": "approve", "reason_code": "model_safe", "confidence": 0.5}, "auto_reviewer_low_confidence"),
    ({"outcome": "allow", "reason_code": "bad", "confidence": 1}, "auto_reviewer_model_output_invalid"),
    ({"outcome": "approve"}, "auto_reviewer_model_output_invalid"),
    (RuntimeError("offline"), "auto_reviewer_model_failed"),
])
def test_low_confidence_invalid_and_failed_model_escalate(tmp_path: Path, value, reason: str) -> None:
    service = AutoReviewerService(tmp_path / f"{reason}.sqlite3", config(), StaticModel(value))
    decision = service.review(proposal(), effective(), idempotency_key="review-1", now=100)
    assert decision.outcome == "escalate" and decision.reason_code == reason


def test_timeout_and_untrusted_model_version_escalate(tmp_path: Path) -> None:
    timeout = AutoReviewerService(
        tmp_path / "timeout.sqlite3", config(timeout_seconds=0.01),
        SlowModel({"outcome": "approve", "reason_code": "late", "confidence": 1}),
    ).review(proposal(), effective(), idempotency_key="timeout", now=100)
    assert timeout.outcome == "escalate" and timeout.reason_code == "auto_reviewer_model_timeout"
    model = StaticModel({"outcome": "approve", "reason_code": "untrusted", "confidence": 1})
    model.model_version = "review-model/unpinned"
    untrusted = AutoReviewerService(tmp_path / "untrusted.sqlite3", config(), model).review(
        proposal(), effective(), idempotency_key="untrusted", now=100,
    )
    assert untrusted.outcome == "escalate" and untrusted.reason_code == "auto_reviewer_model_version_untrusted"
    assert model.calls == 0


def test_decision_is_idempotent_append_only_audited_and_secret_free(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    service = AutoReviewerService(
        database, config(), StaticModel({"outcome": "deny", "reason_code": "model_uncertain", "confidence": 0.9}),
    )
    first = service.review(proposal(), effective(), idempotency_key="review-1", now=100)
    second = service.review(proposal(), effective(), idempotency_key="review-1", now=101)
    assert first == second
    assert b"review-secret" not in database.read_bytes()
    event = service.audit.list()[-1]
    assert event.event_type == "auto_reviewer.decided"
    assert "proposal-" not in str(event.payload)
    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_auto_review_decisions")


def test_versioned_adversarial_fixture_rejects_unsafe_model_then_accepts_conservative_model(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "auto_reviewer_adversarial_v1.json"
    version, cases = load_evaluation_fixture(fixture)
    approve_all = StaticModel({"outcome": "approve", "reason_code": "model_gray_area_safe", "confidence": 1})
    unsafe_result = evaluate_auto_reviewer(
        AutoReviewerService(tmp_path / "unsafe-evaluation.sqlite3", config(), approve_all),
        effective(), dataset_version=version, cases=cases,
        maximum_false_approval_rate=0,
    )
    assert unsafe_result.total == 13
    assert unsafe_result.hard_deny_false_approvals == 0
    assert unsafe_result.mandatory_human_false_approvals == 0
    assert unsafe_result.false_approvals == 1
    assert not unsafe_result.passed

    conservative = StaticModel({"outcome": "escalate", "reason_code": "model_requires_human", "confidence": 1})
    safe_result = evaluate_auto_reviewer(
        AutoReviewerService(tmp_path / "safe-evaluation.sqlite3", config(), conservative),
        effective(), dataset_version=version, cases=cases,
        maximum_false_approval_rate=0,
    )
    assert safe_result.false_approvals == 0
    assert safe_result.hard_deny_false_approvals == 0
    assert safe_result.mandatory_human_false_approvals == 0
    assert safe_result.passed
