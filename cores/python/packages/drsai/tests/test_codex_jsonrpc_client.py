from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess, CodexRestartPolicy
from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, CodexBinaryProvider
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient
from drsai.backend.codex_adapter.models import CodexModelCatalog


@pytest.fixture
def anyio_backend():
    return "asyncio"


SERVER = r'''
import json,sys,time
pending=[]
asking={}
def send(value, split=False):
    data=json.dumps(value,separators=(',',':'))+'\n'
    if split:
        midpoint=len(data)//2
        sys.stdout.write(data[:midpoint]); sys.stdout.flush(); time.sleep(.01); sys.stdout.write(data[midpoint:]); sys.stdout.flush()
    else:
        sys.stdout.write(data); sys.stdout.flush()
for line in sys.stdin:
    message=json.loads(line)
    method=message.get('method')
    identity=message.get('id')
    if method=='initialize': send({'id':identity,'result':{'capabilities':{'stable':True}}}, True)
    elif method=='initialized': pass
    elif method=='echo': send({'id':identity,'result':message.get('params')})
    elif method=='model/list': send({'id':identity,'result':{'data':[
        {'id':'gpt-5.4','displayName':'GPT-5.4','isDefault':True,'hidden':False,
         'supportedReasoningEfforts':['medium','high'],'inputModalities':['text','image']}
    ]}})
    elif method=='large': send({'id':identity,'result':{'value':'x' * 200000}})
    elif method=='batch':
        pending.append((identity,message.get('params')))
        if len(pending)==100:
            for item,payload in reversed(pending): send({'id':item,'result':payload})
    elif method=='emit':
        send({'method':'item/agentMessage/delta','params':{'threadId':'thread-a','turnId':'turn-a','delta':'A'}})
        send({'method':'item/agentMessage/delta','params':{'threadId':'thread-b','turnId':'turn-b','delta':'B'}})
        send({'method':'future/unknown','params':{'threadId':'thread-a','secret':'must-not-be-saved'}})
        send({'id':identity,'result':{'emitted':True}})
    elif method=='emit_many':
        for index in reversed(range(10)):
            send({'method':'turn/completed','params':{'threadId':f'thread-{index}','turn':{'id':f'turn-{index}','status':'completed'}}})
        send({'id':identity,'result':{'emitted':10}})
    elif method=='ask':
        asking[900]=identity
        send({'id':900,'method':'approval/request','params':{'reason':'test'}})
    elif method=='ask_unknown':
        asking[901]=identity
        send({'id':901,'method':'future/serverRequest','params':{}})
    elif method=='never': pass
    elif method=='invalid': sys.stdout.write('{bad json}\n'); sys.stdout.flush()
    elif method=='exit': sys.exit(23)
    elif identity in asking:
        original=asking.pop(identity)
        send({'id':original,'result':{'server_response':message}})
'''


def _client(tmp_path: Path, code: str = SERVER, *, timeout: float = 2) -> tuple[CodexJSONRPCClient, CodexAppServerProcess]:
    store = CodexArtifactStore(tmp_path / "managed", {})
    provider = CodexBinaryProvider(store, mode="development", environ={"CODEX_BIN": sys.executable})
    supervisor = CodexAppServerProcess(
        provider, verify_binary=False, arguments=("-u", "-c", code),
        policy=CodexRestartPolicy(base_delay=0, max_delay=0, startup_grace=0.02),
    )
    return CodexJSONRPCClient(supervisor, request_timeout=timeout), supervisor


@pytest.mark.anyio
async def test_initialize_jsonl_framing_concurrent_out_of_order_and_timeout(tmp_path: Path):
    client, _ = _client(tmp_path, timeout=0.15)
    try:
        with pytest.raises(RuntimeExecutionError) as caught:
            await client.request("echo", {"early": True})
        assert caught.value.code == "codex_not_initialized"
        initialized = await client.connect()
        assert initialized["capabilities"]["stable"] is True
        with pytest.raises(RuntimeExecutionError) as caught:
            await client.request("initialize", {})
        assert caught.value.code == "codex_initialize_duplicate"

        tasks = [client.request("batch", {"index": index}, timeout=5) for index in range(100)]
        results = await asyncio.gather(*tasks)
        assert [result["index"] for result in results] == list(range(100))

        never = asyncio.create_task(client.request("never", {}, timeout=0.05))
        echo = await client.request("echo", {"still": "works"})
        assert echo == {"still": "works"}
        with pytest.raises(RuntimeExecutionError) as caught:
            await never
        assert caught.value.code == "codex_request_timeout"
        assert await client.request("echo", {"after": "timeout"}) == {"after": "timeout"}
        assert len((await client.request("large"))["value"]) == 200000
    finally:
        await client.close()


@pytest.mark.anyio
async def test_notifications_route_by_thread_turn_and_unknown_is_safe_summary(tmp_path: Path):
    client, _ = _client(tmp_path)
    received_a, received_b, all_delta = [], [], []
    client.on_route(received_a.append, thread_id="thread-a", turn_id="turn-a")
    client.on_route(received_b.append, thread_id="thread-b", turn_id="turn-b")
    client.on_notification("item/agentMessage/delta", all_delta.append)
    try:
        await client.connect()
        assert await client.request("emit") == {"emitted": True}
        assert [item["params"]["delta"] for item in received_a] == ["A"]
        assert [item["params"]["delta"] for item in received_b] == ["B"]
        assert [item["params"]["delta"] for item in all_delta] == ["A", "B"]
        unknown = next(item for item in client.unknown_notifications if item["method"] == "future/unknown")
        assert unknown["params"] == {"threadId": "thread-a"}
        assert "must-not-be-saved" not in json.dumps(client.unknown_notifications)
    finally:
        await client.close()


@pytest.mark.anyio
async def test_server_requests_always_receive_result_or_method_not_found(tmp_path: Path):
    client, _ = _client(tmp_path)
    client.handle_server_request("approval/request", lambda message: {"decision": "decline", "request": message["id"]})
    try:
        await client.connect()
        handled = await client.request("ask")
        assert handled["server_response"]["result"] == {"decision": "decline", "request": 900}
        unknown = await client.request("ask_unknown")
        assert unknown["server_response"]["error"]["code"] == -32601
    finally:
        await client.close()


@pytest.mark.anyio
async def test_invalid_json_and_eof_fail_all_pending_without_hanging(tmp_path: Path):
    for method, expected in (("invalid", "codex_json_invalid"), ("exit", "codex_connection_eof")):
        client, _ = _client(tmp_path / method)
        try:
            await client.connect()
            pending = asyncio.create_task(client.request("never", {}, timeout=5))
            trigger = asyncio.create_task(client.request(method, {}, timeout=5))
            results = await asyncio.gather(pending, trigger, return_exceptions=True)
            assert all(isinstance(result, RuntimeExecutionError) for result in results)
            assert any(result.code == expected for result in results)
            assert not client._pending
        finally:
            await client.close()


@pytest.mark.anyio
async def test_experimental_api_is_rejected(tmp_path: Path):
    code = r'''
import json,sys
for line in sys.stdin:
    message=json.loads(line)
    if message.get('method')=='initialize':
        print(json.dumps({'id':message['id'],'result':{'experimentalApi':True}}),flush=True)
'''
    client, _ = _client(tmp_path, code)
    with pytest.raises(RuntimeExecutionError) as caught:
        await client.connect()
    assert caught.value.code == "codex_experimental_api_rejected"
    await client.close()


@pytest.mark.anyio
async def test_model_list_requires_explicit_compatible_selection(tmp_path: Path):
    client, _ = _client(tmp_path)
    try:
        await client.connect()
        catalog = CodexModelCatalog(client)
        models = await catalog.refresh()
        assert list(models) == ["gpt-5.4"]
        selected = catalog.select("gpt-5.4")
        assert selected.reasoning_efforts == ("medium", "high")
        assert selected.input_modalities == ("text", "image")
        with pytest.raises(RuntimeExecutionError) as caught:
            catalog.select("gpt-5.6-sol")
        assert caught.value.code == "codex_model_incompatible"
        assert caught.value.detail["requested_model"] == "gpt-5.6-sol"
        assert caught.value.detail["server_defaults"] == ["gpt-5.4"]
        with pytest.raises(RuntimeExecutionError) as caught:
            catalog.select("")
        assert caught.value.code == "codex_model_required"
    finally:
        await client.close()


@pytest.mark.anyio
async def test_ten_workspace_thread_routes_share_one_process_without_crossline(tmp_path: Path):
    client, supervisor = _client(tmp_path)
    routed: list[list[str]] = [[] for _ in range(10)]
    for index in range(10):
        client.on_route(
            lambda message, index=index: routed[index].append(message["params"]["turn"]["id"]),
            thread_id=f"thread-{index}", turn_id=f"turn-{index}",
        )
    try:
        await client.connect()
        await asyncio.gather(*(client.request("echo", {"workspace": index}) for index in range(10)))
        assert await client.request("emit_many") == {"emitted": 10}
        assert routed == [[f"turn-{index}"] for index in range(10)]
        assert supervisor.start_count == 1
    finally:
        await client.close()


@pytest.mark.anyio
async def test_reconnect_rotates_generation_and_ignores_old_messages(tmp_path: Path):
    client, supervisor = _client(tmp_path)
    routed: list[dict] = []
    client.on_route(routed.append, thread_id="new-thread", turn_id="new-turn")
    try:
        await client.connect()
        old_generation = client._generation
        with pytest.raises(RuntimeExecutionError) as caught:
            await client.request("exit", {}, timeout=5)
        assert caught.value.code == "codex_connection_eof"
        await client.connect()
        assert client._generation > old_generation
        assert supervisor.start_count == 2
        await client._handle_message({
            "method": "turn/completed",
            "params": {"threadId": "new-thread", "turn": {"id": "new-turn"}},
        }, old_generation)
        assert routed == []
        assert await client.request("echo", {"generation": "new"}) == {"generation": "new"}
    finally:
        await client.close()


@pytest.mark.anyio
async def test_one_hundred_controlled_reconnects_all_restore_jsonrpc_service(tmp_path: Path):
    client, supervisor = _client(tmp_path, timeout=5)
    try:
        await client.connect()
        generations = []
        for index in range(100):
            await client.reconnect()
            result = await client.request("echo", {"reconnect": index})
            assert result == {"reconnect": index}
            generations.append(client._generation)
        assert len(set(generations)) == 100
        assert supervisor.start_count == 101
        assert not client._pending
    finally:
        await client.close()
