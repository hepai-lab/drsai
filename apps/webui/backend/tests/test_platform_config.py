from pathlib import Path
import sys
import types

import pytest

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.platform_config import (
    DEFAULT_PLATFORMS,
    get_active_platform,
    get_config_path,
)


def test_default_platform_is_created_when_config_is_missing(tmp_path):
    config = tmp_path / "nested" / "config.toml"
    platform = get_active_platform(config)

    assert platform.name == "production"
    assert platform.portal_url == "https://ai.ihep.ac.cn"
    assert platform.base_url == "https://aiapi.ihep.ac.cn/apiv2"
    assert platform.oidc_issuer == "https://ai.ihep.ac.cn/api"
    assert config.is_file()
    assert 'active_platform = "production"' in config.read_text(encoding="utf-8")
    assert "[platforms.development]" in config.read_text(encoding="utf-8")


def test_active_development_platform_uses_builtin_profile(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text('active_platform = "development"\n', encoding="utf-8")

    platform = get_active_platform(config)

    assert platform.name == "development"
    assert platform.portal_url == "https://ai-dev.ihep.ac.cn"
    assert platform.base_url == "https://ai-dev.ihep.ac.cn/apiv2"
    assert platform.oidc_issuer == "https://ai-dev.ihep.ac.cn/api"


def test_custom_profile_overrides_urls_and_normalizes_trailing_slashes(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text(
        """
active_platform = "local"

[platforms.local]
portal_url = "http://localhost:3000/"
base_url = "http://localhost:8000/v1/"
""".strip(),
        encoding="utf-8",
    )

    platform = get_active_platform(config)

    assert platform.portal_url == "http://localhost:3000"
    assert platform.base_url == "http://localhost:8000/v1"
    assert platform.oidc_issuer == "http://localhost:3000/api"


def test_builtin_profile_can_be_overridden(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text(
        """
[platforms.production]
base_url = "https://models.example.test/v1"
""".strip(),
        encoding="utf-8",
    )

    platform = get_active_platform(config)

    assert platform.portal_url == DEFAULT_PLATFORMS["production"]["portal_url"]
    assert platform.base_url == "https://models.example.test/v1"


def test_existing_config_is_not_overwritten(tmp_path):
    config = tmp_path / "config.toml"
    original = 'active_platform = "development"\n'
    config.write_text(original, encoding="utf-8")

    platform = get_active_platform(config)

    assert platform.name == "development"
    assert config.read_text(encoding="utf-8") == original


def test_unknown_or_invalid_platform_is_rejected(tmp_path):
    unknown = tmp_path / "unknown.toml"
    unknown.write_text('active_platform = "unknown"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="Unknown platform"):
        get_active_platform(unknown)

    invalid = tmp_path / "invalid.toml"
    invalid.write_text(
        """
active_platform = "invalid"
[platforms.invalid]
portal_url = "not-a-url"
base_url = "https://example.test/v1"
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="portal_url"):
        get_active_platform(invalid)


def test_config_path_uses_drsai_home(monkeypatch, tmp_path):
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    assert get_config_path() == Path(tmp_path) / "config.toml"
