from __future__ import annotations

import hashlib
import json
from pathlib import Path

from opendrsai_dsh_runtime.contracts import (
    CONTROL_SCHEMA_SHA256,
    OAEP_PROFILE,
    OAEP_SCHEMA_SHA256,
    runtime_protocol_description,
)
from opendrsai_dsh_runtime.profiles import ProtocolProfileRegistry


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _probe_profile():
    return next(profile for profile in ProtocolProfileRegistry.bundled().profiles if profile.profile_id == "dsh-sdk/0.1.0-rc.5")


def test_generated_public_contract_digests_match_repository_sources() -> None:
    assert _sha256(REPOSITORY_ROOT / "cores/protocol/oaep/oaep.schema.json") == OAEP_SCHEMA_SHA256
    assert _sha256(REPOSITORY_ROOT / "cores/protocol/runtime/runtime-control.schema.json") == CONTROL_SCHEMA_SHA256
    assert runtime_protocol_description()["oaep"]["profiles"] == [OAEP_PROFILE]
    assert runtime_protocol_description()["owop"] == {"supported": False}


def test_bundled_profile_is_pinned_and_probe_only() -> None:
    registry = ProtocolProfileRegistry.bundled()
    assert {profile.profile_id for profile in registry.profiles} == {
        "dsh-sdk/0.1.0-rc.5", "dsh-sdk/0.1.0-rc.5+opendrsai.1",
    }
    profile = _probe_profile()
    assert profile.supported_versions == ("0.0.1", "0.1.0-rc.5")
    assert profile.source_commits == ("47f943859bef60e4160492346772ded9b24f765a",)
    assert not profile.production_ready
    assert profile.blockers


def test_profile_event_disposition_digest_is_real() -> None:
    profile = _probe_profile()
    path = (
        REPOSITORY_ROOT
        / "cores/python/packages/drsai_dsh_runtime/src/opendrsai_dsh_runtime/event_disposition/dsh-session-events-v1.json"
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["unknown_event_policy"] == "release_blocked"
    assert set(payload["events"].values()) <= {
        "mapped_public",
        "mapped_diagnostic",
        "reviewed_ignored",
        "profile_forbidden",
        "release_blocked",
    }
    assert _sha256(path) == profile.event_disposition_sha256


def test_event_disposition_covers_the_audited_upstream_catalog() -> None:
    profile = _probe_profile()
    path = (
        REPOSITORY_ROOT
        / "cores/python/packages/drsai_dsh_runtime/src/opendrsai_dsh_runtime/event_disposition/dsh-session-events-v1.json"
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["upstream_source_commit"] in profile.source_commits
    # Audited from packages/core/session/src/known-event-types.ts at the pinned commit.
    expected = {
        "agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided",
        "approval/policy", "assistant/chunk", "assistant/message", "command/done", "command/run",
        "compaction/end", "compaction/prune", "compaction/start", "compaction/summary",
        "feedback/record", "goal/change", "hook/invoked", "hook/result", "llm/retry",
        "llm/retry-started", "permission/preset", "plan/mode", "request/context", "request/header",
        "sandbox/mode", "schedule/change", "session/end-seed", "session/title",
        "session/title-llm-request", "step/end", "step/start", "subagent/descriptor", "todo/write",
        "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end",
        "tool-workflow/run-start", "tool/call", "tool/code-dispatch", "tool/code-dispatch-start",
        "tool/result", "turn/end", "turn/start", "user/message", "web/deepseek-search-llm-request",
    }
    assert set(payload["events"]) == expected
    assert "release_blocked" not in set(payload["events"].values())
    assert "profile_forbidden" in set(payload["events"].values())


def test_known_upstream_is_probe_only_until_extension_capabilities_exist() -> None:
    profile = _probe_profile()
    decision = ProtocolProfileRegistry((profile,)).decide(
        server_name=profile.server_name,
        version="0.0.1",
        native_contract_sha256=profile.native_contract_sha256,
        methods=profile.required_methods,
        notifications=profile.required_notifications,
        capabilities=frozenset({"run.enqueue-receipt", "session.events.live"}),
    )
    assert decision.state == "probe_only"
    assert not decision.available
    assert "run.cancel" in decision.missing_capabilities


def test_unknown_version_and_digest_fail_closed() -> None:
    profile = _probe_profile()
    registry = ProtocolProfileRegistry((profile,))
    unknown = registry.decide(
        server_name=profile.server_name,
        version="99.0.0",
        native_contract_sha256=profile.native_contract_sha256,
        methods=profile.required_methods,
        notifications=profile.required_notifications,
        capabilities=profile.required_capabilities,
    )
    drift = registry.decide(
        server_name=profile.server_name,
        version="0.0.1",
        native_contract_sha256="0" * 64,
        methods=profile.required_methods,
        notifications=profile.required_notifications,
        capabilities=profile.required_capabilities,
    )
    assert unknown.reason == "native_version_unrecognized"
    assert drift.reason == "native_contract_digest_mismatch"
    assert not unknown.available and not drift.available
