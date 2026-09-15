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
import re
from contextlib import nullcontext
from typing import Any, Mapping

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.evidence import agent_definition_evidence
from drsai.config.model_defaults import PRIVATE_MODEL_NAME
from drsai.platform_auth import platform_auth_scope

from .. import _auth, _errors, _state
from .._models import RunCreateRequest, RunExecuteRequest

api = APIRouter(tags=["runs"])

# Detached executions are kept referenced until they finish; without this the
# event loop is free to garbage-collect a running task mid-turn.
_EXECUTIONS: dict[str, asyncio.Task] = {}
_SELECTED_SKILL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_REMOTE_FILE_MAX_BYTES = 10 * 1024 * 1024
_REMOTE_SKILL_CONTENT_MAX_BYTES = 512 * 1024
# Full skill ZIP packages (scripts/assets) — the Skills Square download
# endpoint caps are comparable; keep a generous but bounded inline limit.
_REMOTE_SKILL_ZIP_MAX_BYTES = 20 * 1024 * 1024


def _remote_payloads(metadata: Mapping[str, Any]) -> tuple[tuple[Mapping[str, Any], ...], tuple[Mapping[str, Any], ...]]:
    """Validate path-free remote files and DDF skill references."""
    import base64

    files: list[Mapping[str, Any]] = []
    total = 0
    raw_files = metadata.get("remote_files")
    if raw_files not in (None, []):
        if not isinstance(raw_files, list):
            raise RuntimeExecutionError("remote_files_invalid", "remote_files must be an array.")
        for raw in raw_files:
            if not isinstance(raw, Mapping):
                raise RuntimeExecutionError("remote_files_invalid", "Each remote file must be an object.")
            name = str(raw.get("name") or "").strip()
            data = str(raw.get("base64") or "")
            encoded = data.split(",", 1)[-1]
            try:
                size = len(base64.b64decode(encoded, validate=True))
            except Exception as exc:
                raise RuntimeExecutionError("remote_files_invalid", f"{name or 'Remote file'} has invalid Base64 data.") from exc
            # Report the cause that actually failed: a missing name, one
            # oversized file and an oversized total are three different
            # problems, and collapsing them into one message is what makes a
            # rejected attachment look unexplained.
            if not name:
                raise RuntimeExecutionError("remote_files_invalid", "Each remote file requires a name.")
            if size > _REMOTE_FILE_MAX_BYTES:
                raise RuntimeExecutionError(
                    "remote_file_too_large",
                    f"{name} exceeds the {_REMOTE_FILE_MAX_BYTES // (1024 * 1024)} MB remote attachment limit.",
                )
            total += size
            if total > _REMOTE_FILE_MAX_BYTES:
                raise RuntimeExecutionError("remote_file_too_large", "Remote attachments must not exceed 10 MB in total.")
            files.append({"name": name, "base64": data, "size": size})
    skills: list[Mapping[str, Any]] = []
    raw_skills = metadata.get("remote_skills")
    if raw_skills not in (None, []):
        if not isinstance(raw_skills, list):
            raise RuntimeExecutionError("remote_skills_invalid", "remote_skills must be an array.")
        for raw in raw_skills:
            if not isinstance(raw, Mapping):
                continue
            skill_id, source = str(raw.get("id") or "").strip(), str(raw.get("source") or "").strip()
            if skill_id and source:
                skill: dict[str, Any] = {"id": skill_id, "source": source}
                name = str(raw.get("name") or "").strip()
                if name:
                    skill["name"] = name
                content = raw.get("content")
                if isinstance(content, str) and content.strip():
                    if len(content.encode("utf-8")) > _REMOTE_SKILL_CONTENT_MAX_BYTES:
                        raise RuntimeExecutionError(
                            "remote_skill_too_large",
                            "Attached skill content must not exceed 512 KB.",
                        )
                    skill["content"] = content
                zip_base64 = raw.get("zip_base64")
                if isinstance(zip_base64, str) and zip_base64.strip():
                    payload = zip_base64.strip()
                    if payload.startswith("data:"):
                        payload = payload.split(",", 1)[-1]
                    try:
                        zip_size = (len(payload) * 3) // 4
                    except Exception:
                        zip_size = 0
                    if zip_size > _REMOTE_SKILL_ZIP_MAX_BYTES:
                        raise RuntimeExecutionError(
                            "remote_skill_too_large",
                            "Attached skill package must not exceed 20 MB.",
                        )
                    try:
                        base64.b64decode(payload, validate=True)
                    except Exception as exc:
                        raise RuntimeExecutionError(
                            "remote_skills_invalid",
                            "Attached skill package has invalid Base64 data.",
                        ) from exc
                    skill["zip_base64"] = payload
                skills.append(skill)
    return tuple(files), tuple(skills)


def _selected_skill_id(metadata: Mapping[str, Any]) -> str | None:
    """Parse composer skill selection from execute metadata."""
    raw = metadata.get("selected_skill_id")
    if raw in (None, ""):
        return None
    if not isinstance(raw, str):
        raise RuntimeExecutionError(
            "thread_skill_invalid",
            "selected_skill_id must be a string skill name.",
            detail={"skill_id": raw},
        )
    skill_id = raw.strip()
    if not skill_id:
        return None
    if not _SELECTED_SKILL_ID_RE.fullmatch(skill_id):
        raise RuntimeExecutionError(
            "thread_skill_invalid",
            "selected_skill_id has an invalid format.",
            detail={"skill_id": skill_id},
        )
    return skill_id


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
        # A Run binds to an exact id@version. Local agents use the built-in
        # OpenDrSai Definition; a remote agent selects the remote-worker
        # Definition (whose worker connection was materialised by
        # /v1/remote-workers/select). Unknown references fail closed.
        session = _state.runtime_engine().get_session(session_id)
        authoritative = session.get("agent_definition") or _state.DEFAULT_AGENT_DEFINITION
        reference = request.agent_definition or authoritative
        if reference != authoritative:
            return JSONResponse(
                status_code=422,
                content={"detail": "agent_definition cannot override the Session binding."},
            )
        definition = _state.agent_definition_store().load(reference)
        run, created = _state.runtime_engine().create_run(
            session_id,
            reference,
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
    # Keep the structured model identity intact.  ``model_alias`` remains a
    # legacy compatibility input, but unified model resolution must receive
    # provider_id and model_id separately.
    model_provider = request.model_selection.provider_id if request.model_selection else None
    model_id = request.model_selection.model_id if request.model_selection else None
    model_alias = request.model_alias or request.model or None
    if request.model_selection is not None:
        model_alias = f"{model_provider}/{model_id}"
    diag_log(
        f"[MODEL_TRACE] run_id={run_id} model_alias={model_alias!r} "
        f"model_provider={model_provider!r} model_id={model_id!r}"
    )
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
        run = engine.get_run(run_id)
        # Private Mode is a per-turn composer switch, but the override is
        # resolved here on the server so a client can never pin the model: the
        # Run's own backend decides.  The override is deliberately alias-only
        # (``model_provider``/``model_id`` cleared) because PRIVATE_MODEL_NAME
        # is a catalog alias that is not registered in any provider's model
        # list; the structured reference path would fail closed in
        # ``resolve_model_ref``.  Reasoning is pinned to "none" so a private
        # Run never spends time (or tokens) thinking.
        if request.private_mode and str(run.get("backend_id") or "") == "opendrsai":
            model_provider = None
            model_id = None
            model_alias = PRIVATE_MODEL_NAME
            requested_reasoning_effort = "none"
            diag_log(
                f"[MODEL_TRACE] private_mode run_id={run_id} "
                f"model_alias={model_alias!r} reasoning_effort='none'"
            )
        engine.update_session(
            str(run["session_id"]),
            model=model_alias,
            reasoning_effort=requested_reasoning_effort,
            plan_mode=requested_plan_mode,
        )
        selected_skill_id = _selected_skill_id(metadata)
        remote_files, remote_skills = _remote_payloads(metadata)
        input_resources = metadata.get("input_resources")
        input_parts = metadata.get("input_parts")
        engine.set_run_input(
            run_id,
            request.prompt,
            input_resources=input_resources if isinstance(input_resources, list) else None,
            input_parts=input_parts if isinstance(input_parts, list) else None,
            attachment_refs=metadata.get("attachment_refs") if isinstance(metadata.get("attachment_refs"), list) else None,
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
                    # Structured model selection is authoritative.  The
                    # alias is retained for legacy AgentDefinition/session
                    # fields, while provider/model_id drive config.toml
                    # resolution in the factory.
                    model_override=None if model_provider and model_id else model_alias,
                    model_provider=model_provider,
                    model_id=model_id,
                    reasoning_effort=requested_reasoning_effort,
                    plan_mode=requested_plan_mode,
                    selected_skill_id=selected_skill_id,
                    remote_files=remote_files,
                    remote_skills=remote_skills,
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
