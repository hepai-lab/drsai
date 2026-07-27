from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_real_device_v3.py"
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("real_device_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def snapshot() -> dict:
    return {
        "session_id": "session-one",
        "snapshot_sequence": 2,
        "items": [
            {
                "item_id": "one",
                "session_id": "session-one",
                "run_id": "run-one",
                "kind": "message",
                "role": "user",
                "revision": 1,
                "session_sequence": 2,
                "source_client": "windows",
                "source_message_id": "source-one",
                "created_at": "ignored",
                "updated_at": "ignored",
                "payload": {"content": "hello"},
            }
        ],
    }


def proof(digest: str) -> dict:
    return {
        "session_id": "session-one",
        "snapshot_sequence": 2,
        "transcript_sha256": digest,
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
        "run_count": 1,
        "expected_run_count": 1,
        "session_event_count": 2,
    }


def test_three_client_session_proof_accepts_only_equal_digests() -> None:
    runtime = snapshot()
    digest = MODULE.session_conversation_digest(runtime["items"])
    assert MODULE.desktop_digest(runtime) == digest
    result = MODULE.validate_proof(runtime, proof(digest), digest)
    assert result["runtime_sha256"] == result["windows_sha256"]
    assert result["windows_sha256"] == result["android_sha256"]
    assert result["missing_sequence_count"] == 0


@pytest.mark.parametrize(
    ("mutate", "error"),
    [
        (lambda runtime, android: android.update(transcript_sha256="e" * 64),
         "v3_session_transcript_hash_mismatch"),
        (lambda runtime, android: android.update(missing_sequence_count=1),
         "v3_session_sequence_proof_invalid"),
        (lambda runtime, android: runtime.update(session_id="other"),
         "v3_runtime_snapshot_invalid"),
    ],
)
def test_three_client_session_proof_fails_closed(mutate, error: str) -> None:
    runtime = snapshot()
    digest = MODULE.session_conversation_digest(runtime["items"])
    android = proof(digest)
    mutate(runtime, android)
    with pytest.raises(RuntimeError, match=error):
        MODULE.validate_proof(runtime, android, digest)


def test_windows_two_run_sender_uses_runtime_semantics_and_source_ids() -> None:
    class Client:
        def __init__(self) -> None:
            self.requests: list[tuple] = []

        async def _request(
            self,
            method,
            path,
            body=None,
            headers=None,
        ):
            self.requests.append((method, path, body, headers))
            if method == "GET":
                return {"agent_definition": "opendrsai@1"}
            if path.endswith("/runs"):
                return {"run_id": f"run-{len([r for r in self.requests if r[1].endswith('/runs')])}"}
            return {"ok": True}

    client = Client()
    source_ids = ["windows-one", "windows-two"]
    starts = asyncio.run(
        MODULE._send_windows_runs(
            client,
            "session-one",
            source_ids,
            "marker",
        )
    )
    assert set(starts) == set(source_ids)
    create = [row for row in client.requests if row[1].endswith("/runs")]
    execute = [row for row in client.requests if row[1].endswith("/execute")]
    assert len(create) == len(execute) == 2
    assert all(row[2] == {"agent_definition": "opendrsai@1"} for row in create)
    assert {
        row[2]["metadata"]["source_message_id"] for row in execute
    } == set(source_ids)
    assert all(row[2]["metadata"]["source_client"] == "windows" for row in execute)


@pytest.mark.parametrize(
    ("output", "returncode", "expected"),
    [
        ("stack=RelayHttpException: relay_http_502", -1, "relay_http_502"),
        ("javax.net.ssl.SSLHandshakeException: failure", -1, "SSLHandshakeException"),
        (
            "org.json.JSONException: No value for snapshot_sequence",
            -1,
            "snapshot_sequence_missing",
        ),
        ("private payload must never be returned", -1, "monitor_exited"),
        ("", None, "monitor_timeout"),
    ],
)
def test_monitor_failure_diagnostic_is_bounded_and_secret_free(
    output: str,
    returncode: int | None,
    expected: str,
) -> None:
    assert MODULE.monitor_failure_code(output, returncode) == expected


def test_monitor_failure_diagnostic_extracts_bounded_real_ui_code() -> None:
    output = "java.lang.AssertionError: real_ui_expected_content_missing_session"
    assert (
        MODULE.monitor_failure_code(output, -1)
        == "real_ui_expected_content_missing_session"
    )


def test_public_relay_preflight_requires_https_200_without_redirect() -> None:
    calls: list[tuple[str, dict]] = []

    class Response:
        status = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def get(self, url, **kwargs):
            calls.append((url, kwargs))
            return Response()

    asyncio.run(
        MODULE.public_relay_preflight(
            "https://ai-dev.ihep.ac.cn/api/runtime-relay/",
            session_factory=lambda **_kwargs: Session(),
        )
    )
    assert calls == [(
        "https://ai-dev.ihep.ac.cn/api/runtime-relay/v2/health",
        {"allow_redirects": False, "headers": {"Accept": "application/json"}},
    )]

    with pytest.raises(RuntimeError, match="v3_public_relay_url_invalid"):
        asyncio.run(MODULE.public_relay_preflight("http://ai-dev.ihep.ac.cn/"))
