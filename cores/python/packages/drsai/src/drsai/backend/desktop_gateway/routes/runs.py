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

from drsai.backend.desktop_gateway._diag import diag_log

import asyncio
from contextlib import nullcontext
from typing import Any

from fastapi import APIRouter, Header, Request
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
async def run_create(session_id: str, request: RunCreateRequest, idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key")):
    """Create the turn record. 201 when new, 200 when the key already ran."""
    idempotency_key = request.idempotency_key or idempotency_key_header
    if not idempotency_key:
        return JSONResponse(
            status_code=422,
            content={"detail": "Idempotency-Key header or body field is required."},
        )
    with _errors.http_errors(not_found="Unknown Session"):
        definition = _state.agent_definition_store().load(_state.DEFAULT_AGENT_DEFINITION)
        run, created = _state.runtime_engine().create_run(
            session_id,
            _state.DEFAULT_AGENT_DEFINITION,
            idempotency_key,
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
    # Accept the renderer/runtime spellings, with explicit request fields
    # taking precedence over legacy metadata.  This keeps configuration
    # request-scoped instead of relying on a cached Agent instance.
    model_alias = request.model_alias or request.model or None
    requested_reasoning_effort = (
        request.reasoning_effort
        if request.reasoning_effort is not None
        else metadata.get("reasoning_effort")
    )
    if requested_reasoning_effort is not None:
        requested_reasoning_effort = str(requested_reasoning_effort)
    requested_plan_mode = (
        request.plan_mode
        if request.plan_mode is not None
        else bool(metadata.get("plan_mode"))
    )

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
            source_message_id=(request.source_message_id or metadata.get("source_message_id")) or None,
            model=model_alias,
        )

    async def execute() -> dict[str, Any]:
        # Re-enter the identity scope: model adapters read HepAI credentials
        # from it, and a detached task must carry its own.
        diag_log(f"[DIAG] runs.py execute(): run_id={run_id} detached task STARTING")
        try:
            result = None
            with platform_auth_scope(auth) if auth else nullcontext():
                result = await _state.agent_service().execute(
                    run_id,
                    request.prompt,
                    correlation_id,
                    model_override=model_alias,
                    reasoning_effort=requested_reasoning_effort,
                    plan_mode=requested_plan_mode,
                )
            diag_log(f"[DIAG] runs.py execute(): run_id={run_id} detached task COMPLETED")
            return result
        except Exception as e:
            diag_log(f"[DIAG] runs.py execute(): run_id={run_id} detached task FAILED: {type(e).__name__}: {e}")
            raise

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
    diag_log(f"[DIAG] _forget: run_id={run_id} task done, cancelled={task.cancelled()}, exception={task.exception() if not task.cancelled() else 'N/A'}")
    if _EXECUTIONS.get(run_id) is task:
        _EXECUTIONS.pop(run_id, None)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None and not isinstance(error, RuntimeExecutionError):
        # RuntimeExecutionError is already on the stream as agent.failed;
        # anything else is a Runtime bug worth a local log line.
        print(f"Detached run {run_id} raised {type(error).__name__}: {error}")


@api.post("/v1/runs/{run_id}/cancel", operation_id="cancelRun")
async def run_cancel(run_id: str):
    """The stop button (feature 3.3)."""
    with _errors.http_errors(not_found="Unknown Run", invalid=409):
        return await _state.agent_service().cancel(run_id)


# ---------------------------------------------------------------------------
# Read paths: inspection, manifest, diagnostics — the frontend needs these
# after every run to render the conversation timeline and the "reproduce"
# panel.  They delegate directly to RuntimeEngine, which already handles
# redaction, encryption, and cursor pagination.
# ---------------------------------------------------------------------------

@api.get("/v1/runs/{run_id}/reproduction-manifest", operation_id="getRunReproductionManifest")
async def run_manifest(run_id: str):
    """Safe reproduction manifest for inspection and replay prompts."""
    with _errors.http_errors(not_found="Unknown Run"):
        return _state.runtime_engine().get_run_manifest(run_id, safe=True)


@api.get("/v1/runs/{run_id}/reproduction-manifest/export", operation_id="exportRunReproductionManifest")
async def run_manifest_export(run_id: str):
    """Full (unsafe) manifest for export to file."""
    with _errors.http_errors(not_found="Unknown Run"):
        return _state.runtime_engine().get_run_manifest(run_id, safe=False)


@api.get("/v1/runs/{run_id}/inspection", operation_id="getRunInspection")
async def run_inspection(
    run_id: str,
    cursor: str | None = None,
    limit: int = 100,
    item_type: str | None = None,
    status: str | None = None,
):
    """Paginated run inspection timeline."""
    with _errors.http_errors(not_found="Unknown Run", invalid=422):
        return _state.runtime_engine().inspect_run(
            run_id,
            timeline_cursor=cursor,
            limit=limit,
            item_type=item_type,
            status=status,
        )


@api.get("/v1/runs/{run_id}/items/{item_id}/locator", operation_id="getRunItemLocator")
async def run_item_locator(
    run_id: str,
    item_id: str,
    item_type: str | None = None,
    status: str | None = None,
):
    """Return a cursor that loads the requested Item on the next page."""
    with _errors.http_errors(not_found="Unknown Run", invalid=422):
        return _state.runtime_engine().locate_run_item(
            run_id,
            item_id,
            item_type=item_type,
            status=status,
        )


@api.get("/v1/runs/{run_id}/diagnostics", operation_id="getRunDiagnostics")
async def run_diagnostics(run_id: str):
    """Diagnostic bundle for debugging run failures."""
    with _errors.http_errors(not_found="Unknown Run"):
        engine = _state.runtime_engine()
        run = engine.get_run(run_id)
        events = engine.list_events(run_id, after_sequence=0, limit=2000)
        correlations = sorted({
            str(event.get("data", {}).get("correlation_id"))
            for event in events
            if isinstance(event.get("data"), dict)
            and event.get("data", {}).get("correlation_id")
        })
        registry = _state.runtime_registry()
        identity = getattr(registry, "identity", None)
        runtime_info = identity.__dict__ if identity and hasattr(identity, "__dict__") else {}
        return {
            "schema_version": 1,
            "runtime": runtime_info,
            "run": run,
            "trace": {"correlation_ids": correlations, "events": events, "audit": []},
            "metrics": {
                "event_count": len(events),
                "audit_count": 0,
                "terminal": run.get("status") in {"completed", "cancelled", "failed"},
            },
        }


@api.get("/v1/sessions/{session_id}/runs", operation_id="listSessionRuns")
async def session_runs(
    session_id: str,
    cursor: str | None = None,
    limit: int = 100,
    status: str | None = None,
):
    """Paginated list of runs for a session."""
    with _errors.http_errors(not_found="Unknown Session", invalid=422):
        return _state.runtime_engine().list_session_runs_page(
            session_id,
            cursor=cursor,
            limit=limit,
            status=status,
        )


def router() -> APIRouter:
    return api
