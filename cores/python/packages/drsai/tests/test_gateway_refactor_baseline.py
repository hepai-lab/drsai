"""Regression baselines guarding the ``gateway_legacy.py`` modular split.

These three snapshots are the safety net for the route-extraction refactor
described in ``apps/desktop/docs/v2/gateway-modularization-plan.zh-CN.md``. They
exist to catch the failure modes that the split can introduce *silently* -- ones that
neither the type checker nor the existing suite would surface:

1. :func:`test_openapi_paths_unchanged` -- a dropped, renamed, or reshaped
   route, and any ``operationId`` drift. ``operationId`` is derived by FastAPI
   from the handler function name plus path plus method, and it is consumed by
   ``apps/desktop/windows/scripts/generate-remote-gateway-client.mjs`` to emit
   ``src/main/remoteGatewayClient.generated.ts``. Renaming a handler therefore
   breaks the Desktop main process at compile time.

2. :func:`test_route_registration_order_unchanged` -- registration *order*,
   which FastAPI uses for matching. ``/v1/threads/search`` must stay registered
   before ``/v1/threads/{thread_id}``; if the split reorders them, ``search`` is
   swallowed as a ``thread_id`` and the endpoint 404s without raising anything.

3. The two evidence-digest tests. ``_RUNTIME_EVIDENCE_SOURCE_DIGEST``
   fingerprints the gateway sources at import time and is published through
   ``GET /v1/runtime`` so a Gateway running stale code cannot claim a fresh
   digest. Every module the split moves out of ``gateway_legacy.py`` has to stay
   both *listed* and *hashed*, or the digest quietly starts vouching for code it
   never read.

The two fixture files are baselines: a diff against them is the signal that a
supposedly behaviour-preserving move changed the wire contract. Regenerate them
only with a deliberate, reviewed contract change -- never to make a red test
green. See ``regenerate_gateway_baselines.py`` next to this file.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from typing import Any

from drsai.backend import gateway

FIXTURES = Path(__file__).resolve().parent / "fixtures"
OPENAPI_PATHS_BASELINE = FIXTURES / "gateway_openapi_paths.json"
ROUTE_ORDER_BASELINE = FIXTURES / "gateway_route_order.json"


def flatten_routes(routes: Any, prefix: str = "") -> list[dict[str, Any]]:
    """Return ``app.routes`` in registration order, expanding included routers.

    FastAPI 0.139 stopped flattening ``include_router`` results into
    ``app.routes``; an included router now appears as a single container route
    exposing ``original_router`` and ``include_context``. A snapshot built from
    ``app.routes`` alone would therefore report every extracted route as
    "disappeared". Recursing through the container keeps the snapshot stable
    across the split, and the duck-typed attribute check keeps this working on
    FastAPI versions that still flatten.
    """
    flattened: list[dict[str, Any]] = []
    for route in routes:
        nested = getattr(route, "original_router", None)
        if nested is not None:
            context = getattr(route, "include_context", None)
            flattened.extend(
                flatten_routes(nested.routes, prefix + (getattr(context, "prefix", "") or ""))
            )
            continue
        path = getattr(route, "path", None)
        if path is None:
            continue
        flattened.append(
            {
                "path": prefix + path,
                "methods": sorted(getattr(route, "methods", None) or []),
                "name": getattr(route, "name", "") or "",
            }
        )
    return flattened


def openapi_paths() -> dict[str, Any]:
    return gateway.app.openapi()["paths"]


def route_serving_modules() -> set[Path]:
    """Resolve every module that actually backs a route on the live app.

    Derived from the route table rather than from a directory listing. A
    directory scan would mirror how ``_RUNTIME_EVIDENCE_SOURCE_FILES`` is now
    built and the assertion would be vacuous; asking the endpoints where they
    came from instead catches an extraction that lands somewhere the digest
    never looks.
    """
    modules: set[Path] = set()
    for route in gateway.app.routes:
        nested = getattr(route, "original_router", None)
        candidates = getattr(nested, "routes", ()) if nested is not None else (route,)
        for candidate in candidates:
            endpoint = getattr(candidate, "endpoint", None)
            module = inspect.getmodule(endpoint) if endpoint is not None else None
            source = getattr(module, "__file__", None)
            if source:
                modules.add(Path(source).resolve())
    return modules


def test_openapi_paths_unchanged() -> None:
    """The published HTTP contract -- paths, methods, schemas, operationIds."""
    baseline = json.loads(OPENAPI_PATHS_BASELINE.read_text(encoding="utf-8"))
    current = openapi_paths()

    missing = sorted(set(baseline) - set(current))
    added = sorted(set(current) - set(baseline))
    assert not missing, f"Routes disappeared from the OpenAPI contract: {missing}"
    assert not added, f"Routes appeared without a baseline update: {added}"

    # Compare per path so a failure names the offending endpoint rather than
    # dumping a 400KB diff.
    for path in sorted(baseline):
        assert current[path] == baseline[path], f"OpenAPI contract changed for {path}"


def test_route_registration_order_unchanged() -> None:
    """Registration order, which decides matching for overlapping paths."""
    baseline = json.loads(ROUTE_ORDER_BASELINE.read_text(encoding="utf-8"))
    current = flatten_routes(gateway.app.routes)

    assert len(current) == len(baseline), (
        f"Route count changed: {len(baseline)} -> {len(current)}. "
        "A pure move must preserve every route."
    )
    for index, (actual, expected) in enumerate(zip(current, baseline)):
        assert actual == expected, (
            f"Route order changed at position {index}: "
            f"expected {expected['methods']} {expected['path']}, "
            f"got {actual['methods']} {actual['path']}"
        )


def test_literal_paths_precede_their_parameterised_siblings() -> None:
    """Guard the specific shadowing hazard the split can introduce.

    ``/v1/threads/search`` sits under the same parent as
    ``/v1/threads/{thread_id}``. FastAPI matches in registration order, so the
    literal must come first. This is asserted independently of the order
    baseline so the failure message names the actual problem instead of
    surfacing as an opaque positional diff.
    """
    order = [route["path"] for route in flatten_routes(gateway.app.routes)]
    positions = {path: index for index, path in enumerate(order)}

    for literal, parameterised in (
        ("/v1/threads/search", "/v1/threads/{thread_id}"),
    ):
        if literal not in positions or parameterised not in positions:
            continue
        assert positions[literal] < positions[parameterised], (
            f"{literal} must be registered before {parameterised}; "
            "otherwise the literal segment is matched as a path parameter."
        )


def test_evidence_digest_covers_every_extracted_route_module() -> None:
    """Every module the split carves out must stay inside the fingerprint.

    Scope note: the digest covers the gateway implementation, not every module
    that happens to serve a route. ``gateway_wechat`` and ``feedback_service``
    mount their own routers and have always sat outside it; that predates this
    refactor and is not what this test polices. What it polices is code leaving
    ``gateway_legacy.py``, which must remain fingerprinted wherever it lands.
    """
    package_root = Path(gateway.__file__).resolve().parent
    covered = {Path(logical).name for logical in gateway._RUNTIME_EVIDENCE_SOURCE_FILES}

    extracted = {
        module
        for module in route_serving_modules()
        if package_root in module.parents or module.parent == package_root
    }
    assert extracted, "Expected the gateway package to serve routes; found none."

    uncovered = sorted(module.name for module in extracted if module.name not in covered)
    assert not uncovered, (
        "These modules serve routes carved out of gateway_legacy.py but are not "
        f"covered by _RUNTIME_EVIDENCE_SOURCE_DIGEST: {uncovered}"
    )


def test_evidence_digest_actually_hashes_the_extracted_modules(monkeypatch) -> None:
    """Listing a file is not the same as hashing it.

    Guards the other half of the contract: that the extracted modules reach the
    hash, not merely the tuple. Dropping them from the list must move the digest
    -- if it does not, the digest is vouching for code it never read.
    """
    assert gateway._runtime_evidence_source_digest() == gateway._RUNTIME_EVIDENCE_SOURCE_DIGEST, (
        "Recomputing the digest no longer reproduces the value captured at import "
        "time; some listed source cannot be resolved or read."
    )

    without_package = tuple(
        logical
        for logical in gateway._RUNTIME_EVIDENCE_SOURCE_FILES
        if "/backend/gateway/" not in logical
    )
    assert len(without_package) < len(gateway._RUNTIME_EVIDENCE_SOURCE_FILES), (
        "No gateway package modules are listed at all, so this test would prove "
        "nothing. _gateway_package_source_files() is likely returning empty."
    )

    monkeypatch.setattr(gateway, "_RUNTIME_EVIDENCE_SOURCE_FILES", without_package)
    assert gateway._runtime_evidence_source_digest() != gateway._RUNTIME_EVIDENCE_SOURCE_DIGEST, (
        "Dropping every extracted module left the digest unchanged: the modules "
        "are listed but their bytes never reach the hash."
    )
