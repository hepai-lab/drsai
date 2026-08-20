"""Bridge WeChat turns into the authoritative Runtime Session journal."""

from __future__ import annotations

import asyncio
from contextlib import nullcontext
from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable
from weakref import WeakValueDictionary

from drsai.platform_auth import PlatformAuthContext, platform_auth_scope

from .channel_identity import ChannelIdentity


@dataclass(frozen=True)
class WeChatRuntimeImage:
    content: bytes
    mime_type: str
    artifact_id: str


@dataclass(frozen=True)
class WeChatRuntimeTurn:
    session_id: str
    run_id: str
    text: str
    assistant_item_id: str
    images: tuple[WeChatRuntimeImage, ...]
    created_session: bool
    created_run: bool


class _WeChatPlainTextParser(HTMLParser):
    """Render a bounded HTML fragment as plain WeChat text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.ignored_depth += 1
            return
        if self.ignored_depth:
            return
        if tag in {"br", "p", "div", "li"}:
            self.parts.append("\n")
        if tag == "span":
            classes = dict(attrs).get("class") or ""
            match = re.search(r"(?:^|\s)emoji([0-9a-fA-F]{4,6})(?:\s|$)", classes)
            if match:
                try:
                    self.parts.append(chr(int(match.group(1), 16)))
                except ValueError:
                    pass

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.ignored_depth:
            self.ignored_depth -= 1
        elif not self.ignored_depth and tag in {"p", "div", "li"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)


_INTERNAL_PROCESS = re.compile(
    r"^(?:analysis|reasoning|thoughts?)\s*:|^(?:the user|user) (?:said|asked|wants)|"
    r"^(?:let me|we need to|i (?:should|need to|will now)|the assistant should)\b",
    re.IGNORECASE,
)


def _wechat_final_text(value: str) -> str:
    """Project a final OAEP message to safe, plain external-channel text."""
    without_thinking = re.sub(r"<think\b[^>]*>.*?</think\s*>", "", value, flags=re.I | re.S)
    without_thinking = re.split(r"<think\b[^>]*>", without_thinking, maxsplit=1, flags=re.I)[0]
    parser = _WeChatPlainTextParser()
    parser.feed(without_thinking[:100_000])
    parser.close()
    plain = "".join(parser.parts).replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [re.sub(r"[ \t]+", " ", part).strip() for part in re.split(r"\n\s*\n", plain)]
    external: list[str] = []
    for paragraph in paragraphs:
        if not paragraph:
            continue
        if _INTERNAL_PROCESS.search(paragraph):
            break
        external.append(paragraph)
    return "\n\n".join(external).strip()[:20_000]


class WeChatRuntimeSessionBridge:
    """Runtime-specific orchestration with no provider identifiers at rest."""

    def __init__(
        self,
        *,
        engine: Any,
        agent_service: Any,
        workspace_id: Callable[[], str],
        workspace_path: Callable[[], Path] | None = None,
        identity: ChannelIdentity,
        account_id: str,
        auth_context_provider: Callable[[], PlatformAuthContext | None] | None = None,
        agent_definition: str = "opendrsai@1",
        backend_id: str = "opendrsai",
    ) -> None:
        self.engine = engine
        self.agent_service = agent_service
        self.workspace_id = workspace_id
        self.workspace_path = workspace_path
        self.identity = identity
        self.account_fingerprint = identity.account_fingerprint(account_id)
        self.auth_context_provider = auth_context_provider or (lambda: None)
        self.agent_definition = agent_definition
        self.backend_id = backend_id
        self._session_routes: dict[str, str] = {}
        self._turn_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()

    async def run_turn(
        self,
        *,
        provider_user_id: str,
        message_id: str,
        text: str,
        images: list[tuple[bytes, str]] | None = None,
    ) -> WeChatRuntimeTurn:
        provider_user_key = self.identity.provider_user_key(provider_user_id)
        lock = self._turn_locks.get(provider_user_key)
        if lock is None:
            lock = asyncio.Lock()
            self._turn_locks[provider_user_key] = lock
        async with lock:
            return await self._run_turn_locked(
                provider_user_id=provider_user_id,
                message_id=message_id,
                text=text,
                images=images,
            )

    async def _run_turn_locked(
        self,
        *,
        provider_user_id: str,
        message_id: str,
        text: str,
        images: list[tuple[bytes, str]] | None = None,
    ) -> WeChatRuntimeTurn:
        normalized_message_id = str(message_id).strip()
        if not normalized_message_id:
            raise ValueError("WeChat message_id is required for durable idempotency")
        provider_user_key = self.identity.provider_user_key(provider_user_id)
        session, created_session = self.engine.resolve_or_create_channel_session(
            self.workspace_id(),
            provider="wechat",
            account_fingerprint=self.account_fingerprint,
            provider_user_key=provider_user_key,
            title_prefix="微信会话",
        )
        self._session_routes[str(session["session_id"])] = provider_user_id
        idempotency_digest = hashlib.sha256(
            f"wechat\0{self.account_fingerprint}\0{normalized_message_id}".encode("utf-8")
        ).hexdigest()
        run, created_run = self.engine.create_run(
            str(session["session_id"]),
            self.agent_definition,
            f"wechat:{idempotency_digest}",
            self.backend_id,
        )
        source_message_id = f"wechat:{idempotency_digest}"
        input_resources, attachment_refs = self._stage_images(
            idempotency_digest, images or []
        )
        self.engine.set_run_input(
            str(run["run_id"]),
            text,
            attachment_refs=attachment_refs,
            input_resources=input_resources,
            source_client="wechat",
            source_message_id=source_message_id,
        )

        status = str(self.engine.get_run(str(run["run_id"]))["status"])
        if status in {"queued", "running"}:
            auth_context = self.auth_context_provider()
            with platform_auth_scope(auth_context) if auth_context is not None else nullcontext():
                await self.agent_service.execute(str(run["run_id"]), text)
        elif status not in {"completed"}:
            raise RuntimeError(f"WeChat Runtime Run is not reusable: {status}")

        answer, assistant_item_id, output_images = self._assistant_output(
            str(session["session_id"]), str(run["run_id"])
        )
        if not answer and not output_images:
            raise RuntimeError("WeChat Runtime Run completed without an assistant result")
        return WeChatRuntimeTurn(
            session_id=str(session["session_id"]),
            run_id=str(run["run_id"]),
            text=answer,
            assistant_item_id=assistant_item_id,
            images=output_images,
            created_session=created_session,
            created_run=created_run,
        )

    def new_session(self, provider_user_id: str) -> dict[str, Any]:
        current, _ = self._resolve(provider_user_id)
        origin = current.get("origin") or {}
        rotated = self.engine.rotate_channel_session(
            str(origin.get("binding_id") or ""), title_prefix="微信会话"
        )
        self._session_routes[str(rotated["session_id"])] = provider_user_id
        return rotated

    def list_sessions(self, provider_user_id: str) -> tuple[list[dict[str, Any]], str]:
        current, _ = self._resolve(provider_user_id)
        origin = current.get("origin") or {}
        return (
            self.engine.list_channel_sessions(str(origin.get("binding_id") or "")),
            str(current["session_id"]),
        )

    def switch_session(self, provider_user_id: str, session_id: str) -> dict[str, Any]:
        current, _ = self._resolve(provider_user_id)
        origin = current.get("origin") or {}
        selected = self.engine.activate_channel_session(
            str(origin.get("binding_id") or ""), session_id
        )
        self._session_routes[str(selected["session_id"])] = provider_user_id
        return selected

    def _resolve(self, provider_user_id: str) -> tuple[dict[str, Any], bool]:
        result = self.engine.resolve_or_create_channel_session(
            self.workspace_id(),
            provider="wechat",
            account_fingerprint=self.account_fingerprint,
            provider_user_key=self.identity.provider_user_key(provider_user_id),
            title_prefix="微信会话",
        )
        self._session_routes[str(result[0]["session_id"])] = provider_user_id
        return result

    def provider_user_for_session(self, session_id: str) -> str | None:
        return self._session_routes.get(session_id)

    def begin_outbound(
        self, session_id: str, *, idempotency_key: str, text: str
    ) -> tuple[dict[str, Any], bool]:
        return self.engine.begin_channel_delivery(
            session_id, provider="wechat", idempotency_key=idempotency_key, text=text
        )

    def complete_outbound(
        self, delivery_id: str, *, status: str, error_code: str | None = None
    ) -> dict[str, Any]:
        return self.engine.complete_channel_delivery(
            delivery_id, status=status, error_code=error_code
        )

    def _assistant_output(
        self, session_id: str, run_id: str
    ) -> tuple[str, str, tuple[WeChatRuntimeImage, ...]]:
        snapshot = self.engine.conversation_snapshot(session_id)
        parts: list[str] = []
        item_ids: list[str] = []
        images: list[WeChatRuntimeImage] = []
        for item in snapshot.get("items") or []:
            if str(item.get("run_id") or "") != run_id:
                continue
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            if (
                item.get("kind") == "message"
                and item.get("role") == "assistant"
                and payload.get("phase") in {None, "final"}
                and payload.get("status") == "completed"
            ):
                text = payload.get("text") or payload.get("content")
                if isinstance(text, str) and text.strip():
                    external_text = _wechat_final_text(text)
                    if external_text:
                        parts.append(external_text)
                        item_ids.append(str(item["item_id"]))
            elif item.get("kind") == "artifact" and len(images) < 4:
                image = self._artifact_image(payload)
                if image is not None:
                    images.append(image)
        return (
            "\n\n".join(parts).strip(),
            item_ids[-1] if item_ids else "",
            tuple(images),
        )

    def begin_agent_reply_delivery(self, turn: WeChatRuntimeTurn) -> tuple[dict[str, Any], bool]:
        item_id = turn.assistant_item_id or (
            f"artifact:{turn.images[0].artifact_id}" if turn.images else ""
        )
        delivery_identity = turn.text or (
            "[image artifacts: " + ",".join(image.artifact_id for image in turn.images) + "]"
        )
        return self.engine.begin_existing_item_channel_delivery(
            turn.session_id,
            item_id=item_id,
            provider="wechat",
            idempotency_key=f"wechat-agent-reply:{turn.run_id}",
            text=delivery_identity,
        )

    def _stage_images(
        self, message_digest: str, images: list[tuple[bytes, str]]
    ) -> tuple[list[dict[str, Any]], list[str]]:
        if not images:
            return [], []
        if self.workspace_path is None:
            raise RuntimeError("WeChat image workspace is unavailable")
        if len(images) > 4:
            raise ValueError("WeChat messages support at most four images")
        root = self.workspace_path().resolve(strict=True)
        directory = root / ".opendrsai" / "channel-inputs" / "wechat"
        directory.mkdir(parents=True, exist_ok=True)
        resources: list[dict[str, Any]] = []
        refs: list[str] = []
        suffixes = {
            "image/png": ".png", "image/jpeg": ".jpg",
            "image/gif": ".gif", "image/webp": ".webp",
        }
        for index, (content, mime_type) in enumerate(images):
            suffix = suffixes.get(mime_type)
            if suffix is None or not content or len(content) > 20 * 1024 * 1024:
                raise ValueError("WeChat image is unsupported")
            digest = hashlib.sha256(content).hexdigest()
            name = f"{message_digest[:24]}-{index}-{digest[:16]}{suffix}"
            target = directory / name
            if target.exists():
                if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                    raise RuntimeError("WeChat staged image integrity conflict")
            else:
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=".wechat-image-", suffix=".tmp", dir=directory
                )
                try:
                    with os.fdopen(descriptor, "wb") as stream:
                        stream.write(content)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary_name, target)
                finally:
                    try:
                        os.unlink(temporary_name)
                    except FileNotFoundError:
                        pass
            relative = target.relative_to(root).as_posix()
            resource_id = f"wechat-image-{message_digest[:24]}-{index}"
            resources.append({
                "protocol": "oaep.input/1",
                "resource_id": resource_id,
                "kind": "file",
                "name": f"微信图片 {index + 1}",
                "reference": relative,
                "mime": mime_type,
                "size_bytes": len(content),
                "sha256": digest,
                "permission": "read",
                "status": "encoded",
            })
            refs.append(relative)
        return resources, refs

    def _artifact_image(self, payload: dict[str, Any]) -> WeChatRuntimeImage | None:
        if self.workspace_path is None:
            return None
        mime = str(payload.get("mime_type") or payload.get("mime") or "")
        if mime not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
            return None
        reference = str(
            payload.get("relative_path") or payload.get("path") or payload.get("reference") or ""
        ).replace("\\", "/")
        if not reference:
            return None
        root = self.workspace_path().resolve(strict=True)
        try:
            target = (root / reference).resolve(strict=True)
            target.relative_to(root)
        except (OSError, ValueError):
            return None
        if not target.is_file() or target.stat().st_size > 20 * 1024 * 1024:
            return None
        content = target.read_bytes()
        expected = str(payload.get("sha256") or "")
        if expected and hashlib.sha256(content).hexdigest() != expected:
            return None
        return WeChatRuntimeImage(
            content=content,
            mime_type=mime,
            artifact_id=str(payload.get("artifact_id") or payload.get("id") or target.name),
        )
