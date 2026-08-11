from __future__ import annotations

import asyncio

import pytest

from drsai.relay.registry import RelayRegistryError
from drsai.relay.runtime_channel import RuntimeChannelHub


class Socket:
    def __init__(self, hub: RuntimeChannelHub, runtime_id: str) -> None:
        self.hub = hub
        self.runtime_id = runtime_id
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)
        self.hub.accept_response(self.runtime_id, {
            "type": "runtime.response",
            "request_id": message["request_id"],
            "ok": True,
            "result": {"operation": message["operation"], "arguments": message["arguments"]},
        })


class HttpSocket:
    def __init__(self, hub: RuntimeChannelHub, runtime_id: str) -> None:
        self.hub = hub
        self.runtime_id = runtime_id
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)
        self.hub.accept_response(self.runtime_id, {
            "type": "response",
            "request_id": message["request_id"],
            "status": 200,
            "body": {"data": []},
        })


def test_runtime_channel_routes_request_and_fails_closed_when_detached() -> None:
    async def scenario() -> None:
        hub = RuntimeChannelHub(request_timeout=0.1)
        socket = Socket(hub, "rt-one")
        generation = await hub.attach("rt-one", socket)  # type: ignore[arg-type]
        result = await hub.request("rt-one", "get_run", {"args": ["run-one"], "kwargs": {}})
        assert result == {"operation": "get_run", "arguments": {"args": ["run-one"], "kwargs": {}}}
        assert socket.sent[0]["type"] == "runtime.request"
        await hub.detach("rt-one", generation)
        with pytest.raises(RelayRegistryError, match="unavailable") as caught:
            await hub.request("rt-one", "get_run", {})
        assert caught.value.retryable is True and caught.value.source == "runtime"

    asyncio.run(scenario())


def test_replacing_runtime_generation_does_not_detach_new_connection() -> None:
    async def scenario() -> None:
        hub = RuntimeChannelHub()
        first = await hub.attach("rt-one", Socket(hub, "rt-one"))  # type: ignore[arg-type]
        second_socket = Socket(hub, "rt-one")
        second = await hub.attach("rt-one", second_socket)  # type: ignore[arg-type]
        await hub.detach("rt-one", first)
        assert await hub.request("rt-one", "identity", {}) == {"operation": "identity", "arguments": {}}
        await hub.detach("rt-one", second)

    asyncio.run(scenario())


def test_runtime_channel_routes_http_request_over_current_generation() -> None:
    async def scenario() -> None:
        hub = RuntimeChannelHub(request_timeout=0.1)
        socket = HttpSocket(hub, "rt-one")
        generation = await hub.attach("rt-one", socket)  # type: ignore[arg-type]
        response, response_generation = await hub.request_http_current(
            "rt-one",
            "GET",
            "/v1/workspaces?include_closed=true",
            timeout_code="catalog_sync_timeout",
        )
        assert response == {"type": "response", "request_id": socket.sent[0]["request_id"], "status": 200,
                            "body": {"data": []}}
        assert response_generation == generation
        assert socket.sent[0]["type"] == "request"
        assert socket.sent[0]["method"] == "GET"
        assert socket.sent[0]["path"] == "/v1/workspaces?include_closed=true"

    asyncio.run(scenario())
