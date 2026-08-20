"""Generated from cores/protocol/runtime/runtime-control.schema.json.  Do not edit."""

from __future__ import annotations

from typing import NotRequired, Required, TypedDict, TypeAlias

JsonObject: TypeAlias = dict[str, object]

class ApprovalRespondParams(TypedDict, total=False):
    run_id: Required[str]
    approval_id: Required[str]
    outcome: Required[str]

class EmptyParams(TypedDict, total=False):
    pass

class InitializeParams(TypedDict, total=False):
    protocols: NotRequired[JsonObject]

class RunCancelParams(TypedDict, total=False):
    run_id: Required[str]

class RunStartParams(TypedDict, total=False):
    session_id: Required[str]
    idempotency_key: Required[str]
    content_blocks: Required[list[dict[str, object]]]

class SessionArchiveParams(TypedDict, total=False):
    session_id: Required[str]
    idempotency_key: Required[str]

class SessionCreateParams(TypedDict, total=False):
    idempotency_key: Required[str]
    workspace_id: NotRequired[str]
    workspace_fingerprint: NotRequired[str]
    native_profile: NotRequired[str]
    mapping_version: NotRequired[str]
    owner_profile: NotRequired[str]

class SessionEventsParams(TypedDict, total=False):
    session_id: Required[str]
    after_sequence: NotRequired[int]
    limit: NotRequired[int]

class SessionResumeParams(TypedDict, total=False):
    session_id: Required[str]

class SessionSnapshotParams(TypedDict, total=False):
    session_id: Required[str]

CONTROL_METHODS = (
    'approval.respond',
    'initialize',
    'run.cancel',
    'run.start',
    'runtime.health',
    'runtime.shutdown',
    'session.archive',
    'session.create',
    'session.events',
    'session.resume',
    'session.snapshot',
)

ControlParams: TypeAlias = ApprovalRespondParams | EmptyParams | InitializeParams | RunCancelParams | RunStartParams | SessionArchiveParams | SessionCreateParams | SessionEventsParams | SessionResumeParams | SessionSnapshotParams
