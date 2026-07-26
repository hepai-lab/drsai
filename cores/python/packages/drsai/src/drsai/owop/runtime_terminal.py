"""OWOP PTY operations backed by the Runtime-owned Terminal State Service."""

from __future__ import annotations

import base64
import binascii
from typing import Any, Callable, Mapping

from drsai.backend.runtime.terminal.state_service import TerminalStateError, TerminalStateService
from drsai.owop.protocol import OWOPError


class RuntimeTerminalOWOPOperations:
    """Workspace-scoped OWOP projection over a multi-Workspace Terminal service."""

    def __init__(self, service: TerminalStateService, workspace_id: str):
        self.service = service
        self.workspace_id = workspace_id

    def handlers(self) -> dict[str, Callable[[Mapping[str, Any]], dict[str, Any]]]:
        return {
            "pty.list": self.pty_list,
            "pty.describe": self.pty_describe,
            "pty.create": self.pty_create,
            "pty.write": self.pty_write,
            "pty.resize": self.pty_resize,
            "pty.attach": self.pty_attach,
            "pty.detach": self.pty_detach,
            "pty.kill": self.pty_kill,
        }

    def pty_list(self, _params: Mapping[str, Any]) -> dict[str, Any]:
        return self._call(lambda: {"terminals": self.service.list(self.workspace_id)})

    def pty_describe(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self._call(lambda: {"terminal": self._terminal(str(params["pty_id"]))})

    def pty_create(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self._call(lambda: {
            "terminal": self.service.create(
                self.workspace_id,
                cwd=str(params["cwd"]),
                argv=[str(item) for item in params["argv"]],
                cols=int(params["cols"]),
                rows=int(params["rows"]),
            )
        })

    def pty_write(self, params: Mapping[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            terminal_id = str(params["pty_id"])
            self._terminal(terminal_id)
            data = self._decode(str(params["content_base64"]))
            self.service.write(str(params["lease_id"]), data, expected_terminal_id=terminal_id)
            return {"pty_id": terminal_id, "written": len(data)}
        return self._call(operation)

    def pty_resize(self, params: Mapping[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            terminal_id = str(params["pty_id"])
            self._terminal(terminal_id)
            terminal = self.service.resize(
                str(params["lease_id"]), int(params["cols"]), int(params["rows"]),
                expected_terminal_id=terminal_id,
            )
            return {"terminal": terminal}
        return self._call(operation)

    def pty_attach(self, params: Mapping[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            terminal_id = str(params["pty_id"])
            self._terminal(terminal_id)
            if params.get("lease_id"):
                attached = self.service.resume(
                    terminal_id,
                    str(params["lease_id"]),
                    after_sequence=int(params["after_sequence"]),
                    lease_seconds=int(params["lease_seconds"]) if params.get("lease_seconds") else None,
                    prefer_snapshot=bool(params.get("prefer_snapshot")),
                )
                if attached["mode"] != str(params["mode"]):
                    raise TerminalStateError("terminal_lease_mode_mismatch", "Terminal lease mode cannot change during resume.")
            else:
                attached = self.service.attach(
                    terminal_id,
                    str(params["client_id"]),
                    writer=str(params["mode"]) == "writer",
                    after_sequence=int(params["after_sequence"]),
                    lease_seconds=int(params["lease_seconds"]) if params.get("lease_seconds") else None,
                    prefer_snapshot=bool(params.get("prefer_snapshot")),
                )
            attached["events"] = [self._event(event) for event in attached["events"]]
            return attached
        return self._call(operation)

    def pty_detach(self, params: Mapping[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            terminal_id = str(params["pty_id"])
            self._terminal(terminal_id)
            return {"terminal": self.service.detach(
                str(params["lease_id"]), expected_terminal_id=terminal_id
            )}
        return self._call(operation)

    def pty_kill(self, params: Mapping[str, Any]) -> dict[str, Any]:
        def operation() -> dict[str, Any]:
            terminal_id = str(params["pty_id"])
            self._terminal(terminal_id)
            return {"terminal": self.service.kill(terminal_id)}
        return self._call(operation)

    def close(self) -> None:
        """The Runtime owns the shared service; a Workspace projection cannot close it."""

    def _terminal(self, terminal_id: str) -> dict[str, Any]:
        terminal = self.service.describe(terminal_id)
        if terminal["workspace_id"] != self.workspace_id:
            raise TerminalStateError(
                "terminal_workspace_mismatch",
                "Terminal belongs to a different Workspace.",
                detail={"terminal_id": terminal_id, "workspace_id": self.workspace_id},
            )
        return terminal

    @staticmethod
    def _decode(content: str) -> bytes:
        try:
            return base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise TerminalStateError("owop_content_invalid", "Terminal content is not valid base64.") from exc

    @staticmethod
    def _event(event: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "terminal_id": str(event["terminal_id"]),
            "runtime_id": str(event["runtime_id"]),
            "workspace_id": str(event["workspace_id"]),
            "worktree_id": event["worktree_id"],
            "generation": int(event["generation"]),
            "sequence": int(event["sequence"]),
            "created_at": float(event["created_at"]),
            "content_base64": base64.b64encode(bytes(event["data"])).decode("ascii"),
        }

    @staticmethod
    def _call(operation: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        try:
            return operation()
        except TerminalStateError as exc:
            raise OWOPError(exc.code, str(exc), "operation", exc.retryable, exc.detail) from exc
