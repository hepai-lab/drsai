from __future__ import annotations

import asyncio
import base64
from types import SimpleNamespace

import pytest
from autogen_core import CancellationToken

from drsai.backend import gateway
from drsai.backend.runtime.agent_kernel import build_citation_evidence, build_tool_decision_requirement
from drsai.backend.runtime.agent_kernel import build_execution_tool_registry, normalize_kernel_host_port
from drsai.backend.runtime.web_search.bing_playwright import (
    PlaywrightSearchConfig,
    WebSearchRuntimeError,
    _extract_search_rows,
    _launch_candidates,
    _result_matches_query,
    _search_locale,
    search_bing_with_playwright,
    web_search_runtime_status,
)
from drsai.backend.runtime.web_search.contracts import (
    WebSearchCandidate,
    WebSearchResponse,
    WebSearchResult,
    normalize_max_results,
    normalize_query,
    plan_search_query,
)
from drsai.backend.runtime.web_search.url_safety import (
    UnsafeWebUrl,
    ensure_public_url,
    validate_url_shape,
)
from drsai.config.agent_model_policy import AgentKnowledgePolicy, AgentSkillPolicy, AgentToolPolicy
from drsai.modules.agents.skills_agent.drsai_assistant import _desktop_execution_metadata


def test_web_search_contract_is_bounded_and_stable() -> None:
    assert normalize_query("  HEPiX   2026  ") == "HEPiX 2026"
    assert normalize_max_results(10) == 10
    with pytest.raises(ValueError, match="query_required"):
        normalize_query("   ")
    with pytest.raises(ValueError, match="query_too_long"):
        normalize_query("x" * 501)
    with pytest.raises(ValueError, match="max_results_invalid"):
        normalize_max_results(11)

    payload = WebSearchResponse(
        query="HEPiX 2026",
        results=(WebSearchResult(1, "HEPiX", "https://www.hepix.org/", "source"),),
        retrieved_at="2026-08-08T00:00:00Z",
    ).public_dict()
    assert payload == {
        "version": 1,
        "query": "HEPiX 2026",
        "provider": "bing-playwright",
        "retrieved_at": "2026-08-08T00:00:00Z",
        "results": [{
            "rank": 1,
            "title": "HEPiX",
            "url": "https://www.hepix.org/",
            "snippet": "source",
            "content": "",
            "content_sha256": "",
            "score": None,
        }],
        "partial": False,
        "warnings": [],
    }


@pytest.mark.parametrize(("requested", "effective", "reason"), [
    ("hepix2026是什么", "hepix 2026", "entity_definition+alphanumeric_boundary"),
    ("What is HEPiX2026?", "HEPiX 2026", "entity_definition+alphanumeric_boundary"),
    ("OpenAI o3是什么？", "OpenAI o3", "entity_definition"),
    ("什么值得买是什么", "什么值得买是什么", ""),
    ("2026年有什么会议", "2026年有什么会议", ""),
])
def test_query_planner_only_rewrites_high_confidence_entity_questions(
    requested: str, effective: str, reason: str,
) -> None:
    plan = plan_search_query(requested)

    assert plan.requested_query == requested
    assert plan.effective_query == effective
    assert plan.rewrite_reason == reason


def test_query_plan_is_visible_but_search_candidates_remain_private() -> None:
    response = WebSearchResponse(
        query="hepix 2026",
        requested_query="hepix2026是什么",
        rewrite_reason="entity_definition+alphanumeric_boundary",
        results=(),
    )

    payload = response.public_dict()
    inspection = response.inspection_dict()
    assert payload["query"] == "hepix 2026"
    assert payload["requested_query"] == "hepix2026是什么"
    assert inspection["effective_query"] == "hepix 2026"
    assert inspection["requested_query"] == "hepix2026是什么"


def test_model_visible_function_schema_matches_p1_contract() -> None:
    from drsai.backend.runtime.web_search import create_web_search_tool

    schema = create_web_search_tool().schema

    assert schema["name"] == "web_search"
    assert schema["parameters"]["required"] == ["query"]
    assert schema["parameters"]["additionalProperties"] is False
    assert schema["parameters"]["properties"]["query"]["maxLength"] == 500
    assert schema["parameters"]["properties"]["max_results"]["minimum"] == 1
    assert schema["parameters"]["properties"]["max_results"]["maximum"] == 10
    assert "cancellation_token" not in schema["parameters"]["properties"]


def test_web_search_base_tool_executes_the_same_validated_contract(monkeypatch) -> None:
    from drsai.backend.runtime.web_search import create_web_search_tool

    captured = []

    async def fake_search(query, max_results, cancellation_token):
        captured.append((query, max_results, cancellation_token))
        return {"version": 1, "query": query, "results": []}

    monkeypatch.setattr("drsai.backend.runtime.web_search.tool.web_search", fake_search)
    token = CancellationToken()
    result = asyncio.run(create_web_search_tool().run_json(
        {"query": "HEPiX 2026", "max_results": 3},
        token,
    ))

    assert result == {"version": 1, "query": "HEPiX 2026", "results": []}
    assert captured == [("HEPiX 2026", 3, token)]


def test_web_search_cancellation_terminates_inflight_browser_task(monkeypatch) -> None:
    from drsai.backend.runtime.web_search.tool import web_search

    started = asyncio.Event()

    async def slow_search(_query, _max_results):
        started.set()
        await asyncio.sleep(60)

    monkeypatch.setattr(
        "drsai.backend.runtime.web_search.tool.search_bing_with_playwright",
        slow_search,
    )

    async def scenario() -> None:
        token = CancellationToken()
        task = asyncio.create_task(web_search("HEPiX", cancellation_token=token))
        await started.wait()
        token.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())


def test_web_search_total_timeout_has_actionable_error(monkeypatch) -> None:
    async def slow_search(*_args, **_kwargs):
        await asyncio.sleep(60)

    monkeypatch.setattr(
        "drsai.backend.runtime.web_search.bing_playwright._search_once",
        slow_search,
    )

    with pytest.raises(WebSearchRuntimeError, match="search_timeout") as failed:
        asyncio.run(search_bing_with_playwright(
            "HEPiX",
            config=PlaywrightSearchConfig(total_timeout_seconds=0.01),
        ))
    assert failed.value.code == "search_timeout"


def test_web_search_browser_close_has_actionable_error(monkeypatch) -> None:
    TargetClosedError = type("TargetClosedError", (Exception,), {})

    async def closed_search(*_args, **_kwargs):
        raise TargetClosedError("browser closed")

    monkeypatch.setattr(
        "drsai.backend.runtime.web_search.bing_playwright._search_once",
        closed_search,
    )

    with pytest.raises(WebSearchRuntimeError, match="browser_unavailable") as failed:
        asyncio.run(search_bing_with_playwright("HEPiX"))
    assert failed.value.code == "browser_unavailable"


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "https://user:secret@example.org/",
    "javascript:alert(1)",
])
def test_url_shape_rejects_non_public_targets(url: str) -> None:
    with pytest.raises(UnsafeWebUrl):
        validate_url_shape(url)


def test_dns_admission_rejects_rebinding_to_private_network() -> None:
    def private_resolver(*_args, **_kwargs):
        return [(2, 1, 6, "", ("10.0.0.8", 443))]

    def public_resolver(*_args, **_kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 443))]

    assert asyncio.run(ensure_public_url("https://example.org/path", resolver=public_resolver)) == "https://example.org/path"
    with pytest.raises(UnsafeWebUrl, match="private_denied"):
        asyncio.run(ensure_public_url("https://example.org/path", resolver=private_resolver))


class _RowsLocator:
    def __init__(self, rows):
        self.rows = rows

    async def evaluate_all(self, _script):
        return self.rows


class _RowsPage:
    def __init__(self, rows):
        self.rows = rows

    def locator(self, selector):
        assert selector == "li.b_algo"
        return _RowsLocator(self.rows)


def test_bing_dom_rows_are_normalized_deduplicated_and_limited() -> None:
    target = "https://conference.example/hepix-2026"
    encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
    rows = asyncio.run(_extract_search_rows(_RowsPage([
        {"title": " Result one ", "url": f"https://www.bing.com/ck/a?u=a1{encoded}", "snippet": " first  result "},
        {"title": "Duplicate", "url": f"{target}#other", "snippet": "duplicate"},
        {"title": "Bing navigation", "url": "https://www.bing.com/help", "snippet": "ignore"},
        {"title": "Result two", "url": "https://example.net/two", "snippet": "second"},
    ]), 2))

    assert rows == [
        {"title": "Result one", "url": target, "snippet": "first result"},
        {"title": "Result two", "url": "https://example.net/two", "snippet": "second"},
    ]


def test_search_result_relevance_gate_rejects_search_engine_poisoning() -> None:
    assert _result_matches_query({
        "title": "HEPiX Spring 2026 Workshop",
        "url": "https://indico.example/hepix/2026",
        "snippet": "Computing infrastructure workshop",
    }, "HEPiX 2026") is True
    assert _result_matches_query({
        "title": "Free online games",
        "url": "https://games.example/",
        "snippet": "Play browser games",
    }, "HEPiX 2026") is False
    assert _result_matches_query({
        "title": "Python programming language",
        "url": "https://www.python.org/",
        "snippet": "Official site",
    }, "Python programming language official") is True
    assert _result_matches_query({
        "title": "High energy physics computing conference 2026",
        "url": "https://unrelated.example/events/2026",
        "snippet": "A computing workshop",
    }, "HEPiX high energy physics computing 2026") is False
    assert _result_matches_query({
        "title": "HEPiX computing coordination forum",
        "url": "https://www.hepix.org/",
        "snippet": "High energy physics infrastructure",
    }, "hepix是什么") is True
    assert _result_matches_query({
        "title": "HEPiX computing coordination forum",
        "url": "https://www.hepix.org/",
        "snippet": "High energy physics infrastructure",
    }, "HEPiX 2026") is False


def test_search_locale_tracks_effective_query_without_forcing_country() -> None:
    assert _search_locale("HEPiX 2026") == ("en-US", "en-us")
    assert _search_locale("量子计算 最新进展") == ("zh-CN", "zh-hans")


def test_search_executes_effective_query_and_preserves_requested_query(monkeypatch) -> None:
    captured = []

    async def fake_search(query, max_results, _settings):
        captured.append((query, max_results))
        return WebSearchResponse(query=query, results=())

    monkeypatch.setattr(
        "drsai.backend.runtime.web_search.bing_playwright._search_once",
        fake_search,
    )
    response = asyncio.run(search_bing_with_playwright("hepix2026是什么", 3))

    assert captured == [("hepix 2026", 3)]
    assert response.query == "hepix 2026"
    assert response.requested_query == "hepix2026是什么"


def test_empty_search_is_a_structured_partial_success() -> None:
    payload = WebSearchResponse(
        query="HEPiX 2026",
        results=(),
        partial=True,
        warnings=("no_results",),
    ).public_dict()

    assert payload["results"] == []
    assert payload["partial"] is True
    assert payload["warnings"] == ["no_results"]


def test_search_candidates_are_inspection_only_and_include_filter_reasons() -> None:
    response = WebSearchResponse(
        query="HEPiX 2026",
        results=(),
        candidates=(WebSearchCandidate(
            1, "Unrelated result", "https://example.org/unrelated", "A bounded snippet",
            accepted=False, reason="query_mismatch",
        ),),
    )

    assert "candidates" not in response.public_dict()
    inspection = response.inspection_dict()
    assert inspection["candidate_count"] == 1
    assert inspection["accepted_count"] == 0
    assert inspection["candidates"][0] == {
        "rank": 1,
        "title": "Unrelated result",
        "url": "https://example.org/unrelated",
        "domain": "example.org",
        "snippet": "A bounded snippet",
        "accepted": False,
        "reason": "query_mismatch",
    }


def test_windows_browser_candidates_prefer_installed_channels(monkeypatch) -> None:
    monkeypatch.delenv("DRSAI_PLAYWRIGHT_EXECUTABLE_PATH", raising=False)
    monkeypatch.setattr("drsai.backend.runtime.web_search.bing_playwright.sys.platform", "win32")
    assert _launch_candidates() == [{"channel": "msedge"}, {"channel": "chrome"}, {}]


def test_runtime_reports_installed_windows_browser_and_gateway_capability(monkeypatch, tmp_path) -> None:
    executable = tmp_path / "msedge.exe"
    executable.touch()
    monkeypatch.setenv("DRSAI_PLAYWRIGHT_EXECUTABLE_PATH", str(executable))
    monkeypatch.setattr(
        "drsai.backend.runtime.web_search.bing_playwright.importlib.util.find_spec",
        lambda _name: object(),
    )
    assert web_search_runtime_status() == {"status": "available", "error": None}
    monkeypatch.setattr(gateway, "_tool_agent_references", lambda _tool_id: ["opendrsai"])

    payload = asyncio.run(gateway.get_tool_capabilities("builtin.web-search"))

    assert payload["status"] == "available"
    assert payload["references"] == ["opendrsai"]
    assert "network.public_https" in payload["capabilities"]


def test_agent_tool_preview_reports_web_search_runtime_state(monkeypatch) -> None:
    async def no_remote_tools():
        return [], None

    monkeypatch.setattr(gateway, "load_agent_runtime_policy", lambda _agent_id: _runtime_policy())
    monkeypatch.setattr(gateway, "list_tool_resources", lambda _config_dir: ())
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "web_search_runtime_status", lambda: {"status": "available", "error": None})

    preview = asyncio.run(gateway.preview_agent_tools("opendrsai"))
    web = next(row for row in preview["tools"] if row["tool_id"] == "builtin.web-search")

    assert web["selected"] is True
    assert web["status"] == "available"
    assert "network.public_https" in web["capabilities"]


def test_web_search_is_read_only_without_approval_and_requires_network_capability() -> None:
    metadata = _desktop_execution_metadata("web_search", "workbench:web_search")

    assert metadata["risk"] == "read_only"
    assert metadata["approval_mode"] == "none"
    assert metadata["required_capabilities"] == ["web_search", "network.public_https"]


def test_web_search_capabilities_survive_host_negotiation_and_tool_registration() -> None:
    """A normal chat must not fail while merely registering the available search tool."""
    from drsai.backend.runtime.web_search import create_web_search_tool

    host_port = normalize_kernel_host_port({
        "schema_version": 1,
        "protocol_version": "p9-host-port-v1",
        "surface": "desktop",
        "capabilities": [
            {"id": "chat", "version": 1, "required": True},
            {"id": "web_search", "version": 1, "required": False},
            {"id": "network.public_https", "version": 1, "required": False},
        ],
    }, surface="desktop")
    tool = create_web_search_tool()
    metadata = {"web_search": _desktop_execution_metadata("web_search", "workbench:web_search")}

    registry = build_execution_tool_registry(
        "desktop",
        [tool],
        metadata,
        host_port["capabilities"],
    )

    assert host_port["capabilities"] == ["chat", "network.public_https", "web_search"]
    assert registry["tools"][0]["name"] == "web_search"


def _runtime_policy(*, disabled=()):
    return SimpleNamespace(
        revision="sha256:" + "a" * 64,
        tools=AgentToolPolicy(mode="inherit", disabled=tuple(disabled)),
        skills=AgentSkillPolicy(mode="inherit"),
        knowledge=AgentKnowledgePolicy(),
    )


def test_run_resource_snapshot_binds_web_search_per_agent(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(gateway, "web_search_runtime_status", lambda: {"status": "available", "error": None})
    enabled = gateway._resolved_agent_resource_snapshot(
        agent_name="opendrsai",
        runtime_policy=_runtime_policy(),
        model_provider="provider",
        model_id="model",
        config_dir=tmp_path,
    )
    disabled = gateway._resolved_agent_resource_snapshot(
        agent_name="opendrsai",
        runtime_policy=_runtime_policy(disabled=("builtin.web-search",)),
        model_provider="provider",
        model_id="model",
        config_dir=tmp_path,
    )

    assert "builtin.web-search" in enabled["tools"]["enabled_ids"]
    assert "builtin.web-search" not in disabled["tools"]["enabled_ids"]


def test_run_resource_snapshot_does_not_expose_unavailable_browser(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(gateway, "web_search_runtime_status", lambda: {
        "status": "runtime_unavailable",
        "error": "No browser",
    })

    snapshot = gateway._resolved_agent_resource_snapshot(
        agent_name="opendrsai",
        runtime_policy=_runtime_policy(),
        model_provider="provider",
        model_id="model",
        config_dir=tmp_path,
    )

    assert "builtin.web-search" not in snapshot["tools"]["enabled_ids"]


def test_web_search_results_are_accepted_by_existing_citation_policy() -> None:
    source = "https://example.org/hepix"
    evidence = build_citation_evidence([{
        "role": "tool",
        "tool_call_id": "search-1",
        "name": "web_search",
        "succeeded": True,
        "content": WebSearchResponse(
            query="HEPiX 2026",
            results=(WebSearchResult(1, "HEPiX", source),),
        ).public_dict(),
    }], f"See {source}", retrieval_required=True)

    assert evidence["valid"] is True
    assert evidence["source_call_ids"] == ["search-1"]


@pytest.mark.parametrize("question", [
    "FluxCon2027是什么？",
    "What is QubitLake2042?",
    "请查一下这个项目的最新发布信息",
])
def test_retrieval_policy_is_generic_not_fixture_specific(question: str) -> None:
    requirement = build_tool_decision_requirement(question, ["web_search"])

    assert requirement["required_domains"] == ["retrieval"]
    assert requirement["available_domains"] == ["retrieval"]
