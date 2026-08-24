"""Guard the public surface of ``drsai.backend.gateway``.

The gateway is being modularised from a 14210-line monolith (``gateway.py`` →
``gateway_legacy.py`` → eventually the ``gateway/`` subpackage). A large test
suite reaches into the module via attribute access::

    from drsai.backend import gateway
    gateway.app
    gateway.put_agent_model_policy(...)
    gateway._runtime_engine()
    gateway._RUNTIME_EVIDENCE_SOURCE_FILES

This test scans the whole ``tests/`` tree for ``gateway.<symbol>`` references
and asserts every one resolves on the live package. It is the safety net for
the strangler-pattern split: if a migration forgets to re-export a name, this
test fails with the missing symbol listed, before any dependent test hits it.

The guard stays in sync automatically — newly referenced symbols in tests are
covered on the next run, no allowlist to maintain.
"""

from __future__ import annotations

import ast
from pathlib import Path

import drsai.backend.gateway as gateway

# Symbols that tests inject via ``monkeypatch.setattr(gateway, ...)`` or assign
# to as mock state (e.g. ``gateway.calls = []``). They are not part of the real
# gateway public surface and must not be required to resolve on import.
_MOCK_INJECTED = {
    "calls",
    "session_events",
    "sessions",
    "requests",
    "stream",  # monkeypatched in relay streaming tests
    "max_inflight",
    "ready",
    "ts",
    "approvals",  # monkeypatched collection in some approval tests
    "events",  # monkeypatched collection
    "runs",  # monkeypatched collection in run tests
    "log",  # never a real attribute; only appears in string literals
    "py",  # false positive from string tokens
    "X",  # false positive from string tokens
    "request",  # monkeypatched single value
}


def _scan_referenced_symbols() -> set[str]:
    """Return ``gateway.<attr>`` symbols found in executable (non-string) code.

    Uses the AST so that string literals, comments, and docstrings do not
    contribute spurious symbols. Only ``Attribute`` nodes whose ``value`` is a
    bare ``gateway`` name are counted.
    """
    symbols: set[str] = set()
    test_root = Path(__file__).resolve().parent
    for path in test_root.rglob("*.py"):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute):
                continue
            value = node.value
            if not isinstance(value, ast.Name) or value.id != "gateway":
                continue
            if node.attr.startswith("__") and node.attr not in ():
                continue
            if node.attr in _MOCK_INJECTED:
                continue
            symbols.add(node.attr)
    return symbols


def test_every_gateway_symbol_referenced_in_tests_resolves() -> None:
    """All ``gateway.<sym>`` accesses in the test tree must resolve on import."""
    referenced = _scan_referenced_symbols()
    missing = sorted(sym for sym in referenced if not hasattr(gateway, sym))
    assert not missing, (
        "These gateway.<symbol> references in tests/ no longer resolve on "
        f"the gateway package: {missing}"
    )


def test_core_gateway_surface_resolves() -> None:
    """Pin the handful of names the modular split plan calls out explicitly."""
    pinned = [
        "app", "manager", "main",
        # lazy accessors + singletons used widely across tests
        "_runtime_engine", "_runtime_registry", "_runtime_security",
        # evidence digest (test_gateway_runtime_identity depends on these)
        "_RUNTIME_EVIDENCE_SOURCE_FILES", "_RUNTIME_EVIDENCE_SOURCE_DIGEST",
        "runtime_identity",
        # explicitly imported symbols
        "_protocol_error", "_runtime_execution_capabilities",
        # core classes
        "AgentManager", "GatewayOpenDrSaiAgentBackend",
    ]
    missing = [name for name in pinned if not hasattr(gateway, name)]
    assert not missing, f"pinned gateway symbols missing: {missing}"
