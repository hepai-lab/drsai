from drsai.backend.gateway import _runtime_execution_capabilities
from drsai.relay.generated_contract import CAPABILITIES


def test_stdio_mcp_is_allowed_by_relay_but_advertised_only_from_real_config() -> None:
    assert "mcp.stdio" in CAPABILITIES
    assert _runtime_execution_capabilities([]) == frozenset()
    assert _runtime_execution_capabilities([
        {"type": "mcp-sse", "url": "https://example.com/mcp"},
        {"type": "local", "name": "same-name"},
    ]) == frozenset()
    assert _runtime_execution_capabilities([
        {"type": "mcp-std", "name": "same-name", "command": "server"},
    ]) == frozenset({"mcp.stdio"})
    assert _runtime_execution_capabilities(["not-a-record"]) == frozenset()
