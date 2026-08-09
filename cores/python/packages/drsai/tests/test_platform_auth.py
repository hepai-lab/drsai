from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import threading
import tempfile
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from drsai.platform_auth import (
    classify_model_error,
    context_from_bearer,
    get_platform_auth,
    get_model_credential_provider,
    platform_auth_scope,
    revoke_gateway_instance_token,
    verify_gateway_instance,
)
from drsai.modules.components.model_client.LLMClient import HepAIChatCompletionClient
from drsai.modules.components.model_client.anthropic._anthropic_client import HepAIAnthropicChatCompletionClient


USER_ID = "d30fc87e-f83d-4f3c-a145-bd1b77b7fde3"
SECOND_USER_ID = "d0b66156-3680-4405-8c87-01b186b92a8c"


def jwt(claims: dict[str, object]) -> str:
    def encode(value: dict[str, object]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    header, payload = encode({'alg': 'HS256', 'typ': 'JWT'}), encode(claims)
    signature = hmac.new(b"temporary-oidc-test-secret", f"{header}.{payload}".encode(), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{header}.{payload}.{encoded_signature}"


class PlatformAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._previous_oidc_secret = os.environ.get("OPENDRSAI_OIDC_HS256_SECRET")
        os.environ["OPENDRSAI_OIDC_HS256_SECRET"] = "temporary-oidc-test-secret"

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._previous_oidc_secret is None:
            os.environ.pop("OPENDRSAI_OIDC_HS256_SECRET", None)
        else:
            os.environ["OPENDRSAI_OIDC_HS256_SECRET"] = cls._previous_oidc_secret

    def valid_token(self, subject: str = USER_ID, issuer: str = "https://ai-dev.ihep.ac.cn/api") -> str:
        return jwt({"sub": subject, "iss": issuer, "exp": int(time.time()) + 600, "aud": "hai-api", "typ": "access_token", "scope": "openid hai_api", "org_id": "org-1", "sid": "session-1"})

    def test_development_context_selects_development_model_service(self) -> None:
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        self.assertEqual(context.subject, USER_ID)
        self.assertEqual((context.organization_id, context.session_id, context.audience), ("org-1", "session-1", "hai-api"))
        self.assertEqual(context.model_base_url, "https://ai-dev.ihep.ac.cn/apiv2/v1")

    def test_production_context_selects_production_model_service(self) -> None:
        context = context_from_bearer(
            f"Bearer {self.valid_token(issuer='https://ai.ihep.ac.cn/api')}",
            USER_ID,
        )
        self.assertEqual(context.model_base_url, "https://ai.ihep.ac.cn/apiv2/v1")

    def test_expired_and_mismatched_tokens_are_rejected(self) -> None:
        expired = jwt({"sub": USER_ID, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) - 1, "aud": "hai-api"})
        with self.assertRaisesRegex(ValueError, "token_expired"):
            context_from_bearer(f"Bearer {expired}", USER_ID)
        with self.assertRaisesRegex(ValueError, "subject_mismatch"):
            context_from_bearer(f"Bearer {self.valid_token()}", SECOND_USER_ID)

    def test_non_uuid_subject_and_missing_model_scope_are_rejected(self) -> None:
        username_subject = jwt({"sub": "researcher", "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + 60, "aud": "hai-api", "typ": "access_token", "scope": "openid hai_api"})
        with self.assertRaisesRegex(ValueError, "invalid_subject"):
            context_from_bearer(f"Bearer {username_subject}", "researcher")
        missing_scope = jwt({"sub": USER_ID, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + 60, "aud": "hai-api", "typ": "access_token", "scope": "openid profile"})
        with self.assertRaisesRegex(ValueError, "missing_hai_api_scope"):
            context_from_bearer(f"Bearer {missing_scope}", USER_ID)

    def test_forged_signature_audience_and_future_token_are_rejected(self) -> None:
        valid = self.valid_token()
        forged = valid.rsplit(".", 1)[0] + "." + base64.urlsafe_b64encode(b"forged").decode().rstrip("=")
        with self.assertRaisesRegex(ValueError, "invalid_token_signature"):
            context_from_bearer(f"Bearer {forged}", USER_ID)
        wrong_audience = jwt({"sub": USER_ID, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + 60, "aud": "other"})
        with self.assertRaisesRegex(ValueError, "audience_mismatch"):
            context_from_bearer(f"Bearer {wrong_audience}", USER_ID)
        future = jwt({"sub": USER_ID, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + 600, "nbf": int(time.time()) + 120, "aud": "hai-api"})
        with self.assertRaisesRegex(ValueError, "token_not_yet_valid"):
            context_from_bearer(f"Bearer {future}", USER_ID)

    def test_scope_is_isolated_between_concurrent_tasks(self) -> None:
        first = context_from_bearer(f"Bearer {self.valid_token(USER_ID)}", USER_ID)
        second = context_from_bearer(f"Bearer {self.valid_token(SECOND_USER_ID)}", SECOND_USER_ID)

        async def read_subject(context) -> str:
            with platform_auth_scope(context):
                await asyncio.sleep(0)
                current = get_platform_auth()
                return current.subject if current else "missing"

        async def run() -> list[str]:
            return await asyncio.gather(read_subject(first), read_subject(second))

        self.assertEqual(asyncio.run(run()), [USER_ID, SECOND_USER_ID])
        self.assertIsNone(get_platform_auth())

    def test_gateway_instance_token_uses_exact_constant_time_match(self) -> None:
        with patch.dict(os.environ, {"OPENDRSAI_GATEWAY_INSTANCE_TOKEN": "local-secret"}):
            self.assertTrue(verify_gateway_instance("local-secret"))
            self.assertFalse(verify_gateway_instance("wrong-secret"))
            self.assertFalse(verify_gateway_instance(None))

    def test_gateway_instance_token_expiry_and_revocation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {
                "DRSAI_HOME": temporary,
                "OPENDRSAI_GATEWAY_INSTANCE_TOKEN": "temporary-runtime-token",
                "OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT": str(time.time() - 1),
            }, clear=False):
                self.assertFalse(verify_gateway_instance("temporary-runtime-token"))
                os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT"] = str(time.time() + 60)
                self.assertTrue(verify_gateway_instance("temporary-runtime-token"))
                revoke_gateway_instance_token("temporary-runtime-token")
                self.assertFalse(verify_gateway_instance("temporary-runtime-token"))

    def test_static_credential_provider_remains_available_without_oidc(self) -> None:
        provider = get_model_credential_provider("static-key", "https://provider.example/v1")
        self.assertIsNotNone(provider)
        self.assertEqual(provider.access_token, "static-key")
        self.assertEqual(provider.openai_base_url, "https://provider.example/v1")

    def test_agent_provider_credentials_take_priority_over_signed_in_session(self) -> None:
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        with platform_auth_scope(context):
            provider = get_model_credential_provider(
                "configured-provider-key",
                "https://api.zhizengzeng.com/v1",
            )
        self.assertIsNotNone(provider)
        self.assertEqual(provider.access_token, "configured-provider-key")
        self.assertEqual(provider.openai_base_url, "https://api.zhizengzeng.com/v1")

    def test_signed_in_session_does_not_rebind_configured_provider_client(self) -> None:
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        with platform_auth_scope(context):
            client = HepAIChatCompletionClient(
                model="deepseek-v4-flash",
                api_key="configured-provider-key",
                base_url="https://api.zhizengzeng.com/v1",
            )
            client._bind_platform_auth()
        self.assertEqual(client._client.api_key, "configured-provider-key")
        self.assertEqual(
            str(client._client.base_url).rstrip("/"),
            "https://api.zhizengzeng.com/v1",
        )

    def test_oidc_only_mode_rejects_static_credential_fallback(self) -> None:
        from autogen_ext.models.openai import OpenAIChatCompletionClient

        def capture_init(client, **kwargs):
            client._raw_config = dict(kwargs)

        with (
            patch.dict(os.environ, {"OPENDRSAI_OIDC_ONLY": "1"}),
            patch.object(OpenAIChatCompletionClient, "__init__", capture_init),
        ):
            provider = get_model_credential_provider(
                "legacy-static-key",
                "https://provider.example/v1",
            )
            self.assertIsNone(provider)
            client = HepAIChatCompletionClient(
                model="deepseek-ai/deepseek-v4-pro",
                api_key="legacy-static-key",
                base_url="https://provider.example/v1",
            )
            self.assertTrue(client._oidc_credential_pending)
            with self.assertRaisesRegex(RuntimeError, "OIDC credential context is unavailable"):
                client._bind_platform_auth()

    def test_oidc_only_mode_preserves_explicit_external_provider_credential(self) -> None:
        from autogen_ext.models.openai import OpenAIChatCompletionClient

        def capture_init(client, **kwargs):
            client._raw_config = dict(kwargs)

        with (
            patch.dict(os.environ, {"OPENDRSAI_OIDC_ONLY": "1"}),
            patch.object(OpenAIChatCompletionClient, "__init__", capture_init),
        ):
            client = HepAIChatCompletionClient(
                model="deepseek-v4-flash",
                api_key="configured-provider-key",
                base_url="https://api.zhizengzeng.com/v1",
                allow_deferred_oidc=False,
                use_responses_api=True,
            )
        self.assertFalse(client._oidc_credential_pending)
        self.assertFalse(client._uses_platform_auth)
        self.assertEqual(client._raw_config["api_key"], "configured-provider-key")
        self.assertEqual(
            str(client._raw_config["base_url"]).rstrip("/"),
            "https://api.zhizengzeng.com/v1",
        )

    def test_external_provider_without_saved_key_does_not_fall_back_to_oidc(self) -> None:
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        with patch.dict(os.environ, {"HEPAI_API_KEY": ""}), platform_auth_scope(context):
            with self.assertRaisesRegex(RuntimeError, "provider API credential is unavailable"):
                HepAIChatCompletionClient(
                    model="deepseek-v4-flash",
                    api_key=None,
                    base_url="https://api.zhizengzeng.com/v1",
                    allow_deferred_oidc=False,
                )

    def test_external_client_recovers_saved_provider_credential_by_exact_base_url(self) -> None:
        from drsai.config.schema import SecretValue
        from autogen_ext.models.openai import OpenAIChatCompletionClient

        config = SimpleNamespace(providers={
            "zhizengzeng": SimpleNamespace(base_url="https://api.zhizengzeng.com/v1"),
        })
        resolved = SimpleNamespace(provider=SimpleNamespace(api_key=SecretValue("saved-provider-key")))

        def capture_init(client, **kwargs):
            client._raw_config = dict(kwargs)

        with (
            patch("drsai.config.load_user_config", return_value=config),
            patch("drsai.config.resolver.resolve_model_config", return_value=resolved) as resolver,
            patch.object(OpenAIChatCompletionClient, "__init__", capture_init),
        ):
            client = HepAIChatCompletionClient(
                model="deepseek-v4-flash",
                api_key=None,
                base_url="https://api.zhizengzeng.com/v1",
                allow_deferred_oidc=False,
            )

        self.assertEqual(client._raw_config["api_key"], "saved-provider-key")
        resolver.assert_called_once()

    def test_cached_model_client_rebinds_to_current_request(self) -> None:
        client = object.__new__(HepAIChatCompletionClient)
        client._client = SimpleNamespace(api_key="old-token", base_url="https://old.invalid/v1")
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        with platform_auth_scope(context):
            client._bind_platform_auth()
        self.assertEqual(client._client.api_key, context.access_token)
        self.assertEqual(client._client.base_url, "https://ai-dev.ihep.ac.cn/apiv2/v1")

        anthropic = object.__new__(HepAIAnthropicChatCompletionClient)
        anthropic._client = SimpleNamespace(api_key="old-token", base_url="https://old.invalid")
        with platform_auth_scope(context):
            anthropic._bind_platform_auth()
        self.assertEqual(anthropic._client.api_key, context.access_token)
        self.assertEqual(anthropic._client.base_url, "https://ai-dev.ihep.ac.cn/apiv2/anthropic")

    def test_openai_client_can_defer_credential_until_oidc_request_scope(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HEPAI_API_KEY", None)
            os.environ.pop("OPENAI_API_KEY", None)
            client = HepAIChatCompletionClient(
                model="deepseek-ai/deepseek-v4-pro",
                api_key=None,
                base_url="https://wrong.invalid/v1",
            )
        self.assertTrue(client._oidc_credential_pending)
        context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
        with platform_auth_scope(context):
            client._bind_platform_auth()
        self.assertFalse(client._oidc_credential_pending)
        self.assertEqual(client._client.api_key, context.access_token)
        self.assertEqual(str(client._client.base_url).rstrip("/"), context.model_base_url)

    def test_model_errors_are_structured_without_secret_content(self) -> None:
        class ProviderError(Exception):
            def __init__(self, status_code: int, message: str = "provider detail") -> None:
                super().__init__(message)
                self.status_code = status_code

        expected = {
            401: ("model_unauthorized", False),
            403: ("model_forbidden", False),
            404: ("model_not_found", False),
            429: ("quota_exceeded", True),
            503: ("upstream_unavailable", True),
        }
        for status, (code, retryable) in expected.items():
            result = classify_model_error(ProviderError(status, "secret-canary"))
            self.assertEqual((result["code"], result["retryable"]), (code, retryable))
            self.assertNotIn("secret-canary", str(result))
        unavailable = classify_model_error(ProviderError(400, "MODEL_UNAVAILABLE"))
        self.assertEqual(unavailable["code"], "model_not_found")
        expired = classify_model_error(ProviderError(401, "token expired"))
        self.assertEqual((expired["code"], expired["retryable"]), ("token_expired", True))
        invalid_token = classify_model_error(Exception("AuthenticationError: Error code: 401 - invalid_token"))
        self.assertEqual((invalid_token["code"], invalid_token["retryable"]), ("model_unauthorized", False))
        unavailable_credential = classify_model_error(RuntimeError(
            "The configured model provider API credential is unavailable"
        ))
        self.assertEqual(
            (unavailable_credential["code"], unavailable_credential["retryable"]),
            ("model_credential_unavailable", False),
        )
        local_budget = classify_model_error(ValueError("context_active_chain_budget_overflow"))
        self.assertEqual(
            (local_budget["code"], local_budget["retryable"]),
            ("context_budget_exhausted", False),
        )
        tool_contract = classify_model_error(ValueError("model_tool_not_in_snapshot:web_search"))
        self.assertEqual(
            (tool_contract["code"], tool_contract["retryable"]),
            ("model_tool_contract_violation", False),
        )

    def test_default_model_name_is_a_catalog_alias(self) -> None:
        from drsai.backend.run_drsai_agent_factory import DEFAULT_CONFIG_NAME, DEFAULT_LLM_MODE_CONFIG

        self.assertEqual(DEFAULT_CONFIG_NAME, "deepseek-v4-pro")
        self.assertIn(DEFAULT_CONFIG_NAME, DEFAULT_LLM_MODE_CONFIG)

    def test_real_openai_client_calls_fake_apiv2_with_oidc_bearer(self) -> None:
        captured: dict[str, str] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                captured["path"] = self.path
                captured["authorization"] = self.headers.get("Authorization", "")
                length = int(self.headers.get("Content-Length", "0"))
                self.rfile.read(length)
                payload = {
                    "id": "fake-completion",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "fake-model",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}/v1"
        try:
            with patch.dict(os.environ, {
                "OPENDRSAI_MODEL_BASE_URL": base_url,
                "DRSAI_ALLOW_INSECURE_MODEL_URL": "1",
            }):
                context = context_from_bearer(f"Bearer {self.valid_token()}", USER_ID)
                with platform_auth_scope(context):
                    client = HepAIChatCompletionClient(
                        model="fake-model",
                        api_key=None,
                        base_url=base_url,
                    )

                    async def call_provider() -> None:
                        await client._client.chat.completions.create(
                            model="fake-model",
                            messages=[{"role": "user", "content": "hello"}],
                        )
                        await client._client.close()

                    asyncio.run(call_provider())
            self.assertEqual(captured["path"], "/v1/chat/completions")
            self.assertEqual(captured["authorization"], f"Bearer {context.access_token}")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
