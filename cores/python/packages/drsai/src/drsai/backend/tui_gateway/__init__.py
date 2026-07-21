"""OpenDrSai TUI Gateway — JSON-RPC server bridging the Ink/TS UI to DrSaiCLIAssistant.

This package replaces the legacy in-process prompt_toolkit TUI. It speaks
JSON-RPC 2.0 over stdio (newline-delimited) by default; an optional WebSocket
transport supports remote-attach mode (Phase 3).

Entry point:
    python -m drsai.backend.tui_gateway

Architecture mirrors hermes-agent/tui_gateway. See
``python/packages/drsai/docs/hermes-agent-tui-analysis.md`` for the design
report.
"""

__all__ = ["main"]


def main() -> None:
    from .entry import main as _main
    _main()
