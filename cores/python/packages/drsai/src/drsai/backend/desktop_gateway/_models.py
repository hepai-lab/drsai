"""Request bodies for the 17 operations.

These are intentionally narrower than their legacy counterparts. The clearest
example is :class:`RunExecuteRequest`: legacy rejects a caller-supplied model
outright and resolves one from an Agent model policy backed by 23 config
routes.  This inverts that -- the request carries a ``model_alias`` from
``GET /v1/config/model-catalog`` and it goes straight into
``create_agent(defult_config_name=alias)``.  That single inversion is what lets
feature 3.2 ship as one read-only route instead of a provider CRUD surface.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class WorkspaceOpenRequest(BaseModel):
    path: str
    display_name: str | None = None


class SessionCreateRequest(BaseModel):
    workspace_id: str | None = None
    remote_worker_id: str | None = None
    remote_worker_name: str | None = None
    title: str = "New session"
    model: str | None = None
    reasoning_effort: str | None = None
    plan_mode: bool | None = None

    @model_validator(mode="after")
    def validate_owner(self):
        if bool(self.workspace_id) == bool(self.remote_worker_id):
            raise ValueError("Exactly one of workspace_id or remote_worker_id is required")
        return self


class SessionUpdateRequest(BaseModel):
    """Rename or archive. ``lifecycle`` wins over ``archived`` when both are set."""

    title: str | None = None
    archived: bool | None = None
    lifecycle: Literal["active", "archived", "removed"] | None = None
    model: str | None = None
    reasoning_effort: str | None = None
    plan_mode: bool | None = None


class RunCreateRequest(BaseModel):
    """The idempotency key is required, not optional.

    A submit that is retried after a dropped response must land on the run the
    first attempt created; without the key the user gets two agents answering
    the same message.

    The key may be sent in the JSON body **or** in the ``Idempotency-Key``
    header.  The desktop frontend sends it as a header, so the body field is
    optional here and the route handler falls back to the header.
    ``agent_definition`` selects an exact installed Definition. The Desktop
    uses ``remote-worker@1`` for official remote workers and otherwise lets the
    gateway choose its local default.
    """

    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)
    agent_definition: str | None = None


class RunExecuteRequest(BaseModel):
    prompt: str
    model_alias: str | None = None
    # ``model`` is the Runtime client's spelling.  Keep both names accepted
    # while the Desktop surface is migrated to the canonical model_alias name.
    model: str | None = None
    user_id: str | None = None
    source_message_id: str | None = None
    reasoning_effort: str | None = None
    plan_mode: bool | None = None
    metadata: dict[str, Any] | None = None
