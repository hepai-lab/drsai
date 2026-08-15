from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace

import pytest

from drsai.backend.wechat.session_manager import SessionManager
from drsai.backend.wechat.wechat_bot import WeChatBot, WeChatCredentialsExpired
from drsai.backend.wechat.wechat_client import (
    AsyncWeChatAPI, MessageItemType, MessageType, _decrypt_aes_ecb,
    _encrypt_aes_ecb, _image_aes_key, _trusted_cdn_url, split_text,
)


class FakeApi:
    def __init__(self):
        self.sent: list[dict] = []
        self.sent_images: list[bytes] = []

    async def send_text(self, account_id, user_id, context_token, text):
        self.sent.append({"account": account_id, "user": user_id, "context": context_token, "text": text})
        return {"ret": 0}

    async def download_image(self, _item):
        return b"\x89PNG\r\n\x1a\nimage", "image/png"

    async def send_image(self, _account_id, _user_id, _context_token, content):
        self.sent_images.append(content)
        return {"ret": 0}


class FakeModel:
    def __init__(self, events=None):
        self.events = events or [
            {"type": "message.delta", "text": "最终"},
            {"type": "message.delta", "text": "回复"},
            {"type": "message.complete"},
        ]
        self.initialized: list[str] = []

    async def lazy_init(self, *, chat_id, **_kwargs):
        self.initialized.append(chat_id)
        return {"status": True}

    @property
    def drsai(self):
        return self

    async def a_drsai_ui_completions(self, **_kwargs):
        for event in self.events:
            yield "data: " + json.dumps(event, ensure_ascii=False) + "\n"


def message(user: str, text: str, *, message_id: str = "message-1") -> dict:
    return {
        "message_id": message_id,
        "message_type": MessageType.USER,
        "from_user_id": user,
        "context_token": "context-secret",
        "item_list": [{"type": MessageItemType.TEXT, "text_item": {"text": text}}],
    }


def test_session_manager_hashes_provider_users_and_writes_atomic_schema(tmp_path) -> None:
    path = tmp_path / "sessions.json"
    manager = SessionManager(str(path))
    first = manager.new_session("raw-provider-user-a")
    second = manager.new_session("raw-provider-user-b")
    assert first == "wechat_session_1"
    assert second == "wechat_session_2"
    assert manager.list_sessions("raw-provider-user-a") == [first]
    assert manager.switch_session("raw-provider-user-a", second) is False
    persisted = path.read_text(encoding="utf-8")
    assert "raw-provider-user" not in persisted
    assert json.loads(persisted)["schema_version"] == 2
    restored = SessionManager(str(path))
    assert restored.get_current("raw-provider-user-b") == second


def test_split_text_preserves_unicode_order_and_limit() -> None:
    text = "第一段\n" + "中" * 2048 + "\n最后"
    chunks = split_text(text)
    assert chunks
    assert all(0 < len(chunk) <= 2048 for chunk in chunks)
    assert "".join(chunks).replace("\n", "") == text.replace("\n", "")


def test_wechat_api_rejects_untrusted_credential_exfiltration_origin() -> None:
    import pytest
    with pytest.raises(ValueError, match="Unsupported WeChat API origin"):
        AsyncWeChatAPI("secret", "https://attacker.example/collect")
    assert AsyncWeChatAPI("secret", "https://ilinkai.weixin.qq.com").base_url == "https://ilinkai.weixin.qq.com"


def test_wechat_image_crypto_and_cdn_boundary() -> None:
    content = b"\x89PNG\r\n\x1a\nopaque-image-data"
    key = bytes(range(16))
    encrypted = _encrypt_aes_ecb(content, key)
    assert _decrypt_aes_ecb(encrypted, key) == content
    encoded_hex = base64.b64encode(key.hex().encode("ascii")).decode("ascii")
    assert _image_aes_key({}, {"aes_key": encoded_hex}) == key
    trusted = "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=opaque"
    assert _trusted_cdn_url(trusted) == trusted
    with pytest.raises(ValueError, match="Unsupported WeChat CDN URL"):
        _trusted_cdn_url("https://attacker.example/c2c/download?secret=x")


def test_login_does_not_print_raw_provider_identifiers() -> None:
    from pathlib import Path
    import drsai.backend.wechat.wechat_login as login

    source = Path(login.__file__).read_text(encoding="utf-8")
    assert "creds['account_id']" not in source
    assert "creds['user_id']" not in source


def test_wechat_api_native_typing_contract_and_ticket_cache() -> None:
    api = AsyncWeChatAPI("secret")
    calls: list[tuple[str, dict]] = []

    async def fake_post(path, body, timeout=40):
        calls.append((path, body))
        return {"ret": 0, "typing_ticket": "ticket"} if path.endswith("getconfig") else {"ret": 0}

    api._post = fake_post

    async def scenario():
        first = await api.get_typing_ticket("user", "context")
        second = await api.get_typing_ticket("user", "context")
        await api.send_typing("user", first, active=True)
        await api.send_typing("user", first, active=False)
        return first, second

    assert asyncio.run(scenario()) == ("ticket", "ticket")
    assert [path for path, _body in calls] == [
        "ilink/bot/getconfig",
        "ilink/bot/sendtyping",
        "ilink/bot/sendtyping",
    ]
    assert [body.get("status") for _path, body in calls[1:]] == [1, 2]


def test_bot_sends_only_user_visible_final_text_and_keeps_users_isolated(tmp_path) -> None:
    model = FakeModel()
    manager = SessionManager(str(tmp_path / "sessions.json"))
    bot = WeChatBot(model=model, creds={"bot_token": "secret", "account_id": "bot-account"}, api_key="", session_manager=manager)
    api = FakeApi()
    bot.api = api

    async def scenario():
        await bot.handle_message(message("provider-user-a", "你好"))
        await bot.handle_message(message("provider-user-b", "你好", message_id="message-2"))

    asyncio.run(scenario())
    assert [entry["text"] for entry in api.sent] == ["最终回复", "最终回复"]
    assert model.initialized == ["wechat_session_1", "wechat_session_2"]
    assert manager.get_current("provider-user-a") != manager.get_current("provider-user-b")


def test_bot_rejects_cross_user_session_switch_and_disables_unstable_model_commands(tmp_path) -> None:
    manager = SessionManager(str(tmp_path / "sessions.json"))
    owned = manager.new_session("owner-a")
    other = manager.new_session("owner-b")
    bot = WeChatBot(model=FakeModel(), creds={"bot_token": "secret", "account_id": "bot"}, api_key="", session_manager=manager)
    api = FakeApi(); bot.api = api

    async def scenario():
        await bot.handle_message(message("owner-a", f"/session {other}"))
        await bot.handle_message(message("owner-a", "/models", message_id="message-2"))

    asyncio.run(scenario())
    assert manager.get_current("owner-a") == owned
    assert "不属于你" in api.sent[0]["text"]
    assert api.sent[-1]["text"] == "当前微信频道暂不支持切换模型，请在 Desktop 设置中配置默认模型。"
    assert not hasattr(bot.model.drsai, "agent_instance")


def test_bot_replaces_internal_agent_errors_with_stable_user_message(tmp_path) -> None:
    model = FakeModel([{"type": "error", "message": "API_TOKEN=must-not-leak"}])
    bot = WeChatBot(model=model, creds={"bot_token": "secret", "account_id": "bot"}, api_key="", session_manager=SessionManager(str(tmp_path / "sessions.json")))
    api = FakeApi(); bot.api = api
    asyncio.run(bot.handle_message(message("owner", "run")))
    rendered = json.dumps(api.sent, ensure_ascii=False)
    assert "must-not-leak" not in rendered
    assert "Desktop 诊断" in rendered


def test_bot_uses_native_typing_without_sending_placeholder_text(tmp_path) -> None:
    class TypingApi(FakeApi):
        def __init__(self):
            super().__init__()
            self.typing: list[bool] = []

        async def get_typing_ticket(self, user_id, context_token):
            assert user_id == "owner"
            assert context_token == "context-secret"
            return "ticket"

        async def send_typing(self, user_id, ticket, *, active):
            assert user_id == "owner" and ticket == "ticket"
            self.typing.append(active)

    async def delayed_events():
        await asyncio.sleep(0.01)
        yield "data: " + json.dumps({"type": "message.delta", "text": "完成"}, ensure_ascii=False) + "\n"
        yield 'data: {"type": "message.complete"}\n'

    model = FakeModel()
    model.a_drsai_ui_completions = lambda **_kwargs: delayed_events()
    bot = WeChatBot(model=model, creds={"bot_token": "secret", "account_id": "bot"}, api_key="", session_manager=SessionManager(str(tmp_path / "sessions.json")))
    api = TypingApi(); bot.api = api
    asyncio.run(bot.handle_message(message("owner", "hello")))
    assert [entry["text"] for entry in api.sent] == ["完成"]
    assert api.typing == [True, False]


def test_wechat_background_session_has_no_implicit_tool_approval() -> None:
    from drsai.backend.tui_gateway.adapter.callbacks import approval_callback
    assert approval_callback(command="dangerous", description="must fail closed", timeout=0) == "deny"


def test_bot_surfaces_expired_provider_credentials(tmp_path, monkeypatch) -> None:
    class ExpiredApi:
        async def get_updates(self, _sync_buf):
            return {"ret": -14}

    bot = WeChatBot(
        model=FakeModel(),
        creds={"bot_token": "secret", "account_id": "bot"},
        api_key="",
        session_manager=SessionManager(str(tmp_path / "sessions.json")),
    )
    bot.api = ExpiredApi()
    monkeypatch.setattr("drsai.backend.wechat.wechat_client.load_sync_buf", lambda: "")
    with pytest.raises(WeChatCredentialsExpired):
        asyncio.run(bot.run())


def test_runtime_bot_does_not_resend_agent_reply_after_replayed_inbound(tmp_path) -> None:
    from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
    from drsai.backend.wechat.channel_identity import ChannelIdentity
    from drsai.backend.wechat.runtime_session_bridge import WeChatRuntimeSessionBridge

    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-test"),
        lambda workspace_id: workspace_id == "workspace-one",
    )

    class RuntimeAgent:
        def __init__(self):
            self.calls = 0

        async def execute(self, run_id, prompt):
            self.calls += 1
            run = engine.get_run(run_id)
            engine.transition_run(run_id, "running")
            engine.record_conversation_item(
                run["session_id"],
                item_id=f"assistant-{run_id}",
                kind="message",
                role="assistant",
                revision=1,
                source_client="runtime",
                source_message_id=f"assistant:{run_id}",
                run_id=run_id,
                    payload={"text": f"reply:{prompt}", "phase": "final", "status": "completed"},
            )
            engine.transition_run(run_id, "completed")

    service = RuntimeAgent()

    def make_bot():
        bridge = WeChatRuntimeSessionBridge(
            engine=engine,
            agent_service=service,
            workspace_id=lambda: "workspace-one",
            identity=ChannelIdentity(b"x" * 32),
            account_id="raw-account",
        )
        bot = WeChatBot(
            model=None,
            creds={"bot_token": "secret", "account_id": "bot"},
            api_key="",
            session_manager=None,
            runtime_bridge=bridge,
        )
        bot.api = FakeApi()
        return bot

    first_bot = make_bot()
    asyncio.run(first_bot.handle_message(message("raw-user", "hello", message_id="same-message")))
    restarted_bot = make_bot()
    asyncio.run(restarted_bot.handle_message(message("raw-user", "hello", message_id="same-message")))

    assert [entry["text"] for entry in first_bot.api.sent] == ["reply:hello"]
    assert restarted_bot.api.sent == []
    assert service.calls == 1


def test_runtime_bot_forwards_image_input_and_returns_generated_image() -> None:
    class ImageBridge:
        def __init__(self):
            self.received = None

        async def run_turn(self, **kwargs):
            self.received = kwargs
            return SimpleNamespace(
                session_id="session-image",
                run_id="run-image",
                text="图像已生成",
                assistant_item_id="assistant-image",
                images=(SimpleNamespace(content=b"generated-image"),),
            )

        def begin_agent_reply_delivery(self, _turn):
            return {"delivery_id": "delivery-image"}, True

        def complete_outbound(self, _delivery_id, **_kwargs):
            return {"status": "sent"}

    bridge = ImageBridge()
    bot = WeChatBot(
        model=None,
        creds={"bot_token": "secret", "account_id": "bot"},
        api_key="",
        session_manager=None,
        runtime_bridge=bridge,
    )
    api = FakeApi()
    bot.api = api
    inbound = message("image-user", "请描述并生成类似图片")
    inbound["item_list"].append({
        "type": MessageItemType.IMAGE,
        "image_item": {"media": {"encrypt_query_param": "opaque"}},
    })

    asyncio.run(bot.handle_message(inbound))

    assert bridge.received["images"] == [(b"\x89PNG\r\n\x1a\nimage", "image/png")]
    assert bridge.received["text"] == "请描述并生成类似图片"
    assert [entry["text"] for entry in api.sent] == ["图像已生成"]
    assert api.sent_images == [b"generated-image"]


def test_agent_session_adapter_propagates_platform_auth_to_worker_thread() -> None:
    from types import SimpleNamespace
    from drsai.backend.daemon.wechat_adapter import AgentSessionAdapter
    from drsai.platform_auth import PlatformAuthContext, get_platform_auth

    context = PlatformAuthContext(
        access_token="test-token",
        subject="developer-local",
        issuer="https://auth.example",
        expires_at=2_000_000_000,
        model_base_url="https://models.example/v1",
    )

    class FakeSession:
        def run_turn(self, text, on_event):
            assert text == "hello"
            assert get_platform_auth() is context
            on_event("message.delta", {"text": "ok"})
            on_event("message.complete", {})

    adapter = AgentSessionAdapter(
        {"wechat_session_1": {"agent_session": FakeSession()}},
        SimpleNamespace(name="desktop"),
        auth_context_provider=lambda: context,
    )

    async def scenario():
        events = []
        async for line in adapter.a_drsai_ui_completions(
            chat_id="wechat_session_1",
            api_key="",
            messages=[{"type": "TextMessage", "source": "user", "content": "hello"}],
            stream=True,
            user={"email": "local"},
        ):
            events.append(line)
        return events

    rendered = "".join(asyncio.run(scenario()))
    assert '"type": "message.delta"' in rendered
    assert '"type": "TaskResult"' in rendered
