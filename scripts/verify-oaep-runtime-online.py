from __future__ import annotations

import json
import os
import sys
import tempfile
import asyncio
import warnings
from pathlib import Path

warnings.filterwarnings(
    "ignore",
    message=r"Using `httpx` with `starlette\.testclient` is deprecated.*",
    category=Warning,
)
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "cores" / "python" / "packages" / "drsai" / "src"
if str(PYTHON_SRC) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC))


class _ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="oaep-runtime-online-") as raw:
        temp = Path(raw)
        home = temp / "home"
        workspace = temp / "workspace"
        workspace.mkdir(parents=True)
        os.environ["DRSAI_HOME"] = str(home)

        from drsai.backend import gateway

        gateway._runtime_registry_instance = None
        gateway._runtime_engine_instance = None
        opened = gateway._runtime_registry().open_workspace(str(workspace), display_name="OAEP Smoke")
        engine = gateway._runtime_engine()
        session = engine.create_session(opened.workspace_id, "OAEP HTTP smoke")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "oaep-http-smoke")
        engine.set_run_input(
            run["run_id"],
            "hello oaep",
            source_client="windows",
            source_message_id="oaep-http-user-1",
        )
        engine.transition_run(run["run_id"], "running")
        engine.append_backend_event(
            run["run_id"],
            "agent.message.delta",
            {"text": "stream "},
            "oaep-http-delta-1",
        )
        engine.append_backend_event(
            run["run_id"],
            "agent.message.delta",
            {"text": "content"},
            "oaep-http-delta-2",
        )
        secret = "OAEP_HTTP_SECRET_CANARY_12345"
        engine.append_backend_event(
            run["run_id"],
            "agent.failed",
            {
                "error": {
                    "code": "smoke_failure",
                    "message": f"masked token={secret}",
                    "retryable": True,
                },
                "diagnostic": {"stack": [{"path": str(workspace / "internal.py")}]},
            },
            "oaep-http-failed-1",
        )

        client = TestClient(gateway.app)
        capabilities = client.get("/v1/capabilities")
        capabilities.raise_for_status()
        capability_names = set(capabilities.json()["capabilities"])
        required = {
            "oaep.v1",
            "oaep.session.snapshot",
            "oaep.session.events",
            "oaep.session.events.stream",
        }
        missing = required - capability_names
        if missing:
            raise AssertionError(f"Missing OAEP capabilities: {sorted(missing)}")

        snapshot_response = client.get(f"/v1/sessions/{session['session_id']}/oaep-snapshot")
        snapshot_response.raise_for_status()
        snapshot = snapshot_response.json()
        if snapshot["version"] != "1.0":
            raise AssertionError("OAEP snapshot version mismatch")
        items = {item["id"]: item for item in snapshot["items"]}
        assistant = items[f"assistant:{run['run_id']}"]
        if assistant["content"]["text"] != "stream content":
            raise AssertionError("OAEP snapshot did not preserve streamed text")
        notice = items[f"error:{run['run_id']}:agent"]
        if notice["type"] != "notice" or notice["status"] != "failed":
            raise AssertionError("OAEP failure did not project to failed notice")

        replay_response = client.get(
            f"/v1/sessions/{session['session_id']}/oaep-events",
            params={"after_sequence": 0, "limit": 200},
        )
        replay_response.raise_for_status()
        replay = replay_response.json()
        if replay["version"] != "1.0" or replay["object"] != "list":
            raise AssertionError("OAEP event page envelope mismatch")
        sequences = [event["sequence"] for event in replay["data"]]
        if sequences != sorted(sequences) or len(sequences) != len(set(sequences)):
            raise AssertionError("OAEP event sequences must be ordered and unique")
        if not any(event["type"] == "event.item.delta" for event in replay["data"]):
            raise AssertionError("OAEP event replay did not include item delta")
        if not any(event["type"] == "event.item.failed" for event in replay["data"]):
            raise AssertionError("OAEP event replay did not include failed item")

        stream_response = asyncio.run(
            gateway.runtime_session_oaep_event_stream(
                session["session_id"],
                _ConnectedRequest(),
                0,
            )
        )
        if stream_response.media_type != "text/event-stream":
            raise AssertionError("OAEP stream content type mismatch")

        async def first_frame() -> str:
            return await stream_response.body_iterator.__anext__()

        stream_payload = asyncio.run(first_frame())
        if not stream_payload.startswith("id: ") or "\nevent: oaep.event\n" not in stream_payload:
            raise AssertionError("OAEP stream did not yield an event frame")

        serialized = json.dumps(
            {"snapshot": snapshot, "replay": replay, "stream": stream_payload},
            ensure_ascii=False,
        )
        if secret in serialized or str(workspace) in serialized:
            raise AssertionError("OAEP HTTP smoke leaked sensitive data")

    print("OAEP Runtime online HTTP smoke passed.")


if __name__ == "__main__":
    main()
