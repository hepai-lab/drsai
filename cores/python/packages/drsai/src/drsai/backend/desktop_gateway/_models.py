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

from pydantic import BaseModel, Field


class WorkspaceOpenRequest(BaseModel):
    path: str
    display_name: str | None = None


class SessionCreateRequest(BaseModel):
    workspace_id: str
    title: str = "New session"


class SessionUpdateRequest(BaseModel):
    """Rename or archive. ``lifecycle`` wins over ``archived`` when both are set."""

    title: str | None = None
    archived: bool | None = None
    lifecycle: Literal["active", "archived", "removed"] | None = None


class RunCreateRequest(BaseModel):
    """The idempotency key is required, not optional.

    A submit that is retried after a dropped response must land on the run the
    first attempt created; without the key the user gets two agents answering
    the same message.
    """

    idempotency_key: str = Field(min_length=1, max_length=200)


class RunExecuteRequest(BaseModel):
    prompt: str
    model_alias: str | None = None
    user_id: str | None = None
    source_message_id: str | None = None
    metadata: dict[str, Any] | None = None
