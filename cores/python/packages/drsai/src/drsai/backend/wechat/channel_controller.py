"""Lifecycle controller for the single Runtime-owned WeChat polling task."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from .auth_service import WeChatAuthService

BotRunner = Callable[[dict[str, Any]], Awaitable[None]]


class WeChatChannelController:
    def __init__(self, auth: WeChatAuthService, runner: BotRunner, preference_path: str | Path | None = None) -> None:
        self.auth = auth
        self.runner = runner
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._last_error: str | None = None
        self._started_at: str | None = None
        self._preference_path = Path(preference_path) if preference_path else auth.credentials_path.with_name("channel.json")

    async def status(self) -> dict[str, Any]:
        auth_status = await self.auth.status()
        task = self._task
        running = task is not None and not task.done()
        if task is not None and task.done() and not task.cancelled():
            try:
                task.result()
            except Exception as error:
                self._last_error = (
                    "wechat_credentials_expired"
                    if error.__class__.__name__ == "WeChatCredentialsExpired"
                    else "wechat_runtime_failed"
                )
        if self._last_error == "wechat_credentials_expired":
            auth_status = {**auth_status, "credential_state": "expired"}
        return {
            **auth_status,
            "runtime_state": "running" if running else ("failed" if self._last_error else "stopped"),
            "started_at": self._started_at if running else None,
            "error_code": self._last_error,
        }

    async def start(self) -> dict[str, Any]:
        async with self._lock:
            if self._task is not None and not self._task.done():
                return await self.status()
            credentials = self.auth.load_runtime_credentials()
            self._last_error = None
            self._started_at = datetime.now(timezone.utc).isoformat()
            self._task = asyncio.create_task(self.runner(credentials), name="wechat-channel")
            self._write_enabled(True)
        return await self.status()

    async def stop(self, *, persist: bool = True) -> dict[str, Any]:
        async with self._lock:
            task, self._task = self._task, None
            self._started_at = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=5)
            except (asyncio.CancelledError, TimeoutError):
                pass
        self._last_error = None
        if persist:
            self._write_enabled(False)
        return await self.status()

    async def logout(self) -> dict[str, Any]:
        await self.stop()
        await self.auth.logout()
        return await self.status()

    async def restore(self) -> dict[str, Any]:
        if self._read_enabled():
            try:
                return await self.start()
            except Exception:
                self._last_error = "wechat_restore_requires_login"
        return await self.status()

    def _read_enabled(self) -> bool:
        try:
            value = json.loads(self._preference_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return False
        return isinstance(value, dict) and value.get("enabled") is True

    def _write_enabled(self, enabled: bool) -> None:
        self._preference_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._preference_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"schema_version": 1, "enabled": enabled}), encoding="utf-8")
        os.replace(temporary, self._preference_path)
