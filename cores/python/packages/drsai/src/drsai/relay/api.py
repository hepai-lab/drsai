from __future__ import annotations

from uuid import uuid4
from dataclasses import asdict

from fastapi import Depends, FastAPI, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
import json
from typing import Callable

from drsai.platform_auth import context_from_bearer

from .models import (
    AccessGrantResult,
    AccessGrantStatusResult,
    AssociationResult,
    AssociationPresenceRequest,
    AssociationRequest,
    ErrorEnvelope,
    HeartbeatRequest,
    RegistrationRequest,
    RegistrationResult,
    WorkspacePublishRequest,
    Workspace,
    ResourceLifecycle,
)
from .registry import RelayRegistry, RelayRegistryError
from .runtime_domain import RuntimeAuthority
from .runtime_channel import RuntimeChannelHub
from pydantic import BaseModel, ConfigDict


class _StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _SessionCreate(_StrictBody):
    request_id: str
    correlation_id: str
    idempotency_key: str
    title: str
    agent_definition_id: str
    agent_definition_version: str


class _RunCreate(_StrictBody):
    request_id: str
    correlation_id: str
    idempotency_key: str
    message: str
    attachment_refs: list[str] = []
    retry_of: str | None = None


class _ApprovalDecision(_StrictBody):
    request_id: str
    correlation_id: str
    decision: str
    idempotency_key: str | None = None


class _OwopRequest(_StrictBody):
    version: str
    request_id: str
    correlation_id: str
    operation: str
    params: dict


class _RuntimeRename(_StrictBody):
    display_name: str


def create_relay_app(registry: RelayRegistry | None = None,
                     runtimes: dict[str, RuntimeAuthority] | None = None,
                     channels: RuntimeChannelHub | None = None,
                     principal_resolver: Callable[[Request], str] | None = None) -> FastAPI:
    store = registry or RelayRegistry()
    app = FastAPI(title="OpenDrSai Runtime Relay", version="2.0.0")
    app.state.registry = store
    authorities = runtimes or {}
    channel_hub = channels or RuntimeChannelHub()
    app.state.runtime_channels = channel_hub

    def oidc_subject(request: Request) -> str:
        if principal_resolver is not None:
            subject = principal_resolver(request)
            if not subject:
                raise RelayRegistryError("oidc_auth_invalid", "Authenticated Principal is missing")
            return subject
        try:
            return context_from_bearer(request.headers.get("authorization"), "").subject
        except ValueError as exc:
            code = str(exc)
            raise RelayRegistryError("oidc_auth_invalid", f"OIDC Principal is invalid: {code}",
                                     retryable=code in {"token_expired", "oidc_verification_unavailable"}) from exc

    def authority(runtime_id: str) -> RuntimeAuthority:
        if runtime_id not in authorities:
            raise RelayRegistryError("runtime_unavailable", "Runtime control channel is unavailable", retryable=True)
        return authorities[runtime_id]

    def authorize_workspace(subject: str, runtime_id: str, workspace_id: str) -> None:
        store.authorize_workspace(subject, runtime_id, workspace_id)

    async def runtime_call(runtime_id: str, operation: str, *args, **kwargs):
        local = authorities.get(runtime_id)
        if local is not None:
            kwargs.pop("_authorization", None)
            return getattr(local, operation)(*args, **kwargs)
        return await channel_hub.request(runtime_id, operation, {"args": list(args), "kwargs": kwargs})

    def json_dataclass(value):
        if isinstance(value, dict):
            return value
        result = asdict(value)
        for key, item in list(result.items()):
            if hasattr(item, "isoformat"):
                result[key] = item.isoformat()
            elif hasattr(item, "value"):
                result[key] = item.value
            elif isinstance(item, frozenset):
                result[key] = sorted(item)
        return result

    @app.exception_handler(RelayRegistryError)
    async def registry_error(request: Request, exc: RelayRegistryError) -> JSONResponse:
        correlation_id = request.headers.get("x-correlation-id", str(uuid4()))
        error = ErrorEnvelope(code=exc.code, message=exc.message, correlation_id=correlation_id,
                              retryable=exc.retryable, details={}, source=exc.source)
        status = 401 if exc.code in {"oidc_auth_invalid", "runtime_auth_invalid"} else 403 if (
            exc.code.endswith("forbidden") or exc.code == "association_required"
        ) else 404 if exc.code in {
            "runtime_not_found", "access_grant_not_found", "association_not_found",
            "session_not_found", "run_not_found", "approval_not_found",
        } else 400
        return JSONResponse(status_code=status, content=error.model_dump(mode="json"))

    @app.get("/v1/admin/registration-code")
    async def issue_registration_code() -> dict[str, str]:
        return {"code": store.issue_registration_code()}

    @app.post("/v1/runtimes/register", response_model=RegistrationResult)
    async def register(body: RegistrationRequest, x_registration_code: str = Header()) -> RegistrationResult:
        if body.idempotency_key is None:
            raise RelayRegistryError("idempotency_key_required", "Registration requires idempotency_key")
        runtime_id, token = store.register(x_registration_code, body.display_name, body.version, body.public_key,
                                           body.idempotency_key)
        return RegistrationResult(runtime_id=runtime_id, registration_token=token)

    @app.post("/v1/runtimes/{runtime_id}/access-grants", response_model=AccessGrantResult)
    async def access_grant(runtime_id: str, x_runtime_token: str = Header()) -> AccessGrantResult:
        grant_id, code, expires_at = store.issue_access_grant(runtime_id, x_runtime_token)
        return AccessGrantResult(grant_id=grant_id, code=code, expires_at=expires_at, status="pending")

    @app.get("/v1/runtimes/{runtime_id}/access-grants/{grant_id}", response_model=AccessGrantStatusResult)
    async def access_grant_status(runtime_id: str, grant_id: str,
                                  x_runtime_token: str = Header()) -> AccessGrantStatusResult:
        status, expires_at = store.access_grant_status(runtime_id, x_runtime_token, grant_id)
        return AccessGrantStatusResult(
            grant_id=grant_id,
            expires_at=expires_at,
            status=status,
            subject_summary=store.access_grant_subject_summary(
                runtime_id, x_runtime_token, grant_id
            ),
        )

    @app.delete("/v1/runtimes/{runtime_id}/access-grants/{grant_id}", response_model=AccessGrantStatusResult)
    async def revoke_access_grant(runtime_id: str, grant_id: str,
                                  x_runtime_token: str = Header()) -> AccessGrantStatusResult:
        status, expires_at = store.revoke_access_grant(runtime_id, x_runtime_token, grant_id)
        return AccessGrantStatusResult(
            grant_id=grant_id,
            expires_at=expires_at,
            status=status,
            subject_summary=store.access_grant_subject_summary(
                runtime_id, x_runtime_token, grant_id
            ),
        )

    @app.post("/v1/associations")
    async def associate(body: AssociationRequest, x_subject: str = Depends(oidc_subject)) -> dict[str, str]:
        return {
            "runtime_id": store.associate(
                x_subject,
                body.code,
                body.device_id,
                body.device_name,
                body.device_public_key,
            )
        }

    @app.delete("/v1/associations/{runtime_id}", response_model=AssociationResult)
    async def revoke_user_association(
        runtime_id: str,
        x_subject: str = Depends(oidc_subject),
        x_relay_device_id: str = Header(),
    ) -> AssociationResult:
        return AssociationResult.model_validate(
            store.revoke_association(
                x_subject,
                runtime_id,
                x_relay_device_id,
            )
        )

    @app.post("/v1/associations/{runtime_id}/presence", response_model=AssociationResult)
    async def record_user_association_presence(
        runtime_id: str,
        body: AssociationPresenceRequest,
        x_subject: str = Depends(oidc_subject),
        x_relay_device_id: str = Header(),
    ) -> AssociationResult:
        return AssociationResult.model_validate(
            store.record_device_presence(
                x_subject,
                runtime_id,
                x_relay_device_id,
                accessing=body.accessing,
            )
        )

    @app.get(
        "/v1/runtimes/{runtime_id}/associations",
        response_model=list[AssociationResult],
    )
    async def runtime_associations(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> list[AssociationResult]:
        return [
            AssociationResult.model_validate(item)
            for item in store.list_associations(runtime_id, x_runtime_token)
        ]

    @app.delete(
        "/v1/runtimes/{runtime_id}/associations/{association_id}",
        response_model=AssociationResult,
    )
    async def revoke_runtime_association(
        runtime_id: str,
        association_id: str,
        x_runtime_token: str = Header(),
    ) -> AssociationResult:
        return AssociationResult.model_validate(
            store.revoke_runtime_association(
                runtime_id, x_runtime_token, association_id
            )
        )

    @app.delete("/v1/runtimes/{runtime_id}/enrollment")
    async def revoke_runtime_enrollment(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> dict[str, str | None]:
        return store.revoke_enrollment(runtime_id, x_runtime_token)

    @app.post("/v1/runtime-connections/{runtime_id}/heartbeat")
    async def heartbeat(runtime_id: str, body: HeartbeatRequest, x_runtime_token: str = Header()):
        return store.heartbeat(runtime_id, x_runtime_token, instance_id=body.instance_id, version=body.version,
                               capabilities=body.capabilities, backend_health=body.backend_health,
                               nonce=body.nonce, signature=body.signature)

    @app.put("/v1/runtime-connections/{runtime_id}/workspaces", status_code=204)
    async def publish_workspaces(runtime_id: str, body: WorkspacePublishRequest, x_runtime_token: str = Header()):
        store.publish_workspaces(runtime_id, x_runtime_token, body.workspaces)

    @app.get("/v1/runtimes")
    async def list_runtimes(x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                            limit: int = Query(20, ge=1, le=100), query: str | None = None):
        items, next_cursor = store.list_runtimes(x_subject, cursor=cursor, limit=limit, query=query)
        return {"items": [item.model_dump(mode="json") for item in items], "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/runtime")
    async def identity(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        return store.identity(x_subject, runtime_id)

    @app.patch("/v1/runtimes/{runtime_id}")
    async def rename_runtime(
        runtime_id: str,
        body: _RuntimeRename,
        x_subject: str = Depends(oidc_subject),
    ) -> dict[str, str]:
        return store.rename_runtime(x_subject, runtime_id, body.display_name)

    @app.get("/v1/runtimes/{runtime_id}/capabilities")
    async def capabilities(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        return store.capabilities(x_subject, runtime_id)

    @app.get("/v1/runtimes/{runtime_id}/workspaces")
    async def workspaces(runtime_id: str, x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                         limit: int = Query(20, ge=1, le=100), query: str | None = None,
                         lifecycle: ResourceLifecycle | None = ResourceLifecycle.ACTIVE):
        items, next_cursor = store.list_workspaces(
            x_subject, runtime_id, cursor=cursor, limit=limit, query=query, lifecycle=lifecycle)
        return {"items": [item.model_dump(mode="json") for item in items], "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/agent-definitions")
    async def agent_definitions(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        rows = await runtime_call(runtime_id, "list_agent_definitions")
        return {"items": [json_dataclass(item) for item in rows]}

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions")
    async def sessions(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                       limit: int = Query(20, ge=1, le=100), query: str | None = None):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows, next_cursor = await runtime_call(runtime_id, "list_sessions_for_subject", x_subject, workspace_id,
                                               cursor=cursor, limit=limit, query=query)
        return {"items": [json_dataclass(item) for item in rows], "next_cursor": next_cursor}

    @app.post("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions")
    async def create_session(runtime_id: str, workspace_id: str, body: _SessionCreate, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        item = await runtime_call(runtime_id, "create_session", x_subject, workspace_id, title=body.title,
            definition_id=body.agent_definition_id, definition_version=body.agent_definition_version,
            idempotency_key=body.idempotency_key)
        return json_dataclass(item)

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}")
    async def session(runtime_id: str, workspace_id: str, session_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        await runtime_call(runtime_id, "authorize_session", x_subject, workspace_id, session_id)
        return json_dataclass(await runtime_call(runtime_id, "get_session", workspace_id, session_id))

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs")
    async def runs(runtime_id: str, workspace_id: str, session_id: str, x_subject: str = Depends(oidc_subject),
                   cursor: str | None = None, limit: int = Query(20, ge=1, le=100)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows, next_cursor = await runtime_call(runtime_id, "list_runs_for_subject", x_subject, workspace_id,
                                               session_id, cursor=cursor, limit=limit)
        return {"items": [json_dataclass(item) for item in rows], "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation")
    async def conversation(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        x_subject: str = Depends(oidc_subject),
        cursor: str | None = None,
        limit: int = Query(100, ge=1, le=500),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows, next_cursor = await runtime_call(
            runtime_id, "conversation_for_subject", x_subject, workspace_id, session_id,
            cursor=cursor, limit=limit)
        return {"items": rows, "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/idempotency/{operation}/{idempotency_key}")
    async def idempotency_result(runtime_id: str, operation: str, idempotency_key: str,
                                 x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        item = await runtime_call(runtime_id, "idempotency_result", x_subject, operation, idempotency_key)
        return {"status": "succeeded", "operation": operation, "resource": json_dataclass(item)}

    @app.post("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs")
    async def create_run(runtime_id: str, workspace_id: str, session_id: str, body: _RunCreate, request: Request,
                         x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        await runtime_call(runtime_id, "authorize_session", x_subject, workspace_id, session_id)
        item = await runtime_call(runtime_id, "create_run", x_subject, workspace_id, session_id, message=body.message,
            attachment_refs=body.attachment_refs, idempotency_key=body.idempotency_key,
            correlation_id=body.correlation_id, retry_of=body.retry_of,
            _authorization=request.headers.get("authorization"))
        return json_dataclass(item)

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}")
    async def get_run(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        return json_dataclass(await runtime_call(runtime_id, "get_run", run_id))

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}/events")
    async def events(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject), after_sequence: int = Query(0, ge=0),
                     limit: int = Query(100, ge=1, le=500)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        rows, cursor = await runtime_call(runtime_id, "list_events", run_id, after_sequence=after_sequence, limit=limit)
        return {"items": [item.model_dump(mode="json") if hasattr(item, "model_dump") else item for item in rows], "next_cursor": cursor}

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}/events/stream")
    async def event_stream(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject),
                           after_sequence: int = Query(0, ge=0)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        rows, _ = await runtime_call(runtime_id, "list_events", run_id, after_sequence=after_sequence, limit=500)

        def encoded_events():
            for item in rows:
                value = item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                data = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                yield f"id: {value['sequence']}\nevent: {value['kind']}\ndata: {data}\n\n".encode()
            yield b": keep-alive\n\n"

        return StreamingResponse(encoded_events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel")
    async def cancel_run(runtime_id: str, workspace_id: str, run_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        return json_dataclass(await runtime_call(runtime_id, "cancel_run", workspace_id, run_id))

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals")
    async def approvals(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows = await runtime_call(runtime_id, "pending_approvals_for_subject", x_subject, workspace_id)
        return {"items": [json_dataclass(item) for item in rows]}

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/audit")
    async def audit(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject), run_id: str | None = None):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows = await runtime_call(runtime_id, "audit_entries_for_subject", x_subject, workspace_id, run_id)
        return {"items": [json_dataclass(item) for item in rows]}

    @app.post("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/owop")
    async def owop(runtime_id: str, workspace_id: str, body: _OwopRequest, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if body.version != "1.0":
            raise RelayRegistryError("owop_version_incompatible", "OWOP version is incompatible")
        result = await runtime_call(runtime_id, "execute_owop", workspace_id, body.operation, body.params)
        return {"request_id": body.request_id, "correlation_id": body.correlation_id,
                "runtime_id": runtime_id, "workspace_id": workspace_id, "result": result}

    @app.post("/v1/runtimes/{runtime_id}/approvals/{approval_id}/decision")
    async def decide(runtime_id: str, approval_id: str, body: _ApprovalDecision, x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        return json_dataclass(await runtime_call(
            runtime_id, "decide_approval", x_subject, approval_id, body.decision, body.idempotency_key
        ))

    @app.delete("/v1/admin/runtimes/{runtime_id}", status_code=204)
    async def revoke(runtime_id: str):
        store.revoke(runtime_id)

    @app.websocket("/v1/runtime-connect")
    async def runtime_connect(socket: WebSocket) -> None:
        authorization = socket.headers.get("authorization", "")
        if not authorization.startswith("Runtime "):
            await socket.close(code=4401, reason="runtime_auth_required")
            return
        token = authorization.removeprefix("Runtime ")
        await socket.accept()
        try:
            hello = await socket.receive_json()
            if hello.get("type") != "runtime.hello" or hello.get("protocol_version") != "owop/1":
                await socket.close(code=4400, reason="runtime_hello_invalid")
                return
            identity = store.heartbeat(
                hello["runtime_id"], token, instance_id=hello["instance_id"], version=hello["version"],
                capabilities=frozenset(hello["capabilities"]), backend_health=hello.get("backend_health", {}),
                nonce=hello["nonce"], signature=hello["signature"],
            )
            await socket.send_json({"type": "runtime.connected", "runtime": identity.model_dump(mode="json")})
            generation = await channel_hub.attach(hello["runtime_id"], socket)
            while True:
                message = await socket.receive_json()
                if message.get("type") == "pong":
                    continue
                if message.get("type") == "runtime.response":
                    channel_hub.accept_response(hello["runtime_id"], message)
                elif message.get("type") == "runtime.workspaces":
                    rows = message.get("workspaces")
                    if not isinstance(rows, list):
                        await socket.close(code=4400, reason="runtime_workspaces_invalid")
                        return
                    if not await channel_hub.is_current(hello["runtime_id"], generation):
                        continue
                    store.publish_workspaces(hello["runtime_id"], token,
                                             [Workspace.model_validate(row) for row in rows])
        except WebSocketDisconnect:
            return
        finally:
            if "generation" in locals() and "hello" in locals():
                await channel_hub.detach(hello.get("runtime_id", ""), generation)

    return app
