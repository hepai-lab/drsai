from __future__ import annotations

import json

import pytest

from drsai.backend.runtime.web_search.provider_policy import (
    policy_path,
    read_provider_mode,
    resolve_web_search_provider,
    write_provider_mode,
)


@pytest.mark.parametrize(("mode", "authenticated", "byok", "provider", "error"), [
    ("auto", True, True, "hai_managed_tavily", None),
    ("auto", False, True, "tavily", None),
    ("auto", False, False, None, "configuration_required"),
    ("managed", True, True, "hai_managed_tavily", None),
    ("managed", False, True, None, "login_required"),
    ("byok", True, True, "tavily", None),
    ("byok", True, False, None, "credential_missing"),
    ("none", True, True, None, "policy_denied"),
])
def test_provider_resolution_matrix(mode, authenticated, byok, provider, error) -> None:
    selected = resolve_web_search_provider(mode, platform_authenticated=authenticated, byok_available=byok)
    assert selected.provider == provider
    assert selected.error == error


def test_provider_policy_is_atomic_bounded_and_contains_no_credentials(tmp_path) -> None:
    assert read_provider_mode(tmp_path) == "auto"
    assert write_provider_mode(tmp_path, "managed") == "managed"
    assert read_provider_mode(tmp_path) == "managed"
    payload = policy_path(tmp_path).read_text(encoding="utf-8")
    assert json.loads(payload) == {"version": 1, "mode": "managed"}
    assert "key" not in payload.lower() and "token" not in payload.lower()
    with pytest.raises(ValueError, match="web_search_provider_mode_invalid"):
        write_provider_mode(tmp_path, "arbitrary")
