"""Controlled Playwright implementation adapted from the legacy WebUI search flow."""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, replace
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlsplit, urlunsplit

from .contracts import (
    WebSearchCandidate,
    WebSearchResponse,
    WebSearchResult,
    normalize_max_results,
    plan_search_query,
)
from .url_safety import UnsafeWebUrl, ensure_public_url, validate_url_shape


@dataclass(frozen=True)
class PlaywrightSearchConfig:
    total_timeout_seconds: float = 20.0
    navigation_timeout_ms: int = 8_000
    result_navigation_timeout_ms: int = 6_000
    max_pages: int = 3
    max_page_chars: int = 12_000
    max_total_content_chars: int = 24_000


class WebSearchRuntimeError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _clean_text(value: str, limit: int) -> str:
    text = re.sub(r"[\t\r\f\v ]+", " ", value or "")
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:limit]


_QUERY_STOP_WORDS = {
    "about", "and", "conference", "current", "find", "for", "from", "how", "latest",
    "official", "search", "site", "that", "the", "this", "what", "when", "where", "which",
    "who", "with", "workshop", "year", "介绍", "什么", "如何", "是什么", "查询", "搜索", "最新",
    "会议", "研讨会", "年份",
}


def _query_terms(query: str) -> tuple[str, ...]:
    normalized = query.casefold()
    # Normalize compact entity/year queries such as ``hepix2026`` to the
    # same terms as ``hepix 2026``.
    normalized = re.sub(r"(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])", " ", normalized)
    terms = [
        value for value in re.findall(r"[a-z0-9][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}", normalized)
        if value not in _QUERY_STOP_WORDS
    ]
    return tuple(dict.fromkeys(terms))


def _result_matches_query(row: dict[str, str], query: str) -> bool:
    terms = _query_terms(query)
    if not terms:
        return True
    haystack = " ".join((row.get("title", ""), row.get("snippet", ""), row.get("url", ""))).casefold()
    compact_haystack = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", haystack)
    # Require the primary distinctive entity instead of accepting a result
    # merely because it contains a generic qualifier or year.
    anchor = next((term for term in terms if not term.isdigit()), terms[0])
    compact_anchor = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", anchor)
    entity_matches = anchor in haystack or compact_anchor in compact_haystack
    years = {term for term in terms if re.fullmatch(r"20\d{2}", term)}
    return entity_matches and all(year in haystack for year in years)


def _search_locale(query: str) -> tuple[str, str]:
    if re.search(r"[\u4e00-\u9fff]", query):
        return "zh-CN", "zh-hans"
    return "en-US", "en-us"


def _canonical_result_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.hostname or "").casefold().endswith("bing.com") and parsed.path.startswith("/ck/a"):
        encoded = parse_qs(parsed.query).get("u", [""])[0]
        if encoded.startswith("a1"):
            try:
                raw = encoded[2:]
                raw += "=" * (-len(raw) % 4)
                value = base64.urlsafe_b64decode(raw).decode("utf-8")
                parsed = urlsplit(value)
            except (ValueError, UnicodeError):
                pass
    cleaned = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    validate_url_shape(cleaned)
    return cleaned


async def _close_quietly(resource: Any) -> None:
    """Best-effort Playwright cleanup must not mask timeout/cancellation errors."""
    try:
        await asyncio.wait_for(resource.close(), timeout=0.5)
    except Exception:
        return


async def _stop_playwright_quietly(playwright: Any) -> None:
    try:
        await asyncio.wait_for(playwright.stop(), timeout=0.5)
    except Exception:
        return


async def _extract_search_rows(page: Any, max_results: int) -> list[dict[str, str]]:
    rows = await page.locator("li.b_algo").evaluate_all(
        """(nodes) => nodes.map((node) => {
          const link = node.querySelector('h2 a');
          const snippet = node.querySelector('.b_caption p, .b_snippet');
          return link ? {
            title: (link.textContent || '').trim(),
            url: link.href || '',
            snippet: (snippet?.textContent || '').trim()
          } : null;
        }).filter(Boolean)"""
    )
    output: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in rows if isinstance(rows, list) else []:
        if not isinstance(raw, dict):
            continue
        try:
            url = _canonical_result_url(str(raw.get("url") or ""))
        except (UnsafeWebUrl, ValueError):
            continue
        host = (urlsplit(url).hostname or "").casefold()
        if host.endswith("bing.com") or url in seen:
            continue
        title = _clean_text(str(raw.get("title") or ""), 500)
        if not title:
            continue
        seen.add(url)
        output.append({
            "title": title,
            "url": url,
            "snippet": _clean_text(str(raw.get("snippet") or ""), 2_000),
        })
        if len(output) >= max_results:
            break
    return output


async def _extract_page_text(page: Any, limit: int) -> str:
    value = await page.evaluate(
        """() => {
          const root = document.querySelector('main, article, [role="main"]') || document.body;
          return root ? (root.innerText || '') : '';
        }"""
    )
    return _clean_text(str(value or ""), limit)


def _launch_candidates() -> list[dict[str, Any]]:
    explicit = os.environ.get("DRSAI_PLAYWRIGHT_EXECUTABLE_PATH", "").strip()
    candidates: list[dict[str, Any]] = []
    if explicit:
        candidates.append({"executable_path": str(Path(explicit))})
    if sys.platform == "win32":
        candidates.extend(({"channel": "msedge"}, {"channel": "chrome"}))
    candidates.append({})
    return candidates


def web_search_runtime_status() -> dict[str, Any]:
    try:
        playwright_spec = importlib.util.find_spec("playwright.async_api")
    except ModuleNotFoundError:
        playwright_spec = None
    if playwright_spec is None:
        return {
            "status": "runtime_unavailable",
            "error": "Playwright Python package is not installed.",
        }
    explicit = os.environ.get("DRSAI_PLAYWRIGHT_EXECUTABLE_PATH", "").strip()
    if explicit:
        if Path(explicit).is_file():
            return {"status": "available", "error": None}
        return {
            "status": "runtime_unavailable",
            "error": "DRSAI_PLAYWRIGHT_EXECUTABLE_PATH does not point to a browser executable.",
        }
    if sys.platform == "win32":
        roots = [
            os.environ.get("PROGRAMFILES", ""),
            os.environ.get("PROGRAMFILES(X86)", ""),
            os.environ.get("LOCALAPPDATA", ""),
        ]
        relative_paths = (
            Path("Microsoft/Edge/Application/msedge.exe"),
            Path("Google/Chrome/Application/chrome.exe"),
        )
        if any(Path(root, relative).is_file() for root in roots if root for relative in relative_paths):
            return {"status": "available", "error": None}
    configured_browser_root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    browser_root = (
        Path(configured_browser_root).expanduser()
        if configured_browser_root
        else Path.home() / ".cache" / "ms-playwright"
    )
    if browser_root.is_dir() and any(browser_root.glob("chromium-*")):
        return {"status": "available", "error": None}
    return {
        "status": "runtime_unavailable",
        "error": "No Playwright Chromium, Microsoft Edge, or Google Chrome executable was found.",
    }


async def _launch_browser(playwright: Any) -> Any:
    last_error: Exception | None = None
    for candidate in _launch_candidates():
        try:
            return await playwright.chromium.launch(
                headless=True,
                chromium_sandbox=True,
                args=["--disable-extensions", "--disable-file-system"],
                **candidate,
            )
        except Exception as exc:
            last_error = exc
    raise WebSearchRuntimeError(
        "browser_unavailable",
        "Web search browser is unavailable. Install Playwright Chromium or Microsoft Edge.",
    ) from last_error


async def _read_result_page(context: Any, row: dict[str, str], config: PlaywrightSearchConfig) -> tuple[str, str]:
    await ensure_public_url(row["url"])
    page = await context.new_page()
    try:
        response = await page.goto(
            row["url"], wait_until="domcontentloaded", timeout=config.result_navigation_timeout_ms,
        )
        final_url = _canonical_result_url(page.url)
        await ensure_public_url(final_url)
        if response is not None and int(response.status) >= 400:
            raise WebSearchRuntimeError("result_http_error", f"Result page returned HTTP {response.status}")
        return final_url, await _extract_page_text(page, config.max_page_chars)
    finally:
        await _close_quietly(page)


async def _search_once(query: str, max_results: int, config: PlaywrightSearchConfig) -> WebSearchResponse:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise WebSearchRuntimeError(
            "browser_runtime_unavailable", "Web search requires the Playwright Python package.",
        ) from exc

    warnings: list[str] = []
    playwright = await async_playwright().start()
    try:
        browser = await _launch_browser(playwright)
        try:
            browser_locale, search_language = _search_locale(query)
            context = await browser.new_context(
                accept_downloads=False,
                permissions=[],
                java_script_enabled=True,
                locale=browser_locale,
            )
            try:
                async def route_public_page_assets(route: Any) -> None:
                    if route.request.resource_type in {"image", "media", "font"}:
                        await route.abort()
                    else:
                        await route.continue_()

                await context.route("**/*", route_public_page_assets)
                page = await context.new_page()
                try:
                    search_url = f"https://www.bing.com/search?q={quote_plus(query)}&FORM=QBLH&setlang={search_language}"
                    response = await page.goto(
                        search_url, wait_until="domcontentloaded", timeout=config.navigation_timeout_ms,
                    )
                    if response is not None and int(response.status) >= 400:
                        raise WebSearchRuntimeError("search_http_error", f"Bing returned HTTP {response.status}")
                    candidate_rows = await _extract_search_rows(page, max_results * 2)
                    accepted_rows: list[dict[str, str]] = []
                    candidates: list[WebSearchCandidate] = []
                    for candidate_rank, row in enumerate(candidate_rows, 1):
                        matches = _result_matches_query(row, query)
                        accepted = matches and len(accepted_rows) < max_results
                        if accepted:
                            accepted_rows.append(row)
                        candidates.append(WebSearchCandidate(
                            rank=candidate_rank,
                            title=row["title"],
                            url=row["url"],
                            snippet=row["snippet"],
                            accepted=accepted,
                            reason=(
                                "accepted" if accepted else
                                "result_limit" if matches else
                                "query_mismatch"
                            ),
                        ))
                    rows = accepted_rows
                finally:
                    await _close_quietly(page)
                if not rows:
                    return WebSearchResponse(
                        query=query,
                        results=(),
                        partial=True,
                        warnings=(("no_reliable_results",) if candidates else ("no_results",)),
                        candidates=tuple(candidates),
                    )

                read_rows = rows[: min(config.max_pages, len(rows))]
                page_reads = await asyncio.gather(
                    *(_read_result_page(context, row, config) for row in read_rows),
                    return_exceptions=True,
                )
                content_by_url: dict[str, str] = {}
                remaining = config.max_total_content_chars
                for row, outcome in zip(read_rows, page_reads):
                    if isinstance(outcome, Exception):
                        warnings.append(f"result_unavailable:{urlsplit(row['url']).hostname or 'unknown'}")
                        continue
                    final_url, content = outcome
                    content = content[:remaining]
                    remaining -= len(content)
                    content_by_url[row["url"]] = content
                    if final_url != row["url"]:
                        content_by_url[final_url] = content
                    if remaining <= 0:
                        warnings.append("content_limit_reached")
                        break

                results: list[WebSearchResult] = []
                for rank, row in enumerate(rows, 1):
                    content = content_by_url.get(row["url"], "")
                    digest = "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest() if content else ""
                    results.append(WebSearchResult(
                        rank=rank,
                        title=row["title"],
                        url=row["url"],
                        snippet=row["snippet"],
                        content=content,
                        content_sha256=digest,
                    ))
                return WebSearchResponse(
                    query=query,
                    results=tuple(results),
                    partial=bool(warnings),
                    warnings=tuple(dict.fromkeys(warnings)),
                    candidates=tuple(candidates),
                )
            finally:
                await _close_quietly(context)
        finally:
            await _close_quietly(browser)
    finally:
        await _stop_playwright_quietly(playwright)


async def search_bing_with_playwright(
    query: str,
    max_results: int = 8,
    *,
    config: PlaywrightSearchConfig | None = None,
) -> WebSearchResponse:
    query_plan = plan_search_query(query)
    normalized_max_results = normalize_max_results(max_results)
    settings = config or PlaywrightSearchConfig()
    try:
        response = await asyncio.wait_for(
            _search_once(query_plan.effective_query, normalized_max_results, settings),
            timeout=settings.total_timeout_seconds,
        )
        return replace(
            response,
            requested_query=query_plan.requested_query,
            rewrite_reason=query_plan.rewrite_reason,
        )
    except asyncio.TimeoutError as exc:
        raise WebSearchRuntimeError("search_timeout", "Web search timed out.") from exc
    except WebSearchRuntimeError:
        raise
    except Exception as exc:
        code = "browser_unavailable" if type(exc).__name__ in {"TargetClosedError", "BrowserTypeLaunchError"} else "search_failed"
        message = (
            "Web search browser closed before the request completed."
            if code == "browser_unavailable"
            else "Web search failed before a usable response was produced."
        )
        raise WebSearchRuntimeError(code, message) from exc
