import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.drsai_adapter.personal_config_fetcher import (
    PersonalKeyConfigFetcher,
    should_fetch_personal_key,
)
from drsai_ui.env_load import webui_env_paths
from drsai_ui.ui_backend.backend.web.settings_store import (
    extract_model_api_key,
    stored_key_is_shared_env_key,
    upsert_settings_by_user_id,
)


def test_webui_env_paths_include_apps_webui_dotenv():
    paths = webui_env_paths()
    assert paths
    assert paths[0].name == ".env"
    assert paths[0].parent.name == "webui"


def test_should_fetch_personal_key_with_admin_key(monkeypatch):
    monkeypatch.delenv("SERVICE_MODE", raising=False)
    monkeypatch.setenv("HEPAI_APP_ADMIN_API_KEY", "sk-admin")
    assert should_fetch_personal_key() is True


def test_should_fetch_personal_key_requires_prod_or_admin(monkeypatch):
    monkeypatch.delenv("SERVICE_MODE", raising=False)
    monkeypatch.delenv("HEPAI_APP_ADMIN_API_KEY", raising=False)
    assert should_fetch_personal_key() is False
    monkeypatch.setenv("SERVICE_MODE", "PROD")
    assert should_fetch_personal_key() is True


def test_get_personal_key_fetches_when_admin_key_set(monkeypatch):
    monkeypatch.delenv("SERVICE_MODE", raising=False)
    monkeypatch.setenv("HEPAI_APP_ADMIN_API_KEY", "sk-admin")
    monkeypatch.setenv("HEPAI_API_KEY", "sk-shared-yqsun")
    fetcher = PersonalKeyConfigFetcher()
    client = MagicMock()
    client.fetch_api_key.return_value = MagicMock(api_key="sk-haiuser06")
    fetcher._client = client
    assert fetcher.get_personal_key("haiuser06@ihep.ac.cn") == "sk-haiuser06"
    client.fetch_api_key.assert_called_once_with(username="haiuser06@ihep.ac.cn")


def test_get_personal_key_uses_shared_for_science_user(monkeypatch):
    monkeypatch.setenv("HEPAI_API_KEY", "sk-shared")
    fetcher = PersonalKeyConfigFetcher()
    assert fetcher.get_personal_key("anyone", user_source="science_user") == "sk-shared"


def test_extract_and_detect_shared_key(monkeypatch):
    monkeypatch.setenv("HEPAI_API_KEY", "sk-shared")
    yaml_text = 'api_key: "sk-shared"\n'
    assert extract_model_api_key(yaml_text) == "sk-shared"
    assert stored_key_is_shared_env_key(yaml_text) is True
    assert stored_key_is_shared_env_key('api_key: "sk-other"') is False


class _Resp:
    def __init__(self, data, status=True):
        self.data = data
        self.status = status
        self.message = "ok"


class _FakeDb:
    def __init__(self, rows):
        self.rows = list(rows)
        self.upserted = None
        self.deleted_ids = []

    def get(self, _model, filters=None):
        user_id = (filters or {}).get("user_id")
        return _Resp([r for r in self.rows if r.user_id == user_id])

    def upsert(self, settings):
        self.upserted = settings
        return _Resp(settings)

    def delete(self, _model, filters=None):
        extra_id = (filters or {}).get("id")
        self.deleted_ids.append(extra_id)
        self.rows = [r for r in self.rows if r.id != extra_id]
        return _Resp(None)


def test_upsert_settings_by_user_id_collapses_duplicates():
    rows = [
        SimpleNamespace(id=20, uuid="new", created_at=datetime(2026, 9, 3), user_id="u@x"),
        SimpleNamespace(id=6, uuid="old", created_at=datetime(2026, 6, 25), user_id="u@x"),
    ]
    db = _FakeDb(rows)
    incoming = SimpleNamespace(id=None, uuid="fresh", created_at=None, user_id="u@x", config={"k": 1})
    result = upsert_settings_by_user_id(db, incoming)
    assert result.status is True
    assert incoming.id == 20
    assert incoming.uuid == "new"
    assert db.deleted_ids == [6]
