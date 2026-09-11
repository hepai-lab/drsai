"""Tests for platform_upstream URL resolution."""

from __future__ import annotations

import pytest

from drsai.platform_upstream import (
    API_PATH_PREFIX,
    DEVELOPMENT_MODEL_BASE_URL,
    DEVELOPMENT_OIDC_ISSUER,
    DEVELOPMENT_PLATFORM_BASE_URL,
    PRODUCTION_MODEL_BASE_URL,
    PRODUCTION_OIDC_ISSUER,
    PRODUCTION_PLATFORM_BASE_URL,
    resolve_ddf_api_base_url,
    resolve_hepai_anthropic_base_url,
    resolve_hepai_model_base_url,
    resolve_hepai_oidc_issuer,
    resolve_platform_api_base_url,
    resolve_platform_base_url,
)


# ── resolve_platform_base_url ──


class TestResolvePlatformBaseUrl:
    def test_explicit_override(self):
        env = {"OPENDRSAI_PLATFORM_BASE_URL": "https://custom.example.com"}
        assert resolve_platform_base_url(env) == "https://custom.example.com"

    def test_explicit_override_strips_trailing_slash(self):
        env = {"OPENDRSAI_PLATFORM_BASE_URL": "https://custom.example.com/"}
        assert resolve_platform_base_url(env) == "https://custom.example.com"

    def test_production_default(self):
        env = {}
        assert resolve_platform_base_url(env) == PRODUCTION_PLATFORM_BASE_URL

    def test_development_via_active_platform(self):
        env = {"OPENDRSAI_ACTIVE_PLATFORM": "development"}
        assert resolve_platform_base_url(env) == DEVELOPMENT_PLATFORM_BASE_URL

    def test_development_via_desktop_dev(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        assert resolve_platform_base_url(env) == DEVELOPMENT_PLATFORM_BASE_URL

    def test_production_when_active_platform_is_production(self):
        env = {"OPENDRSAI_ACTIVE_PLATFORM": "production"}
        assert resolve_platform_base_url(env) == PRODUCTION_PLATFORM_BASE_URL


# ── resolve_platform_api_base_url ──


class TestResolvePlatformApiBaseUrl:
    def test_derived_from_platform_base_production(self):
        env = {}
        url = resolve_platform_api_base_url(env)
        assert url == f"{PRODUCTION_PLATFORM_BASE_URL}{API_PATH_PREFIX}"

    def test_derived_from_platform_base_development(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        url = resolve_platform_api_base_url(env)
        assert url == f"{DEVELOPMENT_PLATFORM_BASE_URL}{API_PATH_PREFIX}"

    def test_explicit_override(self):
        env = {
            "OPENDRSAI_PLATFORM_API_BASE_URL": "https://api.example.com/apiv2",
        }
        assert resolve_platform_api_base_url(env) == "https://api.example.com/apiv2"

    def test_explicit_override_strips_trailing_slash(self):
        env = {
            "OPENDRSAI_PLATFORM_API_BASE_URL": "https://api.example.com/apiv2/",
        }
        assert resolve_platform_api_base_url(env) == "https://api.example.com/apiv2"


# ── resolve_ddf_api_base_url ──


class TestResolveDdfApiBaseUrl:
    def test_derived_from_platform_base_production(self):
        env = {}
        url = resolve_ddf_api_base_url(env)
        assert url == f"{PRODUCTION_PLATFORM_BASE_URL}{API_PATH_PREFIX}"

    def test_derived_from_platform_base_development(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        url = resolve_ddf_api_base_url(env)
        assert url == f"{DEVELOPMENT_PLATFORM_BASE_URL}{API_PATH_PREFIX}"

    def test_explicit_override(self):
        env = {
            "OPENDRSAI_DDF_API_BASE_URL": "https://ddf.example.com/apiv2",
        }
        assert resolve_ddf_api_base_url(env) == "https://ddf.example.com/apiv2"


# ── resolve_hepai_oidc_issuer ──


class TestResolveHepaiOidcIssuer:
    def test_explicit_oidc_issuer(self):
        env = {"OPENDRSAI_OIDC_ISSUER": "https://oidc.example.com/api"}
        assert resolve_hepai_oidc_issuer(env) == "https://oidc.example.com/api"

    def test_explicit_hai_oidc_issuer(self):
        env = {"HAI_OIDC_ISSUER": "https://hai.example.com/api"}
        assert resolve_hepai_oidc_issuer(env) == "https://hai.example.com/api"

    def test_production_default(self):
        env = {}
        assert resolve_hepai_oidc_issuer(env) == PRODUCTION_OIDC_ISSUER

    def test_development_default(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        assert resolve_hepai_oidc_issuer(env) == DEVELOPMENT_OIDC_ISSUER

    def test_oidc_issuer_independent_from_platform_base(self):
        """OIDC issuer must NOT be derived from PLATFORM_BASE_URL.

        In production the OIDC issuer is on ai.ihep.ac.cn while
        the DDF platform is on ddf.ihep.ac.cn — they are independent.
        """
        env = {
            "OPENDRSAI_PLATFORM_BASE_URL": "https://ddf.ihep.ac.cn",
        }
        assert resolve_hepai_oidc_issuer(env) == PRODUCTION_OIDC_ISSUER
        assert resolve_hepai_oidc_issuer(env) != f"{resolve_platform_base_url(env)}/api"


# ── resolve_hepai_model_base_url ──


class TestResolveHepaiModelBaseUrl:
    def test_model_url_override_takes_first_priority(self):
        env = {
            "OPENDRSAI_MODEL_BASE_URL": "https://model.example.com/apiv2",
            "OPENDRSAI_DDF_API_BASE_URL": "https://ddf.example.com/apiv2",
        }
        assert resolve_hepai_model_base_url(env) == "https://model.example.com/apiv2"

    def test_ddf_url_override_takes_second_priority(self):
        """DDF_API_BASE_URL participates in model client construction."""
        env = {
            "OPENDRSAI_DDF_API_BASE_URL": "https://ddf.example.com/apiv2",
        }
        assert resolve_hepai_model_base_url(env) == "https://ddf.example.com/apiv2"

    def test_production_default_no_overrides(self):
        env = {}
        url = resolve_hepai_model_base_url(env)
        assert url == PRODUCTION_MODEL_BASE_URL
        assert url == f"{PRODUCTION_PLATFORM_BASE_URL}{API_PATH_PREFIX}"

    def test_development_default_has_v1_suffix(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        url = resolve_hepai_model_base_url(env)
        assert url == DEVELOPMENT_MODEL_BASE_URL
        assert url == f"{DEVELOPMENT_PLATFORM_BASE_URL}{API_PATH_PREFIX}/v1"

    def test_production_no_v1_suffix(self):
        """Production model URL must NOT have /v1 suffix."""
        env = {}
        url = resolve_hepai_model_base_url(env)
        assert "/v1" not in url

    def test_platform_base_override_propagates_to_model_url(self):
        env = {"OPENDRSAI_PLATFORM_BASE_URL": "https://custom.example.com"}
        url = resolve_hepai_model_base_url(env)
        assert url == "https://custom.example.com/apiv2"

    def test_platform_base_override_dev_mode_adds_v1(self):
        env = {
            "OPENDRSAI_PLATFORM_BASE_URL": "https://custom.example.com",
            "OPENDRSAI_DESKTOP_DEV": "1",
        }
        url = resolve_hepai_model_base_url(env)
        assert url == "https://custom.example.com/apiv2/v1"

    def test_ddf_override_does_not_add_v1_in_dev(self):
        """When DDF_API_BASE_URL is set, it's used as-is (no /v1 appended).

        This means in dev, MODEL_BASE_URL must be set explicitly to prevent
        the DDF override from giving the wrong model URL.
        """
        env = {
            "OPENDRSAI_DESKTOP_DEV": "1",
            "OPENDRSAI_DDF_API_BASE_URL": "https://aiapi.example.com/apiv2",
        }
        url = resolve_hepai_model_base_url(env)
        assert url == "https://aiapi.example.com/apiv2"


# ── resolve_hepai_anthropic_base_url ──


class TestResolveHepaiAnthropicBaseUrl:
    def test_derived_from_model_url_production(self):
        env = {}
        url = resolve_hepai_anthropic_base_url(env)
        model_url = resolve_hepai_model_base_url(env)
        assert url == f"{model_url}/anthropic"

    def test_strips_v1_before_appending_anthropic(self):
        env = {"OPENDRSAI_DESKTOP_DEV": "1"}
        url = resolve_hepai_anthropic_base_url(env)
        # Dev model URL has /v1, but anthropic URL should not
        assert url == f"{DEVELOPMENT_PLATFORM_BASE_URL}{API_PATH_PREFIX}/anthropic"

    def test_with_model_override(self):
        env = {
            "OPENDRSAI_MODEL_BASE_URL": "https://model.example.com/apiv2/v1",
        }
        url = resolve_hepai_anthropic_base_url(env)
        assert url == "https://model.example.com/apiv2/anthropic"
