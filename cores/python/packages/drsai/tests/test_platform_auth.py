"""Tests for platform_auth DelegatedCredentialContext host validation."""

from __future__ import annotations

import time

import pytest

from drsai.platform_auth import (
    DelegatedCredentialContext,
    DelegatedModelCredentialProvider,
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Ensure no stale env vars interfere with tests."""
    for key in [
        "OPENDRSAI_PLATFORM_BASE_URL",
        "OPENDRSAI_PLATFORM_API_BASE_URL",
        "OPENDRSAI_DDF_API_BASE_URL",
        "OPENDRSAI_MODEL_BASE_URL",
        "OPENDRSAI_OIDC_ISSUER",
        "OPENDRSAI_ACTIVE_PLATFORM",
        "OPENDRSAI_DESKTOP_DEV",
    ]:
        monkeypatch.delenv(key, raising=False)


def _make_ctx(model_base_url: str, **kwargs) -> DelegatedCredentialContext:
    """Helper: create a valid DelegatedCredentialContext for testing."""
    defaults = dict(
        access_token="test-token",
        token_type="Bearer",
        expires_at=int(time.time()) + 3600,
        audience="hai-model-gateway",
        model_base_url=model_base_url,
    )
    defaults.update(kwargs)
    return DelegatedCredentialContext(**defaults)


class TestDelegatedCredentialContextValidation:
    """DelegatedCredentialContext.__post_init__ validates the model_base_url
    against an allowed set derived from the platform base."""

    def test_production_model_url_allowed(self):
        ctx = _make_ctx("https://ddf.ihep.ac.cn/apiv2")
        assert ctx.model_base_url == "https://ddf.ihep.ac.cn/apiv2"

    def test_development_model_url_allowed(self, monkeypatch):
        monkeypatch.setenv("OPENDRSAI_DESKTOP_DEV", "1")
        ctx = _make_ctx("https://ai-dev.ihep.ac.cn/apiv2/v1")
        assert ctx.model_base_url == "https://ai-dev.ihep.ac.cn/apiv2/v1"

    def test_custom_platform_base_derived_url_allowed(self, monkeypatch):
        monkeypatch.setenv("OPENDRSAI_PLATFORM_BASE_URL", "https://custom.example.com")
        ctx = _make_ctx("https://custom.example.com/apiv2")
        assert ctx.model_base_url == "https://custom.example.com/apiv2"

    def test_custom_platform_base_with_v1_allowed(self, monkeypatch):
        monkeypatch.setenv("OPENDRSAI_PLATFORM_BASE_URL", "https://custom.example.com")
        ctx = _make_ctx("https://custom.example.com/apiv2/v1")
        assert ctx.model_base_url == "https://custom.example.com/apiv2/v1"

    def test_model_base_url_override_allowed(self, monkeypatch):
        monkeypatch.setenv("OPENDRSAI_MODEL_BASE_URL", "https://override.example.com/apiv2")
        ctx = _make_ctx("https://override.example.com/apiv2")
        assert ctx.model_base_url == "https://override.example.com/apiv2"

    def test_unauthorized_model_url_rejected(self):
        with pytest.raises(ValueError, match="delegation_host_not_allowed"):
            _make_ctx("https://evil.example.com/apiv2")

    def test_expired_credential_rejected(self):
        with pytest.raises(ValueError, match="delegation_expired"):
            _make_ctx(
                "https://ddf.ihep.ac.cn/apiv2",
                expires_at=int(time.time()) - 1,
            )


class TestDelegatedModelCredentialProviderAnthropicUrl:
    """The anthropic_base_url is derived from model_base_url via
    DelegatedModelCredentialProvider."""

    def test_anthropic_base_url_derived(self):
        ctx = _make_ctx("https://ddf.ihep.ac.cn/apiv2")
        provider = DelegatedModelCredentialProvider(ctx)
        assert provider.anthropic_base_url == "https://ddf.ihep.ac.cn/apiv2/anthropic"

    def test_anthropic_base_url_strips_v1(self):
        ctx = _make_ctx("https://ai-dev.ihep.ac.cn/apiv2/v1")
        provider = DelegatedModelCredentialProvider(ctx)
        assert provider.anthropic_base_url == "https://ai-dev.ihep.ac.cn/apiv2/anthropic"
