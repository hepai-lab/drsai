import asyncio
import sys
import types
from pathlib import Path

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.drsai_adapter.sso import science_user_router as csns  # noqa: E402
from drsai_ui.drsai_adapter.sso.science_user_router import (  # noqa: E402
    _csns_verify_form,
    _extract_csns_user_id,
    _mask_secret,
    _resolve_user_agent_id,
)


def _ok(result):
    return {"result": result, "code": 200, "stauts": "success"}


def test_identity_comes_from_cstnet_id():
    body = _ok({"cstnetId": "guantz@ihep.ac.cn"})
    assert _resolve_user_agent_id(body, email="") == "guantz@ihep.ac.cn"


def test_matching_url_email_is_allowed():
    body = _ok({"cstnetId": "GuanTz@IHEP.ac.cn"})
    assert (
        _resolve_user_agent_id(body, email="  guantz@ihep.ac.cn ")
        == "guantz@ihep.ac.cn"
    )


def test_url_email_mismatch_is_rejected():
    body = _ok({"cstnetId": "from-api@ihep.ac.cn"})
    assert _resolve_user_agent_id(body, email="url@ihep.ac.cn") is None


def test_empty_result_rejected_even_with_url_email():
    body = _ok({})
    assert _resolve_user_agent_id(body, email="guantz@ihep.ac.cn") is None


def test_empty_cstnet_id_rejected_even_with_url_email():
    body = _ok({"cstnetId": ""})
    assert _resolve_user_agent_id(body, email="guantz@ihep.ac.cn") is None


def test_invalid_token_rejects_even_with_email():
    body = {"result": {"cstnetId": "guantz@ihep.ac.cn"}, "code": 401, "stauts": "fail"}
    assert _resolve_user_agent_id(body, email="guantz@ihep.ac.cn") is None


def test_extract_requires_non_empty_result():
    assert _extract_csns_user_id(_ok({})) is None
    assert _extract_csns_user_id(_ok({"cstnetId": "a@ihep.ac.cn"})) == "a@ihep.ac.cn"


def test_mask_secret_keeps_prefix_and_suffix():
    assert _mask_secret("7b2fefc56a2332eef4da7e510738fd1e") == "7b2f...fd1e"
    assert _mask_secret("short") == "***"
    assert _mask_secret("") == ""


def test_verify_form_includes_fixed_key(monkeypatch):
    monkeypatch.delenv("USER_AGENT_VERIFY_KEY", raising=False)
    monkeypatch.delenv("CSNS_VERIFY_TOKEN_KEY", raising=False)
    form = _csns_verify_form("abc123def456")
    assert form == {
        "token": "abc123def456",
        "key": "3a4dec8389aa11e899fffa163e84aab7",
    }


def test_verify_form_key_can_be_overridden(monkeypatch):
    monkeypatch.setenv("USER_AGENT_VERIFY_KEY", "override-key")
    form = _csns_verify_form("tok")
    assert form["key"] == "override-key"


def test_identity_from_data_cstnet_id():
    body = {"data": {"cstnetId": "guantz@ihep.ac.cn"}, "code": 200, "status": "success"}
    assert _resolve_user_agent_id(body) == "guantz@ihep.ac.cn"


def test_fetch_csns_user_posts_token_and_key(monkeypatch):
    captured = {}

    class _Resp:
        status_code = 200
        text = '{"result":{"cstnetId":"a@ihep.ac.cn"},"code":200,"stauts":"success"}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"result": {"cstnetId": "a@ihep.ac.cn"}, "code": 200, "stauts": "success"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def post(self, url, data=None, headers=None, **_kwargs):
            captured["url"] = url
            captured["data"] = dict(data or {})
            captured["headers"] = dict(headers or {})
            return _Resp()

    monkeypatch.delenv("USER_AGENT_VERIFY_API", raising=False)
    monkeypatch.delenv("CSNS_VERIFY_TOKEN_API", raising=False)
    monkeypatch.delenv("USER_AGENT_VERIFY_KEY", raising=False)
    monkeypatch.delenv("CSNS_VERIFY_TOKEN_KEY", raising=False)
    monkeypatch.setattr(csns.httpx, "AsyncClient", lambda **_kwargs: _Client())

    body = asyncio.run(csns._fetch_csns_user("abc123def456"))
    assert captured["url"] == "https://user.csns.ihep.ac.cn/api/token/verify"
    assert captured["data"] == {
        "token": "abc123def456",
        "key": "3a4dec8389aa11e899fffa163e84aab7",
    }
    assert captured["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert body["result"]["cstnetId"] == "a@ihep.ac.cn"
