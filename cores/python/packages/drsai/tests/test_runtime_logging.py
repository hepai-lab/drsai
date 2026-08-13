from __future__ import annotations

from pathlib import Path
import sys

from drsai.backend.runtime_logging import configure_runtime_file_logging, redact_runtime_log_text


def test_runtime_log_redacts_auth_and_credentials() -> None:
    text = (
        'Authorization: Bearer eyJ.secret.value '
        'access_token="token-value" api_key=key-value '
        'X-OpenDrSai-Gateway-Token: instance-token'
    )
    safe = redact_runtime_log_text(text)
    assert "eyJ.secret.value" not in safe
    assert "token-value" not in safe
    assert "key-value" not in safe
    assert "instance-token" not in safe
    assert safe.count("[redacted]") == 4


def test_runtime_file_sink_is_durable_and_redacted(tmp_path: Path) -> None:
    original_stdout, original_stderr = sys.stdout, sys.stderr
    target = tmp_path / "gateway.log"
    sink = None
    try:
        sink = configure_runtime_file_logging(target)
        print("Authorization: Bearer do-not-store")
        print('refresh_token="also-secret"', file=sys.stderr)
        sink.flush()
    finally:
        sys.stdout, sys.stderr = original_stdout, original_stderr
        if sink is not None:
            sink.close()
    content = target.read_text(encoding="utf-8")
    assert "do-not-store" not in content
    assert "also-secret" not in content
    assert content.count("[redacted]") == 2
