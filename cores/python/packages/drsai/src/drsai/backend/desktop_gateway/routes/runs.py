"""Runs: create, execute, cancel -- the whole of feature 3.1's write path.

Legacy's ``POST /v1/runs/{run_id}/execute`` is 693 lines, of which roughly 690
prepare arguments for goal confirmation, a codex branch, experiments,
regression control, capability configuration, image understanding, agent model
policy resolution and E2E fixtures. None of that is in the 11 features. What is
left is what always did the work::

    RuntimeAgentService.execute(run_id, prompt, correlation_id, model_override=alias)

**Execute returns 202 and runs in the background.** This settles the third open
question in ``v2-minimal-surface.zh-CN.md`` §4. It matters because the alternative
-- a synchronous long-poll -- ties the run's lifetime to one HTTP connection: a
page refresh, a second window, or a dropped Wi-Fi connection would abandon a
run that is still executing. Output was never on this response anyway; it goes
to the journal via ``services.emit`` and reaches the client on the session event
stream. ``?wait=true`` keeps the synchronous shape for tests and scripts.

Because the work is detached, failures cannot be reported to the caller. They do
not need to be: ``RuntimeAgentService`` records ``agent.failed`` and transitions
the Run to ``failed`` on every exception path, so the renderer sees the failure
on the same stream it is already reading (feature 3.3).
"""

from __future__ import annotations

import asyncio
from contextlib import nullcontext
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.evidence import agent_definition_evidence
from drsai.platform_auth import platform_auth_scope

from .. import _auth, _errors, _state
from .._models import RunCreateRequest, RunExecuteRequest

api = APIRouter(tags=["runs"])

# Detached executions are kept referenced until they finish; without this the
# event loop is free to garbage-collect a running task mid-turn.
_EXECUTIONS: dict[str, asyncio.Task] = {}


@api.post("/v1/sessions/{session_id}/runs", operation_id="createRun")
async def run_create(session_id: str, request: RunCreateRequest):
    """Create the turn record. 201 when new, 200 when the key already ran."""
    with _errors.http_errors(not_found="Unknown Session"):
        definition = _state.agent_definition_store().load(_state.DEFAULT_AGENT_DEFINITION)
        run, created = _state.runtime_engine().create_run(
            session_id,
            _state.DEFAULT_AGENT_DEFINITION,
            request.idempotency_key,
            definition.backend,
            manifest_evidence=agent_definition_evidence(definition),
        )
        return JSONResponse(status_code=201 if created else 200, content=run)


@api.post("/v1/runs/{run_id}/execute", operation_id="executeRun")
async def run_execute(run_id: str, request: RunExecuteRequest, raw_request: Request, wait: bool = False):
    """Bind the prompt to the Run and start the Agent."""
    engine = _state.runtime_engine()
    auth = _auth.auth_context(raw_request)
    correlation_id = _auth.correlation_id(raw_request)
    metadata = request.metadata if isinstance(request.metadata, dict) else {}

    with _errors.http_errors(not_found="Unknown Run", invalid=422):
        # Resolve the Run and bind its input synchronously: both can fail for
        # reasons the caller can fix, and neither is worth discovering later on
        # the event stream.
        engine.get_run(run_id)
        engine.set_run_input(
            run_id,
            request.prompt,
            correlation_id=correlation_id,
            source_client=(
                str(metadata.get("source_client"))
                if metadata.get("source_client") in {"windows", "android", "wechat"}
                else "runtime"
            ),
            source_message_id=request.source_message_id or None,
            model=request.model_alias or None,
        )

    async def execute() -> dict[str, Any]:
        # Re-enter the identity scope: model adapters read HepAI credentials
        # from it, and a detached task must carry its own.
        with platform_auth_scope(auth) if auth else nullcontext():
            return await _state.agent_service().execute(
                run_id,
                request.prompt,
                correlation_id,
                model_override=request.model_alias or None,
            )

    if wait:
        with _errors.http_errors(not_found="Unknown Run", invalid=422):
            return await execute()

    task = asyncio.create_task(execute())
    _EXECUTIONS[run_id] = task
    task.add_done_callback(lambda finished: _forget(run_id, finished))
    return JSONResponse(
        status_code=202,
        content={
            "run": engine.get_run(run_id),
            "accepted": True,
            "events": f"/v1/sessions/{engine.get_run(run_id)['session_id']}/oaep-events/stream",
        },
    )


def _forget(run_id: str, task: asyncio.Task) -> None:
    if _EXECUTIONS.get(run_id) is task:
        _EXECUTIONS.pop(run_id, None)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None and not isinstance(error, RuntimeExecutionError):
        # RuntimeExecutionError is already on the stream as agent.failed;
        # anything else is a Runtime bug worth a local log line.
        from loguru import logger

        logger.error(f"Detached run {run_id} raised {type(error).__name__}: {error}")


@api.post("/v1/runs/{run_id}/cancel", operation_id="cancelRun")
async def run_cancel(run_id: str):
    """The stop button (feature 3.3)."""
    with _errors.http_errors(not_found="Unknown Run", invalid=409):
        return await _state.agent_service().cancel(run_id)


def router() -> APIRouter:
    return api
