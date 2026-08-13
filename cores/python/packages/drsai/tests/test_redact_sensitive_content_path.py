"""Content-path vs audit-path behavior for ``redact_sensitive``.

The content path is the OAEP projection route: assistant replies and tool
results end up here and reach the user verbatim. It must not clip a normal
reply. The audit path is metrics/audit-log/hash-input; a 4 KiB cap is fine.
"""

from __future__ import annotations

import pytest

from drsai.backend.runtime.security import (
    AUDIT_MAX_CHARS,
    CONTENT_MAX_CHARS,
    redact_sensitive,
)


def test_content_path_preserves_five_thousand_char_reply():
    reply = "The answer is " + "x" * 5_000
    result = redact_sensitive(reply, "", "content")
    assert result == reply
    assert "[TRUNCATED" not in result


def test_content_path_truncates_only_above_one_mib():
    over = "y" * (CONTENT_MAX_CHARS + 42)
    result = redact_sensitive(over, "", "content")
    assert result.endswith("[TRUNCATED 42 CHARS]")
    assert len(result) == CONTENT_MAX_CHARS + len("[TRUNCATED 42 CHARS]")


def test_audit_path_still_truncates_at_four_kib():
    over = "z" * (AUDIT_MAX_CHARS + 7)
    result = redact_sensitive(over, "", "audit")
    assert result.endswith("[TRUNCATED 7 CHARS]")


def test_content_path_redacts_bearer_and_url_userinfo():
    value = "Authorization: Bearer sk-canary; see https://alice:secret@example.invalid/path"
    result = redact_sensitive(value, "", "content")
    assert "sk-canary" not in result
    assert "Bearer [REDACTED]" in result
    assert "https://[REDACTED]@example.invalid/path" in result


def test_content_path_redacts_sensitive_key_regardless_of_length():
    long_secret = "s" * 50_000
    result = redact_sensitive(long_secret, "authorization", "content")
    assert result == "[REDACTED]"


def test_content_path_preserves_long_string_inside_nested_dict():
    reply = "R" * 8_000
    payload = {
        "content": {
            "role": "assistant",
            "text": reply,
            "parts": [{"type": "text", "text": reply}],
        },
        "metadata": {"model": "test"},
    }
    result = redact_sensitive(payload, "", "content")
    assert result["content"]["text"] == reply
    assert result["content"]["parts"][0]["text"] == reply
    assert "[TRUNCATED" not in result["content"]["text"]


def test_audit_path_clips_long_string_inside_nested_dict():
    reply = "R" * 8_000
    payload = {"detail": {"error_message": reply}}
    result = redact_sensitive(payload, "", "audit")
    inner = result["detail"]["error_message"]
    assert inner.endswith(f"[TRUNCATED {8_000 - AUDIT_MAX_CHARS} CHARS]")


def test_content_path_list_keeps_more_than_one_hundred_items():
    items = list(range(500))
    result = redact_sensitive(items, "", "content")
    assert result == items
    assert not any(
        isinstance(entry, str) and entry.startswith("[TRUNCATED") for entry in result
    )


def test_audit_path_list_still_caps_at_one_hundred():
    items = list(range(500))
    result = redact_sensitive(items, "", "audit")
    assert len(result) == 101
    assert result[-1] == "[TRUNCATED 400 ITEMS]"


def test_context_parameter_is_required_and_validated():
    with pytest.raises(TypeError):
        redact_sensitive("value")  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        redact_sensitive("value", "", "bogus")
