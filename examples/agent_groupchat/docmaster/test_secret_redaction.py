import io
import logging

from secret_redaction import REDACTED, RedactingTextIO, install_secret_redaction, redact_secrets


def test_redacts_all_known_docmaster_log_shapes():
    secret = "sk-abcdefghijklmnopqrstuvwxyz012345"
    text = "\n".join([
        f"Worker secret key: `{secret}`, use it",
        f"DrSai_test_api_key: {secret}",
        f"DrSaiWorkerConfig(owner_key='{secret}')",
        f"Authorization: Bearer {secret}",
        f"pipelines with API-KEY: `{secret}`",
    ])

    result = redact_secrets(text, known_secrets=())

    assert secret not in result
    assert result.count(REDACTED) == 5


def test_exact_environment_secret_is_redacted_without_label():
    secret = "opaque-credential-value"
    assert redact_secrets(f"unexpected output {secret}", known_secrets=(secret,)) == (
        f"unexpected output {REDACTED}"
    )


def test_unrelated_identifiers_are_preserved():
    text = "worker_id='wk-docmaster-stable' schema_sha256=0123456789abcdef"
    assert redact_secrets(text, known_secrets=()) == text


def test_stream_proxy_never_returns_secret():
    target = io.StringIO()
    proxy = RedactingTextIO(target, ("known-secret-value",))
    value = "api_key=known-secret-value"

    assert proxy.write(value) == len(value)
    assert target.getvalue() == f"api_key={REDACTED}"


def test_percent_style_logging_can_be_sanitized_after_formatting():
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "owner_key=%s", ("secret-value",), None)
    assert redact_secrets(record.getMessage(), known_secrets=()) == f"owner_key={REDACTED}"


def test_logging_redaction_preserves_uvicorn_access_arguments(monkeypatch):
    import secret_redaction

    original_factory = logging.getLogRecordFactory()
    original_stdout, original_stderr = secret_redaction.sys.stdout, secret_redaction.sys.stderr
    monkeypatch.setattr(secret_redaction, "_installed", False)
    monkeypatch.setenv("DOCMASTER_TEST_API_KEY", "known-secret-value")
    try:
        install_secret_redaction()
        record = logging.getLogRecordFactory()(
            "uvicorn.access", logging.INFO, __file__, 1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:1234", "POST", "/api_key=known-secret-value", "1.1", 200),
            None,
        )
        assert len(record.args) == 5
        assert record.args[2] == f"/api_key={REDACTED}"
        assert record.args[4] == 200
    finally:
        logging.setLogRecordFactory(original_factory)
        secret_redaction.sys.stdout = original_stdout
        secret_redaction.sys.stderr = original_stderr
        secret_redaction._installed = False
