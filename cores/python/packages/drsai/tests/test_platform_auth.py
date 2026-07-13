from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
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
    verify_gateway_instance,
)
from drsai.modules.components.model_client.LLMClient import HepAIChatCompletionClient
from drsai.modules.components.model_client.anthropic._anthropic_client import HepAIAnthropicChatCompletionClient


def jwt(claims: dict[str, object]) -> str:
    def encode(value: dict[str, object]) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{encode({'alg': 'RS256', 'typ': 'JWT'})}.{encode(claims)}.test-signature"


class PlatformAuthTests(unittest.TestCase):
    def valid_token(self, subject: str = "user-1", issuer: str = "https://ai-dev.ihep.ac.cn/api") -> str:
        return jwt({"sub": subject, "iss": issuer, "exp": int(time.time()) + 600, "aud": "hai-api"})

    def test_development_context_selects_development_model_service(self) -> None:
        context = context_from_bearer(f"Bearer {self.valid_token()}", "user-1")
        self.assertEqual(context.subject, "user-1")
        self.assertEqual(context.model_base_url, "https://ai-dev.ihep.ac.cn/apiv2/v1")

    def test_production_context_selects_production_model_service(self) -> None:
        context = context_from_bearer(
            f"Bearer {self.valid_token(issuer='https://ai.ihep.ac.cn/api')}",
            "user-1",
        )
        self.assertEqual(context.model_base_url, "https://ai.ihep.ac.cn/apiv2/v1")

    def test_expired_and_mismatched_tokens_are_rejected(self) -> None:
        expired = jwt({"sub": "user-1", "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) - 1})
        with self.assertRaisesRegex(ValueError, "token_expired"):
            context_from_bearer(f"Bearer {expired}", "user-1")
        with self.assertRaisesRegex(ValueError, "subject_mismatch"):
            context_from_bearer(f"Bearer {self.valid_token()}", "user-2")

    def test_scope_is_isolated_between_concurrent_tasks(self) -> None:
        first = context_from_bearer(f"Bearer {self.valid_token('first')}", "first")
        second = context_from_bearer(f"Bearer {self.valid_token('second')}", "second")

        async def read_subject(context) -> str:
            with platform_auth_scope(context):
                await asyncio.sleep(0)
                current = get_platform_auth()
                return current.subject if current else "missing"

        async def run() -> list[str]:
            return await asyncio.gather(read_subject(first), read_subject(second))

        self.assertEqual(asyncio.run(run()), ["first", "second"])
        self.assertIsNone(get_platform_auth())

    def test_gateway_instance_token_uses_exact_constant_time_match(self) -> None:
        with patch.dict(os.environ, {"OPENDRSAI_GATEWAY_INSTANCE_TOKEN": "local-secret"}):
            self.assertTrue(verify_gateway_instance("local-secret"))
            self.assertFalse(verify_gateway_instance("wrong-secret"))
            self.assertFalse(verify_gateway_instance(None))

    def test_static_credential_provider_remains_available_without_oidc(self) -> None:
        provider = get_model_credential_provider("static-key", "https://provider.example/v1")
        self.assertIsNotNone(provider)
        self.assertEqual(provider.access_token, "static-key")
        self.assertEqual(provider.openai_base_url, "https://provider.example/v1")

    def test_oidc_only_mode_rejects_static_credential_fallback(self) -> None:
        with patch.dict(os.environ, {"OPENDRSAI_OIDC_ONLY": "1"}):
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

    def test_cached_model_client_rebinds_to_current_request(self) -> None:
        client = object.__new__(HepAIChatCompletionClient)
        client._client = SimpleNamespace(api_key="old-token", base_url="https://old.invalid/v1")
        context = context_from_bearer(f"Bearer {self.valid_token()}", "user-1")
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
        context = context_from_bearer(f"Bearer {self.valid_token()}", "user-1")
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
            401: ("token_expired", True),
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
                context = context_from_bearer(f"Bearer {self.valid_token()}", "user-1")
                with platform_auth_scope(context):
                    client = HepAIChatCompletionClient(
                        model="fake-model",
                        api_key="must-be-replaced",
                        base_url="https://wrong.invalid/v1",
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
