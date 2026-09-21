"""Regression coverage for the packaged Desktop's generated config tree."""

from __future__ import annotations

from pathlib import Path

import pytest
from drsai.config import ConfigError, ensure_desktop_runtime_config, load_user_config
from drsai.config.defaults import (
    DEFAULT_AGENT_CONFIG_FILE,
    DEFAULT_PROVIDER,
    provider_models_file,
)

_REPO_ROOT = Path(__file__).resolve().parents[5]
_PACKAGED_CONFIG = (
    _REPO_ROOT
    / "apps"
    / "desktop"
    / "windows"
    / "installer"
    / "defaults"
    / "drsai-home"
    / "config.toml"
)


def _fresh_packaged_config(tmp_path: Path) -> Path:
    target = tmp_path / ".drsai" / "config.toml"
    target.parent.mkdir(parents=True)
    target.write_bytes(_PACKAGED_CONFIG.read_bytes())
    return target


def _product_catalog(config_path: Path) -> Path:
    return config_path.parent / provider_models_file(DEFAULT_PROVIDER)


def test_packaged_config_bootstraps_its_missing_generated_tree(tmp_path: Path) -> None:
    config_path = _fresh_packaged_config(tmp_path)

    result = ensure_desktop_runtime_config(config_path)

    config = load_user_config(config_path)
    provider = config.providers[DEFAULT_PROVIDER]
    assert result.changed is True
    assert "sync_hepai_product_models" in result.actions
    assert _product_catalog(config_path).is_file()
    assert (config_path.parent / DEFAULT_AGENT_CONFIG_FILE).is_file()
    assert provider.models
    assert all(model.origin == "product" for model in provider.model_configs.values())
    assert not (
        config_path.parent / "configs/models/provider_hepai.local.toml"
    ).exists()


def test_packaged_bootstrap_is_idempotent(tmp_path: Path) -> None:
    config_path = _fresh_packaged_config(tmp_path)
    ensure_desktop_runtime_config(config_path)
    before = {
        path.relative_to(config_path.parent): path.read_bytes()
        for path in config_path.parent.rglob("*")
        if path.is_file()
    }

    result = ensure_desktop_runtime_config(config_path)
    after = {
        path.relative_to(config_path.parent): path.read_bytes()
        for path in config_path.parent.rglob("*")
        if path.is_file()
    }

    assert result.changed is False
    assert result.actions == ()
    assert after == before


def test_bootstrap_preserves_user_model_overlay(tmp_path: Path) -> None:
    config_path = _fresh_packaged_config(tmp_path)
    ensure_desktop_runtime_config(config_path)
    overlay = config_path.parent / "configs/models/provider_hepai.local.toml"
    overlay.parent.mkdir(parents=True, exist_ok=True)
    overlay.write_text(
        "[models.my-local-model]\n"
        'input_modalities = ["text"]\n'
        'output_modalities = ["text"]\n'
        'capabilities = ["chat"]\n'
        'api_protocol = "openai"\n'
        "enabled = true\n",
        encoding="utf-8",
    )
    original_overlay = overlay.read_bytes()
    _product_catalog(config_path).write_text("stale product catalog", encoding="utf-8")

    result = ensure_desktop_runtime_config(config_path)
    config = load_user_config(config_path)

    assert result.changed is True
    assert "sync_hepai_product_models" in result.actions
    assert overlay.read_bytes() == original_overlay
    assert (
        config.providers[DEFAULT_PROVIDER].model_configs["my-local-model"].origin
        == "user"
    )


def test_bootstrap_repairs_a_missing_or_damaged_product_catalog(tmp_path: Path) -> None:
    config_path = _fresh_packaged_config(tmp_path)
    product_catalog = _product_catalog(config_path)
    product_catalog.parent.mkdir(parents=True)
    product_catalog.write_text("not valid toml = [", encoding="utf-8")

    result = ensure_desktop_runtime_config(config_path)

    assert result.changed is True
    assert "sync_hepai_product_models" in result.actions
    assert load_user_config(config_path).providers[DEFAULT_PROVIDER].models


def test_bootstrap_rolls_back_generated_catalog_when_a_later_step_fails(
    tmp_path: Path,
) -> None:
    config_path = _fresh_packaged_config(tmp_path)
    original_config = config_path.read_bytes()
    agent_path = config_path.parent / DEFAULT_AGENT_CONFIG_FILE
    agent_path.parent.mkdir(parents=True)
    agent_path.write_text("this is not valid toml = [", encoding="utf-8")
    original_agent = agent_path.read_bytes()

    with pytest.raises((ConfigError, ValueError)):
        ensure_desktop_runtime_config(config_path)

    assert config_path.read_bytes() == original_config
    assert agent_path.read_bytes() == original_agent
    assert not _product_catalog(config_path).exists()
