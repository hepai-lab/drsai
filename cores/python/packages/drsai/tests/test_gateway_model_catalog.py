from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from drsai.backend import gateway
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


def _auth() -> PlatformAuthContext:
    return PlatformAuthContext(
        access_token="test-access-token",
        subject="d30fc87e-f83d-4f3c-a145-bd1b77b7fde3",
        issuer="https://ai-dev.ihep.ac.cn/api",
        expires_at=4_102_444_800,
        model_base_url="https://ai-dev.ihep.ac.cn/apiv2/v1",
    )


class _Response:
    def __init__(self, status_code: int, payload: object):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _Client:
    def __init__(self, response: _Response):
        self.response = response
        self.get = AsyncMock(return_value=response)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class GatewayModelCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_oidc_catalog_is_loaded_from_the_authenticated_platform(self):
        client = _Client(_Response(200, {"data": [{"id": "deepseek-ai/deepseek-v4-pro", "name": "DeepSeek V4 Pro"}]}))
        with patch.object(gateway.httpx, "AsyncClient", return_value=client):
            with platform_auth_scope(_auth()):
                result = await gateway.list_models()

        self.assertEqual(result["data"][0]["id"], "deepseek-ai/deepseek-v4-pro")
        client.get.assert_awaited_once_with(
            "https://ai-dev.ihep.ac.cn/apiv2/v1/models",
            headers={"Authorization": "Bearer test-access-token"},
        )

    async def test_upstream_forbidden_remains_a_forbidden_result(self):
        client = _Client(_Response(403, {"error": {"code": "model_forbidden", "message": "No entitlement"}}))
        with patch.object(gateway.httpx, "AsyncClient", return_value=client):
            with platform_auth_scope(_auth()):
                with self.assertRaises(HTTPException) as raised:
                    await gateway.list_models()

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.detail["code"], "model_forbidden")
        self.assertFalse(raised.exception.detail["retryable"])

    async def test_upstream_server_failure_is_retryable_and_not_permission_denied(self):
        client = _Client(_Response(503, {"error": {"message": "Try later"}}))
        with patch.object(gateway.httpx, "AsyncClient", return_value=client):
            with platform_auth_scope(_auth()):
                with self.assertRaises(HTTPException) as raised:
                    await gateway.list_models()

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail["code"], "upstream_unavailable")
        self.assertTrue(raised.exception.detail["retryable"])


if __name__ == "__main__":
    unittest.main()
