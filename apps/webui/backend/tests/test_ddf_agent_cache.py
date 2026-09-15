import asyncio
import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.agent_factory import agent_mode_cofigs as configs  # noqa: E402

PLATFORM_URL = "https://aiapi.ihep.ac.cn/apiv2"
USER_ID = "juzy@ihep.ac.cn"


class FakeResponse:
    def __init__(self, data):
        if data is None:
            self.status = False
            self.data = []
        else:
            self.status = True
            self.data = data if isinstance(data, list) else [data]


class FakeDB:
    def __init__(self, row=None):
        self.row = row
        self.deleted = False
        self.upserted = None

    def get(self, _model, filters=None):  # noqa: ARG002
        if self.row is None:
            return FakeResponse([])
        return FakeResponse([self.row])

    def upsert(self, obj):
        self.upserted = obj
        self.row = obj
        return FakeResponse([obj])

    def delete(self, _model, filters=None):  # noqa: ARG002
        self.deleted = True
        self.row = None
        return FakeResponse([])


def _cached_row(name="DocMaster-test"):
    return SimpleNamespace(
        user_id=USER_ID,
        updated_at=datetime.now(),
        agents=[
            {
                "name": name,
                "mode": "ddf",
                "id": "cached-id",
                "config": {"name": name, "url": PLATFORM_URL},
            }
        ],
    )


def _patch_platform(monkeypatch):
    monkeypatch.setattr(
        configs,
        "get_active_platform",
        lambda: SimpleNamespace(base_url=PLATFORM_URL),
    )
    monkeypatch.setattr(
        configs,
        "_resolve_platform_api_key",
        lambda *args, **kwargs: "sk-test",
    )


def _hepai_with_models(models):
    class FakeHepAI:
        def __init__(self, api_key, base_url):  # noqa: ARG002
            self.agents = SimpleNamespace(list=lambda: SimpleNamespace(data=models))

    return FakeHepAI


def test_successful_empty_list_clears_last_cached_ddf_agent(monkeypatch):
    _patch_platform(monkeypatch)
    monkeypatch.setattr(configs, "HepAI", _hepai_with_models([]))
    db = FakeDB(_cached_row())

    result = asyncio.run(
        configs.get_ddf_agents(
            USER_ID,
            authorization="Bearer sk-test",
            is_refresh=True,
            db=db,
        )
    )

    assert result == {"status": True, "data": []}
    assert db.deleted is True
    assert db.upserted is None


def test_list_exception_keeps_cached_ddf_agent(monkeypatch):
    _patch_platform(monkeypatch)

    class BoomHepAI:
        def __init__(self, api_key, base_url):  # noqa: ARG002
            self.agents = SimpleNamespace(list=self._list)

        def _list(self):
            raise RuntimeError("hepai down")

    monkeypatch.setattr(configs, "HepAI", BoomHepAI)
    db = FakeDB(_cached_row())

    result = asyncio.run(
        configs.get_ddf_agents(
            USER_ID,
            authorization="Bearer sk-test",
            is_refresh=True,
            db=db,
        )
    )

    assert result["status"] is True
    assert result["data"][0]["name"] == "DocMaster-test"
    assert db.deleted is False


def test_listed_workers_with_all_get_info_failures_keep_cache(monkeypatch):
    _patch_platform(monkeypatch)
    monkeypatch.setattr(configs, "HepAI", _hepai_with_models([{"id": "worker/docmaster-test"}]))

    class FakeHRModel:
        @staticmethod
        def connect(**kwargs):  # noqa: ARG004
            class Worker:
                def get_info(self):
                    raise TimeoutError("worker stopped")

            return Worker()

    monkeypatch.setattr(configs, "HRModel", FakeHRModel)
    db = FakeDB(_cached_row())

    result = asyncio.run(
        configs.get_ddf_agents(
            USER_ID,
            authorization="Bearer sk-test",
            is_refresh=True,
            db=db,
        )
    )

    assert result["data"][0]["name"] == "DocMaster-test"
    assert db.deleted is False


def test_partial_get_info_success_drops_dead_workers(monkeypatch):
    _patch_platform(monkeypatch)
    monkeypatch.setattr(
        configs,
        "HepAI",
        _hepai_with_models([{"id": "worker/alive"}, {"id": "worker/dead"}]),
    )

    class FakeHRModel:
        @staticmethod
        def connect(*, name, **kwargs):  # noqa: ARG004
            class Worker:
                def get_info(self):
                    if name == "worker/dead":
                        raise TimeoutError("down")
                    return {
                        "name": "AliveAgent",
                        "author": USER_ID,
                    }

            return Worker()

    monkeypatch.setattr(configs, "HRModel", FakeHRModel)
    db = FakeDB(_cached_row())

    result = asyncio.run(
        configs.get_ddf_agents(
            USER_ID,
            authorization="Bearer sk-test",
            is_refresh=True,
            db=db,
        )
    )

    names = [agent["name"] for agent in result["data"]]
    assert names == ["AliveAgent"]
    assert db.deleted is False
    assert db.upserted is not None
    assert db.upserted.agents[0]["name"] == "AliveAgent"
