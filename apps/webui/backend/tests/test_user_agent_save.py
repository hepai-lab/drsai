import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.agent_factory import agent_mode_cofigs as configs  # noqa: E402

PLATFORM_URL = "https://aiapi.ihep.ac.cn/apiv2"
USER_ID = "tester@ihep.ac.cn"
DDF_AGENT_ID = "7398cf95-6717-461b-b0b7-83faf4c97f86"
REMOTE_AGENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class FakeResponse:
    def __init__(self, data):
        rows = [] if data is None else (data if isinstance(data, list) else [data])
        self.status = True
        self.data = rows
        self.message = None


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list] = {}

    def get(self, model, filters=None, return_json=False):  # noqa: ARG002
        key = model.__name__
        rows = list(self.tables.get(key, []))
        if filters:
            matched = []
            for row in rows:
                ok = True
                for field, expected in filters.items():
                    actual = (
                        row.get(field)
                        if isinstance(row, dict)
                        else getattr(row, field, None)
                    )
                    if actual != expected:
                        ok = False
                        break
                if ok:
                    matched.append(row)
            rows = matched
        return FakeResponse(rows)

    def upsert(self, obj):
        key = type(obj).__name__
        if key == "SimpleNamespace":
            if hasattr(obj, "payload"):
                key = "UserRemoteAgent"
            elif hasattr(obj, "agents_mode"):
                key = "AgentModeSettings"
            elif hasattr(obj, "agents"):
                key = "UserDDFAgents"
        rows = self.tables.setdefault(key, [])
        user_id = getattr(obj, "user_id", None)
        agent_id = getattr(obj, "agent_id", None)
        replaced = False
        for i, row in enumerate(rows):
            same_user = getattr(row, "user_id", None) == user_id
            if agent_id and same_user and getattr(row, "agent_id", None) == agent_id:
                rows[i] = obj
                replaced = True
                break
            if (
                not agent_id
                and same_user
                and key in {"AgentModeSettings", "UserDDFAgents", "UserRemoteAgents"}
            ):
                rows[i] = obj
                replaced = True
                break
        if not replaced:
            rows.append(obj)
        return FakeResponse([obj])


def _ddf_row():
    return SimpleNamespace(
        user_id=USER_ID,
        platform_url=PLATFORM_URL,
        agents=[
            {
                "id": DDF_AGENT_ID,
                "name": "DocMaster",
                "mode": "ddf",
                "defult_config_name": "hepai/deepseek-v4-flash",
                "config": {"name": "DocMaster", "url": PLATFORM_URL},
            }
        ],
    )


def _remote_row():
    return SimpleNamespace(
        user_id=USER_ID,
        agent_id=REMOTE_AGENT_ID,
        mode="remote",
        name="My Remote",
        payload={
            "id": REMOTE_AGENT_ID,
            "mode": "remote",
            "name": "My Remote",
            "url": "https://example.test/apiv2",
            "defult_config_name": "old-model",
            "config": {
                "name": "My Remote",
                "url": "https://example.test/apiv2",
            },
        },
    )


def _patch_platform(monkeypatch):
    monkeypatch.setattr(
        configs,
        "get_active_platform",
        lambda: SimpleNamespace(base_url=PLATFORM_URL),
    )
    monkeypatch.setattr(
        configs,
        "get_default_agent_mode_config",
        lambda user_id=None, user_source=None: [],
    )


def test_put_patch_does_not_require_mode_for_ddf_agent(monkeypatch):
    _patch_platform(monkeypatch)
    db = FakeDB()
    db.tables["UserDDFAgents"] = [_ddf_row()]

    merged = configs.patch_user_agent(
        db,
        USER_ID,
        {"id": DDF_AGENT_ID, "defult_config_name": "gpt-5 (charge)"},
    )

    assert merged["defult_config_name"] == "gpt-5 (charge)"
    assert merged["name"] == "DocMaster"
    assert merged["mode"] == "ddf"
    assert db.tables.get("UserRemoteAgent", []) == []

    catalog = configs.find_catalog_agent(USER_ID, DDF_AGENT_ID, db)
    assert catalog is not None
    assert catalog["defult_config_name"] == "gpt-5 (charge)"


def test_put_patch_merges_owned_remote_without_wiping_payload(monkeypatch):
    _patch_platform(monkeypatch)
    db = FakeDB()
    db.tables["UserRemoteAgent"] = [_remote_row()]

    merged = configs.patch_user_agent(
        db,
        USER_ID,
        {"id": REMOTE_AGENT_ID, "defult_config_name": "gpt-5 (charge)"},
    )

    assert merged["defult_config_name"] == "gpt-5 (charge)"
    assert merged["name"] == "My Remote"
    assert merged["url"] == "https://example.test/apiv2"
    row = db.tables["UserRemoteAgent"][0]
    assert row.payload["name"] == "My Remote"
    assert row.payload["url"] == "https://example.test/apiv2"
    assert row.payload["defult_config_name"] == "gpt-5 (charge)"


def test_put_patch_unknown_agent_is_404(monkeypatch):
    _patch_platform(monkeypatch)
    db = FakeDB()
    with pytest.raises(HTTPException) as exc:
        configs.patch_user_agent(
            db,
            USER_ID,
            {"id": "missing-id", "defult_config_name": "gpt-5 (charge)"},
        )
    assert exc.value.status_code == 404


def test_put_patch_requires_agent_id(monkeypatch):
    _patch_platform(monkeypatch)
    db = FakeDB()
    with pytest.raises(HTTPException) as exc:
        configs.patch_user_agent(db, USER_ID, {"defult_config_name": "gpt-5 (charge)"})
    assert exc.value.status_code == 400


def test_pref_stub_does_not_become_a_catalog_agent():
    defaults = [
        {
            "id": "default-1",
            "name": "Builtin",
            "mode": "remote",
            "defult_config_name": "old",
        }
    ]
    stored = [
        {"id": "default-1", "defult_config_name": "gpt-5 (charge)"},
        {"id": DDF_AGENT_ID, "defult_config_name": "gpt-5 (charge)"},
    ]
    merged = configs._apply_stored_agents_mode(defaults, stored)
    assert len(merged) == 1
    assert merged[0]["id"] == "default-1"
    assert merged[0]["name"] == "Builtin"
    assert merged[0]["defult_config_name"] == "gpt-5 (charge)"
