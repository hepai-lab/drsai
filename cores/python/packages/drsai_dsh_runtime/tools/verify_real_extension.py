"""Run the rc.5 OpenDrSai extension against a real DSH Node carrier and mock LLM."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from opendrsai_dsh_runtime.driver import HarnessSdkDriver
from opendrsai_dsh_runtime.native_extension import NativeExtensionBundle
from opendrsai_dsh_runtime.process import HarnessProcessSpec, HarnessProcessSupervisor


class MockDeepSeek:
    def __init__(self) -> None:
        self.server: asyncio.Server | None = None
        self.requests = 0
        self.bodies: list[str] = []
        self.stall = asyncio.Event()

    async def start(self) -> str:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    async def close(self) -> None:
        self.stall.set()
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            length = 0
            for line in head.decode("latin1").split("\r\n"):
                if line.lower().startswith("content-length:"):
                    length = int(line.split(":", 1)[1].strip())
            body = await reader.readexactly(length) if length else b""
            self.bodies.append(body.decode("utf-8", errors="replace"))
            self.requests += 1
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                b"Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
            )
            await writer.drain()
            if b"cancel me" in body.lower():
                await self.stall.wait()
                return
            for payload in (
                {"choices": [{"delta": {"content": f"real-dsh-{self.requests}"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
            ):
                writer.write(f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode())
            writer.write(b"data: [DONE]\n\n")
            await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()
            await writer.wait_closed()


async def wait_turn(driver: HarnessSdkDriver, message_id: str, *, cancel: bool = False) -> dict:
    bound = False
    terminal = None
    for _ in range(200):
        notification = await driver.next_fact(timeout=10)
        if notification.method != "session.event":
            continue
        event = notification.params["event"]
        if event["type"] == "turn/start" and event["data"].get("messageId") == message_id:
            bound = True
            if cancel:
                await driver.cancel_run(session_id=notification.params["sessionId"], message_id=message_id)
        if bound and event["type"] == "turn/end":
            terminal = event
            break
    if not bound or terminal is None:
        raise AssertionError("real DSH turn did not bind and terminate")
    return terminal


async def process_phase(command: list[str], workspace: Path, state: Path, base_url: str, phase: int) -> dict:
    managed = {
        "DEEPSEEK_API_KEY": "test-key",
        "DEEPSEEK_BASE_URL": base_url,
        "DSH_CWD": str(workspace),
        "DSH_SESSION_ROOT": str(state / "native-sessions"),
    }
    supervisor = HarnessProcessSupervisor(HarnessProcessSpec.create(
        command, cwd=workspace, inherited_environment=os.environ, managed_environment=managed,
    ))
    process = await supervisor.start()
    bundle = NativeExtensionBundle.rc5()
    driver = HarnessSdkDriver(process.peer, contract_sha256=bundle.contract_sha256)
    try:
        identity = await driver.initialize(
            cwd=workspace, provider="deepseek-official", model="deepseek-v4-flash", max_tokens=256,
        )
        session_id = "opendrsai-real-extension-session"
        if phase == 2:
            resumed = await driver.resume_session(session_id=session_id)
            history = await driver.session_history(session_id=session_id)
            if resumed["disposition"] != "resumed" or not history["events"]:
                raise AssertionError("durable DSH resume/history failed")
            receipt = await driver.start_run(
                session_id=session_id, content_blocks=[{"type": "text", "text": "after restart"}],
            )
            terminal = await wait_turn(driver, receipt.message_id)
            return {"resumed": True, "history_events": len(history["events"]), "terminal": terminal["data"]["reason"]}

        first = await driver.start_run(
            session_id=session_id, content_blocks=[{"type": "text", "text": "first turn"}],
        )
        first_end = await wait_turn(driver, first.message_id)
        history = await driver.session_history(session_id=session_id)
        attestation = await driver.workspace_attestation(session_id=session_id)
        second = await driver.start_run(
            session_id=session_id, content_blocks=[{"type": "text", "text": "cancel me"}],
        )
        second_end = await wait_turn(driver, second.message_id, cancel=True)
        return {
            "first_terminal": first_end["data"]["reason"],
            "cancel_terminal": second_end["data"]["reason"],
            "history_events": len(history["events"]),
            "attestation": attestation,
            "identity": {"version": identity.server_version, "capabilities": sorted(identity.capabilities)},
        }
    finally:
        await driver.close()
        await supervisor.close()


async def run(args: argparse.Namespace) -> dict:
    workspace = args.workspace.resolve(strict=True)
    state = args.state_root.resolve(strict=False)
    state.mkdir(parents=True, exist_ok=True)
    mock = MockDeepSeek()
    base_url = await mock.start()
    try:
        first = await process_phase(args.command, workspace, state, base_url, 1)
        mock.stall.set()
        second = await process_phase(args.command, workspace, state, base_url, 2)
        evidence = {"schema_version": 1, "accepted": True, "phase_1": first, "phase_2": second}
        args.output.write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
        return evidence
    except Exception:
        print(json.dumps({"mock_requests": mock.bodies}, ensure_ascii=False), file=sys.stderr)
        raise
    finally:
        await mock.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    args.command = args.command[1:] if args.command[:1] == ["--"] else args.command
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
