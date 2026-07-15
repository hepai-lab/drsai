import asyncio
import base64
import io
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from jose import jwt
from pydantic import BaseModel
from starlette.datastructures import Headers
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)
backend = types.ModuleType("drsai_ui.ui_backend.backend")
backend.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui" / "ui_backend" / "backend")]
sys.modules.setdefault("drsai_ui.ui_backend.backend", backend)

agent_configs = types.ModuleType("drsai_ui.agent_factory.agent_mode_cofigs")
async def _unused_get_user_agents(**_kwargs):
    return {"status": True, "data": []}
agent_configs.get_user_agents = _unused_get_user_agents
sys.modules.setdefault("drsai_ui.agent_factory.agent_mode_cofigs", agent_configs)

deps = types.ModuleType("drsai_ui.ui_backend.backend.web.deps")
deps.get_db = lambda: None
deps.get_websocket_manager = lambda: None
sys.modules.setdefault("drsai_ui.ui_backend.backend.web.deps", deps)

agent_worker = types.ModuleType("drsai_ui.ui_backend.backend.web.routes.agent_worker")
class _AgentPreferenceRequest(BaseModel):
    user_id: str
    agent_id: str
agent_worker.RecordAgentUsageRequest = _AgentPreferenceRequest
agent_worker.SetDefaultAgentRequest = _AgentPreferenceRequest
async def _unused_preference(**_kwargs):
    return {"status": True, "data": {}}
agent_worker.get_recent_user_agents = _unused_preference
agent_worker.get_user_default_agent = _unused_preference
agent_worker.record_user_agent_usage = _unused_preference
agent_worker.set_user_default_agent = _unused_preference
sys.modules.setdefault("drsai_ui.ui_backend.backend.web.routes.agent_worker", agent_worker)

from drsai_ui.ui_backend.backend.web.native_auth import NativeIdentity, get_native_identity
from drsai_ui.ui_backend.backend.web import native_auth
from drsai_ui.ui_backend.backend.web.native_agent_models import public_agent
from drsai_ui.ui_backend.backend.web.native_agent_stream import NativeSseAdapter, NativeStreamSocket
from drsai_ui.ui_backend.backend.web import native_agent_security
from drsai_ui.ui_backend.backend.web.native_attachments import NativeAttachmentStore
from drsai_ui.ui_backend.backend.web.native_agent_security import resolve_and_validate_agent_execution_targets, validate_agent_execution_targets, validate_public_https_url
from drsai_ui.ui_backend.backend.web.routes.native import NativeAgentChatRequest, NativeAgentInputResponse, chat_with_native_agent, respond_to_native_agent_input, stop_native_agent_thread
from drsai_ui.ui_backend.backend.web.routes import native as native_routes


def _upload(name: str, content: bytes, mime: str) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(content), headers=Headers({"content-type": mime}))


def test_public_agent_removes_secrets_and_private_urls():
    public = public_agent(
        {
            "id": "ddf-1",
            "name": "Safe agent",
            "description": "Public description",
            "mode": "ddf",
            "api_key": "MUST_NOT_LEAK",
            "url": "https://private.invalid",
            "config": {
                "api_key": "MUST_NOT_LEAK_EITHER",
                "base_url": "https://private.invalid",
                "model": "public-model",
            },
            "examples": ["Try me", {"zh": "示例", "secret": "hidden"}],
            "capabilities": {"chat": True, "admin": False},
        },
        is_default=True,
        recent={"last_used_at": "2026-07-14T00:00:00Z"},
        catalog_group="mine",
    )
    serialized = str(public)
    assert "MUST_NOT_LEAK" not in serialized
    assert "private.invalid" not in serialized
    assert public["model"] == "public-model"
    assert public["is_default"] is True
    assert public["catalog_group"] == "mine"
    assert public["capabilities"] == ["chat"]
    assert public["examples"] == ["Try me", {"zh": "示例"}]


def test_native_identity_rejects_missing_and_untrusted_tokens_without_network():
    with pytest.raises(HTTPException) as missing:
        asyncio.run(get_native_identity(None))
    assert missing.value.status_code == 401
    assert missing.value.detail["code"] == "missing_token"

    token = jwt.encode(
        {"sub": "attacker", "iss": "https://untrusted.invalid/api", "exp": 4102444800},
        "not-used",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as untrusted:
        asyncio.run(get_native_identity(f"Bearer {token}"))
    assert untrusted.value.status_code == 401
    assert untrusted.value.detail["code"] == "unsupported_issuer"


def test_native_identity_verifies_rs256_audience_and_derives_subject(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()

    def encoded_number(value):
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    jwk = {
        "kty": "RSA",
        "kid": "native-test-key",
        "use": "sig",
        "alg": "RS256",
        "n": encoded_number(public_numbers.n),
        "e": encoded_number(public_numbers.e),
    }

    async def fake_jwks(_issuer):
        return {"keys": [jwk]}

    monkeypatch.setattr(native_auth, "_get_jwks", fake_jwks)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = jwt.encode(
        {
            "sub": "oidc-subject-42",
            "iss": "https://ai-dev.ihep.ac.cn/api",
            "aud": "hai-api",
            "exp": 4102444800,
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": "native-test-key"},
    )
    identity = asyncio.run(get_native_identity(f"Bearer {token}"))
    assert identity.user_id == "oidc-subject-42"
    assert identity.issuer == "https://ai-dev.ihep.ac.cn/api"


def test_native_sse_adapter_maps_chunks_logs_files_input_and_done_without_secrets():
    adapter = NativeSseAdapter()
    frames, terminal = adapter.encode({"type": "message_chunk", "data": {"source": "assistant", "content": "hello"}})
    assert terminal is False
    assert '"content":"hello"' in frames[0]

    duplicate, _ = adapter.encode({"type": "message", "data": {"source": "assistant", "content": "hello", "api_key": "secret"}})
    assert duplicate == []

    logs, _ = adapter.encode({"type": "message_log", "data": {"title": "Planning", "content": "step", "api_key": "secret"}})
    assert logs[0].startswith("event: agent.log")
    assert "secret" not in logs[0]

    files, _ = adapter.encode({"type": "message_files", "data": {"files": [{"id": "att_1", "path": "result.txt", "name": "result.txt", "mime_type": "text/plain", "size": 6, "url": "https://private.invalid", "api_key": "secret"}]}})
    assert '"path":"result.txt"' in files[0]
    assert '"id":"att_1"' in files[0]
    assert '"mime_type":"text/plain"' in files[0]
    assert "private.invalid" not in files[0]
    assert "secret" not in files[0]

    inputs, _ = adapter.encode({"type": "input_request", "input_type": "approval", "prompt": "Continue?"})
    assert inputs[0].startswith("event: agent.input_request")
    assert '"prompt":"Continue?"' in inputs[0]

    done, terminal = adapter.encode({"type": "completion", "status": "complete", "data": {"config": {"api_key": "secret"}}})
    assert terminal is True
    assert done == ["data: [DONE]\n\n"]


def test_native_stream_socket_queues_runtime_messages():
    async def exercise():
        socket = NativeStreamSocket(max_queue=2)
        await socket.accept()
        await socket.send_json({"type": "system", "status": "connected"})
        return await socket.queue.get()

    assert asyncio.run(exercise()) == {"type": "system", "status": "connected"}


def test_native_sse_adapter_maps_structured_error_without_private_data():
    frames, terminal = NativeSseAdapter().encode({
        "type": "error",
        "error": "Agent is offline",
        "config": {"api_key": "MUST_NOT_STREAM"},
    })
    assert terminal is True
    assert '"code":"agent_execution_failed"' in frames[0]
    assert "Agent is offline" in frames[0]
    assert "MUST_NOT_STREAM" not in frames[0]


@pytest.mark.parametrize("mode", ["ddf", "remote", "custom"])
def test_native_chat_endpoint_reuses_run_and_streams_public_sse(mode, monkeypatch, tmp_path):
    async def allow_test_target(agent):
        return {"aiapi.ihep.ac.cn" if agent.get("mode") == "ddf" else "agents.example.com"}
    monkeypatch.setattr(native_routes, "resolve_and_validate_agent_execution_targets", allow_test_target)
    class FakeDb:
        def __init__(self):
            self.sessions = []
            self.runs = []
            self.agent = {
                "id": "ddf-1",
                "name": "DDF Agent",
                "mode": mode,
                "config": {"api_key": "MUST_NOT_STREAM", "base_url": "https://aiapi.ihep.ac.cn/apiv2" if mode == "ddf" else "https://agents.example.com/v1"},
            }

        def get(self, model, filters=None, **_kwargs):
            filters = filters or {}
            if model.__name__ == "UserAgents":
                return SimpleNamespace(status=True, data=[SimpleNamespace(agents=[self.agent])])
            rows = self.sessions if model.__name__ == "Session" else self.runs
            selected = [row for row in rows if all(getattr(row, key, None) == value for key, value in filters.items())]
            return SimpleNamespace(status=True, data=selected)

        def upsert(self, model, **_kwargs):
            if model.__class__.__name__ == "Session":
                model.id = len(self.sessions) + 1
                self.sessions.append(model)
            else:
                model.id = len(self.runs) + 1
                self.runs.append(model)
            return SimpleNamespace(status=True, data=model)

    class FakeManager:
        def __init__(self):
            self.socket = None
            self.started = []
            self.disconnected = []

        async def connect(self, socket, run_id):
            self.socket = socket
            await socket.accept()
            await socket.send_json({"type": "system", "status": "connected"})
            return True

        async def start_stream(self, run_id, task, team_config, settings_config, files=None):
            self.started.append((run_id, task, team_config, settings_config, files))
            await self.socket.send_json({"type": "message_chunk", "data": {"source": "assistant", "content": "answer"}})
            await self.socket.send_json({"type": "message_files", "data": {"files": [{"path": "artifact.txt", "name": "artifact.txt", "api_key": "MUST_NOT_STREAM"}]}})
            await self.socket.send_json({"type": "completion", "status": "complete", "data": {}})

        async def stop_run(self, _run_id, _reason):
            return None

        async def disconnect(self, run_id, **_kwargs):
            self.disconnected.append(run_id)

    async def exercise():
        db = FakeDb()
        manager = FakeManager()
        request = NativeAgentChatRequest(
            messages=[{"role": "user", "content": "question"}],
            thread_id="thread-12345678",
            attachments=[{"kind": "file", "name": "input.txt", "path": "C:/private/input.txt"}],
        )
        response = await chat_with_native_agent(
            agent_id="ddf-1",
            request=request,
            identity=NativeIdentity(user_id="native-user", issuer="https://ai-dev.ihep.ac.cn/api"),
            db=db,
            manager=manager,
            attachment_store=NativeAttachmentStore(tmp_path / mode),
        )
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        first_run_id = manager.started[0][0]
        second = await chat_with_native_agent(
            agent_id="ddf-1",
            request=request,
            identity=NativeIdentity(user_id="native-user", issuer="https://ai-dev.ihep.ac.cn/api"),
            db=db,
            manager=manager,
            attachment_store=NativeAttachmentStore(tmp_path / mode),
        )
        async for _chunk in second.body_iterator:
            pass
        return "".join(chunks), response, first_run_id, manager.started[1][0], manager

    stream, response, first_run_id, second_run_id, manager = asyncio.run(exercise())
    assert '"content":"answer"' in stream
    assert '"path":"artifact.txt"' in stream
    assert "MUST_NOT_STREAM" not in stream
    assert "aiapi.ihep.ac.cn" not in stream
    assert stream.endswith("data: [DONE]\n\n")
    assert response.media_type == "text/event-stream"
    assert response.headers["x-accel-buffering"] == "no"
    assert first_run_id == second_run_id
    assert manager.started[0][4] == [{"name": "input.txt", "kind": "file"}]
    assert manager.started[0][3]["agent_mode_config"]["mode"] == mode


@pytest.mark.parametrize("url", [
    "http://agents.example.com/v1",
    "https://localhost/v1",
    "https://127.0.0.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://user:password@agents.example.com/v1",
])
def test_native_execution_target_policy_blocks_unsafe_urls(url):
    with pytest.raises(ValueError):
        validate_public_https_url(url)


def test_native_execution_target_policy_allows_public_https_and_restricts_ddf(monkeypatch):
    monkeypatch.delenv("OPENDRSAI_NATIVE_REMOTE_HOST_ALLOWLIST", raising=False)
    assert validate_public_https_url("https://agents.example.com/v1") == "agents.example.com"
    assert validate_agent_execution_targets({"mode": "ddf", "config": {"base_url": "https://aiapi.ihep.ac.cn/apiv2"}}) == {"aiapi.ihep.ac.cn"}
    with pytest.raises(ValueError):
        validate_agent_execution_targets({"mode": "ddf", "config": {"base_url": "https://agents.example.com/v1"}})
    monkeypatch.setenv("OPENDRSAI_NATIVE_REMOTE_HOST_ALLOWLIST", "approved.example.com")
    assert validate_public_https_url("https://api.approved.example.com/v1") == "api.approved.example.com"
    with pytest.raises(ValueError, match="allowlist"):
        validate_public_https_url("https://agents.example.com/v1")


def test_native_execution_target_dns_rejects_private_resolution(monkeypatch):
    async def private_resolution(_host):
        return {"127.0.0.1"}
    monkeypatch.setattr(native_agent_security, "_resolve_host", private_resolution)
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(resolve_and_validate_agent_execution_targets({"mode": "remote", "config": {"base_url": "https://agents.example.com/v1"}}))

    async def public_resolution(_host):
        return {"93.184.216.34"}
    monkeypatch.setattr(native_agent_security, "_resolve_host", public_resolution)
    assert asyncio.run(resolve_and_validate_agent_execution_targets({"mode": "remote", "config": {"base_url": "https://agents.example.com/v1"}})) == {"agents.example.com"}


def test_native_chat_disconnect_stops_runtime(monkeypatch, tmp_path):
    async def allow_test_target(_agent):
        return {"aiapi.ihep.ac.cn"}
    monkeypatch.setattr(native_routes, "resolve_and_validate_agent_execution_targets", allow_test_target)
    class FakeDb:
        def __init__(self):
            self.sessions = []
            self.runs = []
            self.agent = {"id": "ddf-1", "name": "DDF", "mode": "ddf", "config": {"base_url": "https://aiapi.ihep.ac.cn/apiv2", "api_key": "secret"}}

        def get(self, model, filters=None, **_kwargs):
            filters = filters or {}
            if model.__name__ == "UserAgents":
                return SimpleNamespace(status=True, data=[SimpleNamespace(agents=[self.agent])])
            rows = self.sessions if model.__name__ == "Session" else self.runs
            return SimpleNamespace(status=True, data=[row for row in rows if all(getattr(row, key, None) == value for key, value in filters.items())])

        def upsert(self, model, **_kwargs):
            rows = self.sessions if model.__class__.__name__ == "Session" else self.runs
            model.id = len(rows) + 1
            rows.append(model)
            return SimpleNamespace(status=True, data=model)

    class BlockingManager:
        def __init__(self):
            self.socket = None
            self.stopped = []
            self.release = asyncio.Event()

        async def connect(self, socket, _run_id):
            self.socket = socket
            await socket.accept()
            await socket.send_json({"type": "system", "status": "connected"})
            return True

        async def start_stream(self, _run_id, _task, _team, _settings, files=None):
            await self.socket.send_json({"type": "message_chunk", "data": {"content": "partial"}})
            await self.release.wait()

        async def stop_run(self, run_id, reason):
            self.stopped.append((run_id, reason))
            self.release.set()

        async def disconnect(self, _run_id, **_kwargs):
            return None

    async def exercise():
        manager = BlockingManager()
        response = await chat_with_native_agent(
            agent_id="ddf-1",
            request=NativeAgentChatRequest(messages=[{"role": "user", "content": "question"}], thread_id="thread-cancel-1"),
            identity=NativeIdentity(user_id="native-user", issuer="https://ai-dev.ihep.ac.cn/api"),
            db=FakeDb(),
            manager=manager,
            attachment_store=NativeAttachmentStore(tmp_path),
        )
        first = await response.body_iterator.__anext__()
        await response.body_iterator.aclose()
        await asyncio.sleep(0)
        return first, manager.stopped

    first, stopped = asyncio.run(exercise())
    assert '"content":"partial"' in first
    assert stopped == [(1, "Native client disconnected")]


def test_native_chat_rollout_flag_returns_404(monkeypatch):
    monkeypatch.setenv("OPENDRSAI_NATIVE_AGENT_CHAT_ENABLED", "false")
    request = NativeAgentChatRequest(
        messages=[{"role": "user", "content": "question"}],
        thread_id="thread-disabled-1",
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(chat_with_native_agent(
            agent_id="ddf-1",
            request=request,
            identity=NativeIdentity(user_id="native-user", issuer="https://ai-dev.ihep.ac.cn/api"),
            db=None,
            manager=None,
        ))
    assert error.value.status_code == 404


def test_native_chat_attachment_ids_resolve_to_owned_runtime_files(tmp_path):
    store = NativeAttachmentStore(tmp_path)
    item = asyncio.run(store.save(_upload("input.txt", b"real attachment content", "text/plain"), "native-user", "thread-1", "run-1"))
    files = native_routes._resolve_native_attachments(
        [{"id": item.id}], "native-user", "thread-1", store,
    )
    assert files[0]["id"] == item.id
    assert files[0]["name"] == "input.txt"
    assert files[0]["type"] == "text/plain"
    assert Path(files[0]["path"]).read_text(encoding="utf-8") == "real attachment content"
    with pytest.raises(HTTPException) as wrong_thread:
        native_routes._resolve_native_attachments(
            [{"id": item.id}], "native-user", "thread-2", store,
        )
    assert wrong_thread.value.status_code == 403


def test_native_runtime_materialization_uses_temp_copy_and_cleans_source_contract(tmp_path):
    source = tmp_path / "source.txt"
    source.write_text("content", encoding="utf-8")
    files, root = native_routes._materialize_native_files([{
        "id": "att_1", "name": "source.txt", "path": str(source), "kind": "file",
    }])
    assert root is not None
    assert Path(files[0]["path"]).parent == Path(root)
    assert Path(files[0]["path"]).read_text(encoding="utf-8") == "content"
    assert source.is_file()
    import shutil
    shutil.rmtree(root)


def test_native_stop_and_input_validate_thread_and_size(monkeypatch):
    monkeypatch.setenv("OPENDRSAI_NATIVE_AGENT_CHAT_ENABLED", "true")
    identity = NativeIdentity(user_id="native-user", issuer="https://ai-dev.ihep.ac.cn/api")
    with pytest.raises(HTTPException) as invalid_thread:
        asyncio.run(stop_native_agent_thread("ddf-1", "../bad", identity, None, None))
    assert invalid_thread.value.status_code == 400
    with pytest.raises(HTTPException) as oversized:
        asyncio.run(respond_to_native_agent_input(
            "ddf-1",
            "thread-valid-1",
            NativeAgentInputResponse(response="x" * 16_001),
            identity,
            None,
            None,
        ))
    assert oversized.value.status_code == 413
