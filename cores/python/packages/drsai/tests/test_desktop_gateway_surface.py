"""Contract and behaviour tests for the Desktop V2 gateway.

Three things are pinned here, in order of how expensive they are to get wrong:

1. **The route inventory.** V2 exists to be small. A route added without a
   corresponding feature is the failure mode this whole package was written to
   avoid, so the exact set is frozen in :data:`EXPECTED_ROUTES`.
2. **The 202 + event-stream contract.** ``execute`` must not carry run output on
   its own response, and events must reach the journal whether or not anyone is
   listening. This is what makes reconnect, a second window, and a page refresh
   non-lossy.
3. **Snapshot/stream agreement.** A client that replays events from sequence 0
   and a client that reads the snapshot must land on the same conversation.

Everything runs against a temporary ``DRSAI_DESKTOP_GATEWAY_HOME`` with a stub Agent
Backend, so no test here reaches a model provider.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from drsai.backend.desktop_gateway import _state, create_app
from drsai.backend.desktop_gateway.routes import runtime as runtime_routes

EXPECTED_ROUTES = {
    ("GET", "/v1/runtime"),
    ("GET", "/v1/workspaces"),
    ("POST", "/v1/workspaces"),
    ("GET", "/v1/workspaces/{workspace_id}/files"),
    ("GET", "/v1/workspaces/{workspace_id}/file"),
    ("POST", "/v1/sessions"),
    ("GET", "/v1/sessions"),
    ("GET", "/v1/sessions/{session_id}"),
    ("PATCH", "/v1/sessions/{session_id}"),
    ("GET", "/v1/sessions/{session_id}/oaep-snapshot"),
    ("GET", "/v1/sessions/{session_id}/oaep-events"),
    ("GET", "/v1/sessions/{session_id}/oaep-events/stream"),
    ("POST", "/v1/sessions/{session_id}/runs"),
    ("POST", "/v1/runs/{run_id}/execute"),
    ("POST", "/v1/runs/{run_id}/cancel"),
    ("GET", "/v1/config/model-catalog"),
    ("POST", "/v1/audio/transcriptions"),
}

HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete"})


class StubBackend:
    """An ``AgentBackend`` that emits a fixed turn without touching a model."""

    backend_id = "opendrsai"

    def __init__(self) -> None:
        self.cancelled: list[str] = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.hold = False

    async def execute(self, context, definition, prompt, services) -> dict[str, Any]:
        services.emit(context, "agent.started", {"backend": self.backend_id})
        self.started.set()
        if self.hold:
            await self.release.wait()
        for chunk in ("Hello", ", ", "world"):
            services.emit(context, "agent.message.delta", {"delta": chunk, "content": chunk})
        services.emit(context, "agent.completed", {"content": "Hello, world"})
        return {"content": "Hello, world", "model": definition.model}

    async def cancel(self, run_id: str) -> None:
        self.cancelled.append(run_id)
        self.release.set()

    async def respond_approval(self, run_id, approval_id, decision) -> None:  # pragma: no cover
        raise NotImplementedError

    async def recover(self, run_id: str) -> None:
        return None

    async def health(self) -> dict[str, Any]:
        return {"backend": self.backend_id}

    async def close(self) -> None:
        return None

    async def account_status(self, *, refresh: bool = False) -> dict[str, Any]:
        return {"signed_in": False}


@pytest.fixture
def backend() -> StubBackend:
    return StubBackend()


@pytest.fixture
def v2_env(tmp_path, monkeypatch, backend):
    """Isolate the state root and swap the Agent Backend for the stub."""
    monkeypatch.setenv("DRSAI_DESKTOP_GATEWAY_HOME", str(tmp_path / "home"))
    # The pairing token is read from DRSAI_HOME (it is a Desktop handoff file,
    # not Runtime state), so both roots have to move or a developer's real
    # ~/.drsai/runtime/instance-token turns every request into a 401.
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", raising=False)
    _state.reset_state()

    from drsai.backend.runtime.agent import RuntimeAgentService

    def stub_service():
        if _state._agent_service is None:
            _state._agent_service = RuntimeAgentService(
                _state.runtime_engine(),
                _state.runtime_registry(),
                _state.agent_definition_store(),
                _state.tool_dispatcher(),
                {backend.backend_id: backend},
            )
        return _state._agent_service

    monkeypatch.setattr(_state, "agent_service", stub_service)
    yield
    _state.reset_state()


@pytest.fixture
def client(v2_env):
    """In-process client. Fine for everything except the SSE route."""
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def live_server(v2_env):
    """A real uvicorn server on an ephemeral port.

    ``TestClient`` cannot be used for the event stream: its transport runs the
    ASGI app to completion inside ``portal.call`` and buffers the whole body,
    and its ``receive()`` only reports ``http.disconnect`` once the response has
    completed. An endless SSE response therefore deadlocks the client and the
    handler's own disconnect check at the same time. Streaming has to be tested
    over real HTTP or not at all.
    """
    import socket
    import threading

    import httpx
    import uvicorn

    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()

    server = uvicorn.Server(
        uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started, "uvicorn did not start"

    with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as http:
        yield http

    server.should_exit = True
    thread.join(timeout=15)


@pytest.fixture
def workspace(client, tmp_path):
    root = tmp_path / "project"
    (root / "artifacts").mkdir(parents=True)
    # Bytes rather than write_text: Windows would translate the LF, and the
    # route is correct to return the file verbatim.
    (root / "notes.md").write_bytes(b"# notes\n")
    response = client.post("/v1/workspaces", json={"path": str(root)})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def session(client, workspace):
    response = client.post(
        "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": "First"},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ─────────────────────────────────────────────────────────── surface shape


def test_the_surface_is_exactly_the_agreed_routes(client) -> None:
    """The point of V2 is the size of this set; drift needs a decision, not a merge."""
    paths = client.app.openapi()["paths"]
    found = {
        (method.upper(), path)
        for path, item in paths.items()
        for method in item
        if method in HTTP_METHODS
    }
    assert found == EXPECTED_ROUTES, (
        f"added: {sorted(found - EXPECTED_ROUTES)}, removed: {sorted(EXPECTED_ROUTES - found)}"
    )


def test_operation_ids_are_explicit_and_unique(client) -> None:
    """The desktop client is generated from these; a rename is a compile break."""
    paths = client.app.openapi()["paths"]
    ids = [
        item[method]["operationId"]
        for item in paths.values()
        for method in item
        if method in HTTP_METHODS
    ]
    assert len(ids) == len(set(ids)), "duplicate operationId"
    # FastAPI's derived ids embed the path and method; explicit ids do not.
    assert not [name for name in ids if "__" in name], (
        f"these routes fell back to a derived operationId: {[n for n in ids if '__' in n]}"
    )


def test_only_the_handshake_is_reachable_without_pairing(monkeypatch, tmp_path) -> None:
    """Anything else answerable without the pairing token would be a hole."""
    monkeypatch.setenv("DRSAI_DESKTOP_GATEWAY_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "expected-token")
    _state.reset_state()
    with TestClient(create_app()) as guarded:
        assert guarded.get("/v1/runtime").status_code == 200
        for path in ("/v1/workspaces", "/v1/config/model-catalog"):
            response = guarded.get(path)
            assert response.status_code == 401, path
            assert response.json()["error"]["code"] == "gateway_unauthorized"
        paired = guarded.get(
            "/v1/workspaces", headers={"x-opendrsai-gateway-token": "expected-token"},
        )
        assert paired.status_code == 200
    _state.reset_state()


def test_runtime_identity_reports_this_process(client) -> None:
    payload = client.get("/v1/runtime").json()
    assert payload["surface"] == "desktop-v2"
    assert payload["runtime_source_digest"] == runtime_routes.SOURCE_DIGEST
    assert "speech_to_text" in payload["capabilities"]


# ────────────────────────────────────────────────── workspaces and files


def test_opening_a_workspace_twice_returns_one_record(client, tmp_path) -> None:
    """The renderer opens on every launch; duplicates would fork the history."""
    root = tmp_path / "repeat"
    root.mkdir()
    first = client.post("/v1/workspaces", json={"path": str(root)}).json()
    second = client.post("/v1/workspaces", json={"path": str(root)}).json()
    assert first["workspace_id"] == second["workspace_id"]
    listed = client.get("/v1/workspaces").json()["data"]
    assert [record["workspace_id"] for record in listed].count(first["workspace_id"]) == 1


def test_file_tree_lists_workspace_contents(client, workspace) -> None:
    payload = client.get(f"/v1/workspaces/{workspace['workspace_id']}/files").json()
    names = {row["name"] for row in payload["data"]}
    assert "notes.md" in names


def test_file_tree_skips_noise_directories(client, workspace, tmp_path) -> None:
    """One node_modules turns a tree into tens of thousands of rows."""
    noisy = tmp_path / "project" / "node_modules" / "pkg"
    noisy.mkdir(parents=True)
    (noisy / "index.js").write_text("", encoding="utf-8")
    payload = client.get(f"/v1/workspaces/{workspace['workspace_id']}/files").json()
    assert "node_modules" not in {row["name"] for row in payload["data"]}


def test_reading_a_text_file_returns_utf8(client, workspace) -> None:
    payload = client.get(
        f"/v1/workspaces/{workspace['workspace_id']}/file", params={"path": "notes.md"},
    ).json()
    assert payload["binary"] is False
    assert payload["content"] == "# notes\n"
    assert payload["encoding"] == "utf-8"


def test_reading_a_binary_file_returns_a_data_url(client, workspace, tmp_path) -> None:
    """The preview pane needs one branch, not a content-type table."""
    (tmp_path / "project" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00")
    payload = client.get(
        f"/v1/workspaces/{workspace['workspace_id']}/file", params={"path": "logo.png"},
    ).json()
    assert payload["binary"] is True
    assert payload["data_url"].startswith("data:image/png;base64,")


def test_a_path_outside_the_workspace_is_refused(client, workspace) -> None:
    response = client.get(
        f"/v1/workspaces/{workspace['workspace_id']}/file", params={"path": "../secrets"},
    )
    assert response.status_code in {400, 403}


# ────────────────────────────────────────────────────────────── sessions


def test_sessions_are_listed_per_workspace(client, workspace, session) -> None:
    payload = client.get("/v1/sessions", params={"workspace_id": workspace["workspace_id"]}).json()
    assert [row["session_id"] for row in payload["data"]] == [session["session_id"]]


def test_a_session_can_be_renamed_and_archived(client, workspace, session) -> None:
    renamed = client.patch(
        f"/v1/sessions/{session['session_id']}", json={"title": "Renamed"},
    ).json()
    assert renamed["title"] == "Renamed"
    archived = client.patch(
        f"/v1/sessions/{session['session_id']}", json={"archived": True},
    ).json()
    assert archived["lifecycle"] == "archived"
    active = client.get("/v1/sessions", params={"workspace_id": workspace["workspace_id"]}).json()
    assert active["data"] == []


def test_an_unknown_session_is_a_404(client) -> None:
    assert client.get("/v1/sessions/session-missing").status_code == 404


def test_creating_a_session_in_an_unknown_workspace_is_a_404(client) -> None:
    response = client.post("/v1/sessions", json={"workspace_id": "workspace-missing"})
    assert response.status_code == 404


# ────────────────────────────────────────────────────────────────── runs


def test_a_retried_submit_reuses_the_first_run(client, session) -> None:
    """Without this, a dropped response makes two agents answer one message."""
    body = {"idempotency_key": "submit-1"}
    first = client.post(f"/v1/sessions/{session['session_id']}/runs", json=body)
    second = client.post(f"/v1/sessions/{session['session_id']}/runs", json=body)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["run_id"] == second.json()["run_id"]


def test_execute_returns_202_without_the_answer(client, session) -> None:
    """The contract: run output is never carried on the request that started it."""
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k202"},
    ).json()
    response = client.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi", "model_alias": "deepseek-v4-pro"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["accepted"] is True
    assert "Hello, world" not in json.dumps(payload)
    assert payload["events"].endswith("/oaep-events/stream")


def test_the_answer_arrives_on_the_session_stream(client, session) -> None:
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-stream"},
    ).json()
    assert client.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}, params={"wait": True},
    ).status_code == 200

    events = client.get(f"/v1/sessions/{session['session_id']}/oaep-events").json()["data"]
    text = "".join(
        event["data"]["delta"].get("text", "")
        for event in events
        if event["type"] == "event.item.delta"
        and event["data"]["delta"].get("kind") == "message.text.append"
    )
    assert text == "Hello, world"


def test_replaying_events_reproduces_the_snapshot(client, session) -> None:
    """A client that reconnects must render the same conversation as one that did not."""
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-replay"},
    ).json()
    client.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}, params={"wait": True},
    )
    snapshot = client.get(f"/v1/sessions/{session['session_id']}/oaep-snapshot").json()
    events = client.get(f"/v1/sessions/{session['session_id']}/oaep-events").json()["data"]

    replayed = _replay(events)
    assert [item["id"] for item in replayed] == [item["id"] for item in snapshot["items"]]
    for actual, expected in zip(replayed, snapshot["items"]):
        assert actual.get("content", {}).get("text") == expected.get("content", {}).get("text")


def test_event_sequences_are_dense(client, session) -> None:
    """Clients resume from a cursor, so a hole is indistinguishable from loss."""
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-dense"},
    ).json()
    client.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}, params={"wait": True},
    )
    events = client.get(f"/v1/sessions/{session['session_id']}/oaep-events").json()["data"]
    sequences = [event["sequence"] for event in events]
    assert sequences == list(range(1, len(sequences) + 1))


def test_after_sequence_returns_only_what_was_missed(client, session) -> None:
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-after"},
    ).json()
    client.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}, params={"wait": True},
    )
    everything = client.get(f"/v1/sessions/{session['session_id']}/oaep-events").json()["data"]
    cut = everything[2]["sequence"]
    tail = client.get(
        f"/v1/sessions/{session['session_id']}/oaep-events", params={"after_sequence": cut},
    ).json()["data"]
    assert [event["sequence"] for event in tail] == [
        event["sequence"] for event in everything if event["sequence"] > cut
    ]


def test_the_live_stream_delivers_events_produced_before_it_opened(live_server) -> None:
    """Subscribing late must not lose what already happened.

    This is the reconnect case, and it is the reason ``after_sequence`` is on
    the stream route and not only on the replay route: one connection covers
    "what I missed" and "what happens next" without a gap between them.
    """
    import tempfile

    root = tempfile.mkdtemp()
    workspace = live_server.post("/v1/workspaces", json={"path": root}).json()
    session = live_server.post(
        "/v1/sessions", json={"workspace_id": workspace["workspace_id"]},
    ).json()
    run = live_server.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-sse"},
    ).json()
    assert live_server.post(
        f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}, params={"wait": True},
    ).status_code == 200

    with live_server.stream(
        "GET",
        f"/v1/sessions/{session['session_id']}/oaep-events/stream",
        params={"after_sequence": 0},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        payloads = []
        for line in response.iter_lines():
            if line.startswith("data: "):
                payloads.append(json.loads(line[6:]))
            if len(payloads) >= 3:
                break

    assert len(payloads) == 3
    assert [event["sequence"] for event in payloads] == [1, 2, 3]


def test_the_stream_carries_a_run_started_after_it_opened(live_server) -> None:
    """The half that makes 202 worth anything: output arrives on a connection
    that was opened before the run existed."""
    import tempfile
    import threading

    root = tempfile.mkdtemp()
    workspace = live_server.post("/v1/workspaces", json={"path": root}).json()
    session = live_server.post(
        "/v1/sessions", json={"workspace_id": workspace["workspace_id"]},
    ).json()

    started = threading.Event()

    def submit() -> None:
        started.wait(10)
        run = live_server.post(
            f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-late"},
        ).json()
        live_server.post(f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"})

    worker = threading.Thread(target=submit, daemon=True)
    worker.start()

    text = ""
    with live_server.stream(
        "GET",
        f"/v1/sessions/{session['session_id']}/oaep-events/stream",
        params={"after_sequence": 0},
    ) as response:
        started.set()
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            delta = (event.get("data") or {}).get("delta") or {}
            if delta.get("kind") == "message.text.append":
                text += delta.get("text", "")
            if text == "Hello, world":
                break
    worker.join(timeout=10)
    assert text == "Hello, world"


def test_streaming_an_unknown_session_fails_before_the_body(client) -> None:
    """A 200 that closes at once is indistinguishable from an idle stream."""
    response = client.get("/v1/sessions/session-missing/oaep-events/stream")
    assert response.status_code == 404


def test_cancel_reaches_the_backend(client, session, backend) -> None:
    backend.hold = True
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-cancel"},
    ).json()
    assert client.post(f"/v1/runs/{run['run_id']}/execute", json={"prompt": "hi"}).status_code == 202
    response = client.post(f"/v1/runs/{run['run_id']}/cancel")
    assert response.status_code == 200
    assert client.get(f"/v1/sessions/{session['session_id']}").status_code == 200


def test_executing_an_unknown_run_is_a_404(client) -> None:
    assert client.post("/v1/runs/run-missing/execute", json={"prompt": "hi"}).status_code == 404


# ───────────────────────────────────────────────────────── model catalog


def test_the_catalog_carries_everything_a_picker_needs(client) -> None:
    """Feature 3.2 is 'select only': the catalog is read, never written."""
    payload = client.get("/v1/config/model-catalog").json()
    assert payload["default_alias"]
    assert payload["models"]
    required = {"alias", "display_name", "client_type", "model", "token_limit", "max_tokens", "vision"}
    assert required <= set(payload["models"][0])
    assert payload["default_alias"] in {model["alias"] for model in payload["models"]}


def test_the_selected_alias_reaches_the_backend(client, session, backend) -> None:
    """The whole of feature 3.2: alias in the request, alias at create_agent."""
    catalog = client.get("/v1/config/model-catalog").json()
    alias = catalog["models"][0]["alias"]
    run = client.post(
        f"/v1/sessions/{session['session_id']}/runs", json={"idempotency_key": "k-model"},
    ).json()
    result = client.post(
        f"/v1/runs/{run['run_id']}/execute",
        json={"prompt": "hi", "model_alias": alias},
        params={"wait": True},
    ).json()
    assert result["result"]["model"] == alias


# ───────────────────────────────────────────────────────── speech to text


def test_empty_audio_is_rejected_before_any_provider_call(client) -> None:
    response = client.post(
        "/v1/audio/transcriptions", files={"file": ("clip.webm", b"", "audio/webm")},
    )
    assert response.status_code == 400


def test_stt_resolves_from_the_same_config_as_chat(monkeypatch) -> None:
    """Feature 3.4 must not drag the provider-config surface back in."""
    from drsai.backend.desktop_gateway.routes import audio

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.invalid/apiv2")
    resolved = audio.resolve_stt_operation("whisper-1")
    assert resolved.role == "speech_to_text_model"
    assert resolved.model.provider.base_url == "https://example.invalid/apiv2"
    assert resolved.route_plan.routes[0].protocol == "openai_audio_transcriptions"
    assert audio.stt_available() is True


def test_stt_reports_unavailable_without_credentials(monkeypatch) -> None:
    from drsai.backend.desktop_gateway.routes import audio

    for name in ("OPENAI_API_KEY", "HEPAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(audio, "get_platform_auth", lambda: None)
    monkeypatch.setattr(
        "drsai.backend.cli.config.load_config", lambda *args, **kwargs: {},
    )
    assert audio.stt_available() is False


# ──────────────────────────────────────────────────────────── isolation


def test_v2_home_keeps_state_off_the_legacy_root(tmp_path, monkeypatch) -> None:
    """V2 and the frozen gateway must not write each other's sessions."""
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "legacy"))
    monkeypatch.setenv("DRSAI_DESKTOP_GATEWAY_HOME", str(tmp_path / "v2"))
    _state.reset_state()
    assert _state.state_root() == Path(str(tmp_path / "v2"))
    monkeypatch.delenv("DRSAI_DESKTOP_GATEWAY_HOME")
    _state.reset_state()
    assert _state.state_root() == Path(str(tmp_path / "legacy"))
    _state.reset_state()


# ───────────────────────────────────────────────────────── reference fold


def _replay(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The reducer the renderer has to match: deltas accumulate, completions win."""
    items: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for event in events:
        if event["dedupe_key"] in seen:
            continue
        seen.add(event["dedupe_key"])
        data = event.get("data") or {}
        if event["type"] == "event.item.delta":
            item = items.setdefault(event["item_id"], {"id": event["item_id"], "content": {}})
            delta = data.get("delta") or {}
            if delta.get("kind") == "message.text.append":
                content = item.setdefault("content", {})
                content["text"] = content.get("text", "") + delta.get("text", "")
        elif "item" in data:
            items[data["item"]["id"]] = dict(data["item"])
    return sorted(items.values(), key=lambda item: item.get("sequence", 0))
