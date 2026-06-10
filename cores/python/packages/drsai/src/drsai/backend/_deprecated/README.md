# Deprecated — old TUI code (Phase 5 cleanup)

This directory holds the legacy `prompt_toolkit` REPL and supporting modules
that were replaced by the dual-process Ink TUI (`drsai.backend.tui_gateway`
+ `ui-tui/`).

## Contents

| File | Purpose | Replaced by |
|------|---------|-------------|
| `run_cli_legacy.py` | Old REPL (2,646 lines) | `ui-tui/src/app.tsx` + `tui_gateway` |
| `cli/renderer.py` | DrSaiCLIRenderer (event → ANSI) | `tui_gateway/adapter/event_translator.py` |
| `cli/tui/` | prompt_toolkit Application + widgets | `ui-tui/src/components/` |
| `cli/curses_ui.py` | curses fallback UI | (none — Ink works everywhere) |
| `cli/display.py` | message formatting | `ui-tui/src/components/markdownRenderer.tsx` |
| `cli/prompt.py` | input prompt + slash completer | `ui-tui/src/components/textInput.tsx` + `tui_gateway/handlers/slash.py` |
| `cli/banner.py` | startup banner | `ui-tui/src/components/appLayout.tsx` |
| `cli/callbacks.py` | approval/clarify/secret callbacks | `tui_gateway/adapter/callbacks.py` |
| `cli/interrupt.py` | interrupt state tracker | `tui_gateway/adapter/agent_runner.py:interrupt()` |

## Why kept

- **git history reference** — if a regression appears, easy to `git diff` against the old impl.
- **One-version safety net** — if the new TUI has a fatal bug, a contributor can copy a file back and wire it up.

## Removal plan

Delete this entire directory once:
1. New TUI has run in production for one release cycle without major regressions
2. Electron desktop client has migrated off `gateway.py` (which still uses some of these symbols indirectly? — verify)

No production code under `python/packages/drsai/src/drsai/backend/` should import from `_deprecated/`.
