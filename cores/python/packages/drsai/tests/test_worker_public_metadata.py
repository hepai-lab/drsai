from __future__ import annotations

import json
from types import SimpleNamespace

from drsai.backend.run import (
    build_public_agent_metadata,
    configure_worker_registration_metadata,
)
from drsai.utils.utils import environment_scoped_upload_filename, normalize_hepai_base_url


def test_file_upload_base_url_follows_controller_environment() -> None:
    assert normalize_hepai_base_url("https://ai-dev.ihep.ac.cn") == "https://ai-dev.ihep.ac.cn/apiv2"
    assert normalize_hepai_base_url("https://ai-dev.ihep.ac.cn/apiv2/") == "https://ai-dev.ihep.ac.cn/apiv2"
    assert normalize_hepai_base_url("http://localhost:42601") == "http://localhost:42601/apiv2"
    assert environment_scoped_upload_filename(
        "/srv/assets/logo.png", "https://ai-dev.ihep.ac.cn/apiv2"
    ) == "logo.ai-dev.ihep.ac.cn.png"


def test_worker_public_metadata_projects_display_fields_without_identity_or_secrets() -> None:
    metadata = build_public_agent_metadata(
        {
            "name": "ExampleAgent",
            "description": json.dumps({"zh": "示例", "en": "Example"}),
            "author": "Example Team",
            "version": "1.2.3",
            "logo": "https://files.example/asset/preview",
            "logo_asset_id": "file-public",
            "capabilities": ["chat", {"token": "must-not-leak"}],
            "examples": [{"zh": "你好", "en": "Hello", "owner": "forged"}],
            "api_key": "must-not-leak",
            "registration_principal": "forged-user",
            "owner": "forged-owner",
        }
    )

    assert metadata["schema_version"] == 1
    assert metadata["agent"] == {
        "display_name": "ExampleAgent",
        "name": "ExampleAgent",
        "description": {"zh": "示例", "en": "Example"},
        "author": "Example Team",
        "app_version": "1.2.3",
        "version": "1.2.3",
        "logo": "https://files.example/asset/preview",
        "logo_url": "https://files.example/asset/preview",
        "logo_asset_id": "file-public",
        "capabilities": ["chat", {}],
        "examples": [{"zh": "你好", "en": "Hello"}],
    }
    serialized = json.dumps(metadata)
    for forbidden in ("must-not-leak", "forged-user", "forged-owner", '"owner"', "registration_principal"):
        assert forbidden not in serialized


def test_worker_public_metadata_keeps_legacy_plain_description() -> None:
    metadata = build_public_agent_metadata(
        {"name": "Legacy", "description": "Plain description", "version": "0.9"}
    )

    assert metadata["agent"]["description"] == "Plain description"
    assert metadata["agent"]["app_version"] == "0.9"


def test_registration_configuration_aligns_model_version_and_sanitizes_metadata() -> None:
    worker_args = SimpleNamespace(
        _metadata={
            "category": "productivity",
            "api_key": "must-not-leak",
            "registration_principal": "forged-user",
        }
    )

    configure_worker_registration_metadata(
        {"name": "ExampleAgent", "description": "Example", "version": "2.4.0"},
        worker_args,
    )

    assert worker_args.model_version == "2.4.0"
    assert worker_args._metadata["category"] == "productivity"
    assert worker_args._metadata["schema_version"] == 1
    serialized = json.dumps(worker_args._metadata)
    assert "must-not-leak" not in serialized
    assert "forged-user" not in serialized
    assert "registration_principal" not in serialized
