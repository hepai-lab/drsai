from pathlib import Path
import asyncio
import base64
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.wechat.channel_identity import ChannelIdentity
from drsai.backend.wechat.runtime_session_bridge import WeChatRuntimeSessionBridge


class FakeAgentService:
    def __init__(self, engine: RuntimeEngine):
        self.engine = engine
        self.calls = 0

    async def execute(self, run_id: str, prompt: str):
        self.calls += 1
        run = self.engine.get_run(run_id)
        self.engine.transition_run(run_id, "running")
        self.engine.record_conversation_item(
            str(run["session_id"]),
            item_id=f"assistant-{run_id}",
            kind="message",
            role="assistant",
            revision=1,
            source_client="runtime",
            source_message_id=f"assistant:{run_id}",
            run_id=run_id,
            payload={"content": f"reply:{prompt}", "phase": "final", "status": "completed"},
        )
        self.engine.transition_run(run_id, "completed")
        return {"result": {"content": f"reply:{prompt}"}}


@pytest.fixture()
def bridge(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-test"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    service = FakeAgentService(engine)
    value = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=service,
        workspace_id=lambda: "workspace-one",
        workspace_path=lambda: tmp_path,
        identity=ChannelIdentity(b"x" * 32),
        account_id="raw-account",
    )
    return value, engine, service


@pytest.mark.asyncio
async def test_first_turn_creates_one_visible_runtime_history_and_deduplicates(bridge) -> None:
    value, engine, service = bridge
    first = await value.run_turn(
        provider_user_id="raw-user", message_id="message-1", text="hello"
    )
    repeated = await value.run_turn(
        provider_user_id="raw-user", message_id="message-1", text="hello"
    )

    assert first.session_id == repeated.session_id
    assert first.run_id == repeated.run_id
    assert first.created_session is True
    assert repeated.created_session is False
    assert repeated.created_run is False
    assert service.calls == 1
    assert repeated.text == "reply:hello"
    snapshot = engine.conversation_snapshot(first.session_id)
    assert [(item["role"], item["source_client"]) for item in snapshot["items"]] == [
        ("user", "wechat"),
        ("assistant", "runtime"),
    ]
    serialized = repr(snapshot) + repr(engine.get_session(first.session_id))
    assert "raw-user" not in serialized
    assert "raw-account" not in serialized


@pytest.mark.asyncio
async def test_contacts_are_isolated_and_newsession_rotates_runtime_session(bridge) -> None:
    value, engine, _service = bridge
    first = await value.run_turn(
        provider_user_id="user-one", message_id="one", text="first"
    )
    second = await value.run_turn(
        provider_user_id="user-two", message_id="two", text="second"
    )
    rotated = value.new_session("user-one")

    assert first.session_id != second.session_id != rotated["session_id"]
    assert engine.get_session(first.session_id)["title"] == "微信会话 1"
    assert engine.get_session(second.session_id)["title"] == "微信会话 2"
    assert rotated["title"] == "微信会话 3"


@pytest.mark.asyncio
async def test_same_contact_turns_are_serialized_before_creating_the_next_run(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-test"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    first_started = asyncio.Event()
    release_first = asyncio.Event()

    class BlockingAgent(FakeAgentService):
        async def execute(self, run_id: str, prompt: str):
            if self.calls == 0:
                first_started.set()
                await release_first.wait()
            return await super().execute(run_id, prompt)

    service = BlockingAgent(engine)
    value = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=service,
        workspace_id=lambda: "workspace-one",
        workspace_path=lambda: tmp_path,
        identity=ChannelIdentity(b"x" * 32),
        account_id="raw-account",
    )
    first = asyncio.create_task(value.run_turn(
        provider_user_id="same-user", message_id="concurrent-1", text="first",
    ))
    await first_started.wait()
    second = asyncio.create_task(value.run_turn(
        provider_user_id="same-user", message_id="concurrent-2", text="second",
    ))
    await asyncio.sleep(0)

    assert service.calls == 0
    assert not second.done()
    release_first.set()
    first_turn, second_turn = await asyncio.gather(first, second)

    assert service.calls == 2
    assert first_turn.session_id == second_turn.session_id
    assert first_turn.run_id != second_turn.run_id
    assert second_turn.text == "reply:second"


@pytest.mark.asyncio
async def test_wechat_exports_only_completed_final_plain_text(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-test"),
        lambda workspace_id: workspace_id == "workspace-one",
    )

    class LeakyAgent:
        async def execute(self, run_id: str, _prompt: str):
            run = engine.get_run(run_id)
            engine.transition_run(run_id, "running")
            for item_id, kind, payload in (
                ("reasoning", "reasoning", {"text": "private chain of thought", "visibility": "diagnostic"}),
                ("commentary", "message", {"text": "working...", "phase": "commentary", "status": "completed"}),
                ("final", "message", {
                    "text": (
                        '你好！<span class="emoji emoji1f44b"></span> 有什么我可以帮你的吗？'
                        '<br/><br/>The user said "hlll". Let me respond in a friendly manner.'
                    ),
                    "phase": "final",
                    "status": "completed",
                }),
            ):
                engine.record_conversation_item(
                    run["session_id"], item_id=f"{item_id}-{run_id}", kind=kind,
                    role="assistant", revision=1, source_client="runtime",
                    source_message_id=f"{item_id}:{run_id}", run_id=run_id, payload=payload,
                )
            engine.transition_run(run_id, "completed")

    value = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=LeakyAgent(),
        workspace_id=lambda: "workspace-one",
        workspace_path=lambda: tmp_path,
        identity=ChannelIdentity(b"x" * 32),
        account_id="raw-account",
    )
    turn = await value.run_turn(
        provider_user_id="raw-user", message_id="safe-projection", text="hlll",
    )

    assert turn.text == "你好！👋 有什么我可以帮你的吗？"
    assert "private" not in turn.text and "working" not in turn.text
    assert "The user" not in turn.text and "<span" not in turn.text


@pytest.mark.asyncio
async def test_explicit_outbound_uses_only_an_in_memory_session_route(bridge) -> None:
    value, engine, _service = bridge
    inbound = await value.run_turn(
        provider_user_id="raw-user", message_id="inbound", text="hello"
    )
    assert value.provider_user_for_session(inbound.session_id) == "raw-user"
    delivery, created = value.begin_outbound(
        inbound.session_id, idempotency_key="explicit-outbound-1", text="desktop reply"
    )
    assert created is True
    completed = value.complete_outbound(delivery["delivery_id"], status="sent")
    assert completed["status"] == "sent"
    with engine._connect() as db:
        persisted = repr(db.execute("SELECT * FROM runtime_channel_deliveries").fetchall())
    assert "raw-user" not in persisted


@pytest.mark.asyncio
async def test_agent_reply_delivery_is_durable_and_replay_safe(bridge) -> None:
    value, engine, service = bridge
    first = await value.run_turn(
        provider_user_id="raw-user", message_id="durable-message", text="hello"
    )

    delivery, created = value.begin_agent_reply_delivery(first)
    assert created is True
    assert delivery["item_id"] == first.assistant_item_id
    assert value.complete_outbound(delivery["delivery_id"], status="sent")["status"] == "sent"

    # Simulate a restarted Bot/bridge. The provider identifier is intentionally
    # recovered only from the new inbound message, never from persistent state.
    restarted = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=service,
        workspace_id=lambda: "workspace-one",
        identity=ChannelIdentity(b"x" * 32),
        account_id="raw-account",
    )
    replay = await restarted.run_turn(
        provider_user_id="raw-user", message_id="durable-message", text="hello"
    )
    repeated, repeated_created = restarted.begin_agent_reply_delivery(replay)

    assert repeated_created is False
    assert repeated["delivery_id"] == delivery["delivery_id"]
    assert repeated["status"] == "sent"
    assert service.calls == 1
    snapshot = engine.conversation_snapshot(first.session_id)
    assert [(item["role"], item["source_client"]) for item in snapshot["items"]] == [
        ("user", "wechat"),
        ("assistant", "runtime"),
    ]
    # The terminal Agent item remains immutable; delivery state is stored in
    # the dedicated durable delivery record instead of rewriting its content.
    assert "channel_delivery" not in snapshot["items"][-1]["payload"]


@pytest.mark.asyncio
async def test_agent_reply_delivery_rejects_idempotency_identity_conflict(bridge) -> None:
    value, _engine, _service = bridge
    turn = await value.run_turn(
        provider_user_id="raw-user", message_id="conflict-message", text="hello"
    )
    value.begin_agent_reply_delivery(turn)

    conflicting = type(turn)(
        session_id=turn.session_id,
        run_id=turn.run_id,
        text="different reply",
        assistant_item_id=turn.assistant_item_id,
        images=(),
        created_session=False,
        created_run=False,
    )
    with pytest.raises(ValueError, match="identity conflict"):
        value.begin_agent_reply_delivery(conflicting)


@pytest.mark.asyncio
async def test_image_input_is_staged_as_one_runtime_resource_without_provider_secrets(bridge) -> None:
    value, engine, _service = bridge
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    turn = await value.run_turn(
        provider_user_id="raw-image-user",
        message_id="image-message",
        text="describe this",
        images=[(png, "image/png")],
    )
    run = engine.get_run(turn.run_id)
    assert len(run["input_resources"]) == 1
    resource = run["input_resources"][0]
    assert resource["mime"] == "image/png"
    assert resource["reference"].startswith(".opendrsai/channel-inputs/wechat/")
    assert Path(value.workspace_path(), resource["reference"]).read_bytes() == png
    snapshot = engine.conversation_snapshot(turn.session_id)
    assert snapshot["items"][0]["payload"]["attachment_refs"] == [resource["reference"]]
    rendered = repr(run) + repr(snapshot)
    assert "raw-image-user" not in rendered
    assert "encrypt_query_param" not in rendered
    assert "aes_key" not in rendered


@pytest.mark.asyncio
async def test_generated_image_artifact_is_returned_for_wechat_delivery(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-test"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    artifact_path = tmp_path / "artifacts" / "generated.png"
    artifact_path.parent.mkdir()
    artifact_path.write_bytes(png)

    class ImageAgent:
        async def execute(self, run_id: str, _prompt: str):
            run = engine.get_run(run_id)
            engine.transition_run(run_id, "running")
            engine.record_conversation_item(
                run["session_id"],
                item_id="artifact:image-generated",
                kind="artifact",
                role=None,
                revision=1,
                source_client="runtime",
                source_message_id="artifact:image-generated",
                run_id=run_id,
                payload={
                    "artifact_id": "image-generated",
                    "relative_path": "artifacts/generated.png",
                    "mime_type": "image/png",
                    "sha256": __import__("hashlib").sha256(png).hexdigest(),
                },
            )
            engine.transition_run(run_id, "completed")

    value = WeChatRuntimeSessionBridge(
        engine=engine,
        agent_service=ImageAgent(),
        workspace_id=lambda: "workspace-one",
        workspace_path=lambda: tmp_path,
        identity=ChannelIdentity(b"x" * 32),
        account_id="raw-account",
    )
    turn = await value.run_turn(
        provider_user_id="raw-user", message_id="generate-image", text="generate"
    )
    assert turn.text == ""
    assert len(turn.images) == 1
    assert turn.images[0].content == png
    delivery, created = value.begin_agent_reply_delivery(turn)
    assert created is True
    assert delivery["item_id"] == "artifact:image-generated"
