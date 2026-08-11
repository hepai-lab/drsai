from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from drsai.backend import gateway


def test_legacy_model_config_routes_are_explicitly_deprecated() -> None:
    schema = gateway.app.openapi()
    for path, method in (
        ("/v1/models/config", "get"),
        ("/v1/models/config", "post"),
        ("/v1/models/config/{alias}", "get"),
        ("/v1/models/config/{alias}", "put"),
        ("/v1/models/config/{alias}", "delete"),
        ("/v1/models/config/default/{alias}", "put"),
    ):
        assert schema["paths"][path][method]["deprecated"] is True


def test_legacy_catalog_reader_can_be_disabled_independently(monkeypatch) -> None:
    monkeypatch.setenv("DRSAI_LEGACY_MODEL_CONFIG_READ", "false")
    with pytest.raises(HTTPException) as captured:
        asyncio.run(gateway.list_model_configs())
    assert captured.value.status_code == 410
    assert captured.value.detail == {
        "code": "legacy_model_catalog_disabled",
        "message": "The legacy model catalog compatibility reader is disabled.",
        "replacement": "/v1/config/runtime-models",
    }


def test_legacy_catalog_reader_defaults_to_one_version_compatibility(monkeypatch) -> None:
    monkeypatch.delenv("DRSAI_LEGACY_MODEL_CONFIG_READ", raising=False)
    gateway._require_legacy_model_config_read()
