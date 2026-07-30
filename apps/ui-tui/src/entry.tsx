#!/usr/bin/env -S node --no-warnings
/**
 * DrSai TUI — Phase 2 entry point.
 *
 * Spawns the Python gateway, mounts the React/Ink app, waits for shutdown.
 *
 * Terminal-mode helpers (alt-screen / mouse tracking / focus reporting) live
 * in ``app/terminalControl.ts`` so the runtime "copy mode" toggle (Ctrl+Y)
 * can flip mouse tracking on / off mid-session without re-implementing the
 * write logic. See that module for the full rationale.
 */

import { render } from 'ink'

import { App } from './app.js'
import { GatewayClient } from './gatewayClient.js'
import { setInkInstance } from './app/inkInstanceRef.js'
import { initTerminalSize } from './hooks/terminalSizeStore.js'
import {
  disableAltScreen,
  disableFocusReporting,
  disableMouseTracking,
  enableAltScreen,
  enableFocusReporting,
  enableMouseTracking,
} from './app/terminalControl.js'

// ── Terminal focus reporting ───────────────────────────────────────────
// Enabled so the app can pause cursor blink when the user switches windows.
// Restored on exit to avoid smearing "\e[I" / "\e[O" into the next shell prompt.

// ── Alternate screen buffer (opt-in) ───────────────────────────────────
// Default OFF — the TUI runs in the PRIMARY buffer so the user's terminal
// keeps its native scroll-back and selection, and TUI output flows into
// scrollback instead of being discarded on exit (which is what alt-screen
// does, vim/less style).
//
// Opt-in with DRSAI_TUI_USE_ALT_SCREEN=1 if you want the clean-exit
// behaviour at the cost of losing scrollback once the TUI quits.

// ── Mouse tracking (Issue #7 fix) ──────────────────────────────────────
// The terminal sends actual mouse events instead of translating wheel
// scrolls into fake arrow keys (which would otherwise trigger the
// composer's prompt history). Toggleable at runtime via Ctrl+Y so users
// can select / copy text with the mouse natively.

const gw = new GatewayClient()

let inkInstance: ReturnType<typeof render> | null = null
let terminalRestored = false
function restoreTerminal(): void {
  if (terminalRestored) return
  terminalRestored = true
  // Disable mouse tracking FIRST (before switching buffers)
  disableMouseTracking()
  // Turn off focus reporting BEFORE the next shell sees stdin again,
  // otherwise switching windows would smear "\e[I" / "\e[O" into the
  // shell prompt forever.
  disableFocusReporting()
  // Switch back to the primary screen buffer so the user's shell
  // history and previous output reappear. The alternate buffer is
  // discarded on exit — this is expected (same as vim/less/htop).
  disableAltScreen()
  try {
    inkInstance?.clear()
  } catch {
    // ignore
  }
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
  } catch {
    // Best-effort restoration only.
  }
  try {
    // Ensure the terminal cursor is visible again even if the app exits early.
    process.stdout.write('\x1b[?25h')
  } catch {
    // ignore
  }
}

process.once('exit', restoreTerminal)
process.once('SIGINT', () => {
  restoreTerminal()
  gw.kill()
  process.exit(130)
})
process.once('SIGTERM', () => {
  restoreTerminal()
  gw.kill()
  process.exit(143)
})

// Start after handlers are installed so even early failures restore the terminal.
gw.start()

if (!process.stdin.isTTY) {
  // Headless smoke path — preserved from Phase 0 so CI can verify.
  console.log('drsai-tui: no TTY; running headless smoke test')
  gw.ready_()
    .then(() => gw.request('session.list', { limit: 5 }))
    .then(result => {
      const r = result as { sessions?: unknown[]; user_id?: string }
      console.log(JSON.stringify({ ok: true, sessions: r.sessions?.length ?? 0, user_id: r.user_id }))
      gw.kill()
      process.exit(0)
    })
    .catch(err => {
      console.error('headless failure:', err.message)
      gw.kill()
      process.exit(1)
    })
} else {
  // Interactive Ink path
  //
  // Note: We deliberately do NOT clear the terminal screen on startup.
  // Older versions wrote `\x1b[2J\x1b[H` here, but that erases the user's
  // existing scrollback (their previous shell commands, build output, etc.).
  // A TUI tool must respect the user's terminal as a workbench.
  // Ink renders append-only into the dynamic frame; no pre-clear is needed.
  //
  // ── A note on Ink incremental rendering ──────────────────────────────
  //
  // Ink 6.8 ships an opt-in `incrementalRendering: true` option that
  // diffs frames line-by-line and skips unchanged lines. In theory this
  // would let scrollback survive long streaming answers (P1-01). In
  // practice we tried turning it on and the prompt-row-with-blinking-
  // cursor combination caused incremental's diff to mis-classify the
  // last line as "changed but in a new position", which APPENDED a
  // fresh prompt row on every blink (530 ms). The composer ended up
  // with 6+ stacked prompt rows within seconds.
  //
  // Until either (a) we restructure the cursor as a separate React
  // node that doesn't ripple up to the parent's line strings, or
  // (b) Ink upstream fixes its diff/cursor accounting, we MUST keep
  // the legacy `createStandard` path. That is the default — i.e. we
  // simply don't pass `incrementalRendering`.

  // Default to PRIMARY buffer — the user's terminal stays a workbench:
  // native scroll-back, native selection, and the TUI's own output flows
  // into terminal scrollback instead of vanishing on exit.
  //
  // Trade-off: Ink's eraseLines() during streaming can momentarily reset
  // the terminal's auto-scroll anchor. We mitigate that with the existing
  // FLUSH_MS coalescing and PageUp/PageDown internal scroll. Set
  // DRSAI_TUI_USE_ALT_SCREEN=1 if you want the vim/less-style alternate
  // page (clean exit, no scrollback after quit).
  const altScreenRequested = process.env.DRSAI_TUI_USE_ALT_SCREEN === '1'
  if (altScreenRequested) {
    enableAltScreen()
  }

  // Mouse tracking — DEFAULT OFF.
  //
  // Why off by default: the user expects the terminal to behave like any
  // other CLI tool — wheel-scroll the scrollback, drag-select to copy.
  // With mouse tracking ON the terminal hands every wheel/click/drag to
  // the program instead of the terminal's native handler, which means
  // selection breaks and scrollback freezes. We choose user agency over
  // a (rare) edge case where some terminals translate wheel events into
  // fake arrow keys.
  //
  // Opt-in via DRSAI_TUI_ENABLE_MOUSE_TRACKING=1 if your terminal does
  // the wheel-as-arrow-key translation and you want the program to
  // intercept those events instead.
  const mouseTrackingRequested = process.env.DRSAI_TUI_ENABLE_MOUSE_TRACKING === '1'
  if (mouseTrackingRequested) {
    enableMouseTracking()
  }

  // Tell the terminal to send focus-in / focus-out events on stdin.
  // The App component sniffs them via useInput to drive the cursor blink.
  enableFocusReporting()

  // ── Banner (pre-print) ──────────────────────────────────────────────
  // Print the "⚡ OpenDrSai" banner ONCE via raw stdout BEFORE Ink takes over
  // the dynamic frame.  Previously the banner lived inside <AppLayout>'s
  // dynamic frame, which meant Ink re-rendered it on every state update
  // (spinner tick, streaming flush, status change).  On terminals where
  // Ink's eraseLines() doesn't perfectly clear the previous frame, the
  // banner accumulated as duplicate lines — especially visible during
  // the "thinking" phase where the 100ms spinner causes frequent repaints.
  //
  // By writing it to stdout here, the banner becomes part of the
  // terminal's native scrollback, outside Ink's control.  Ink starts
  // rendering below it and never touches it again.
  //
  // Color: #FFD700 (gold) = theme.primary, applied via ANSI true-colour.
  process.stdout.write('\x1b[1m\x1b[38;2;255;215;0m⚡ OpenDrSai\x1b[0m\n')

  // Install the single global resize listener BEFORE mounting the app,
  // so all components can subscribe via the nanostore atom instead of
  // each adding their own EventEmitter listener (which caused
  // MaxListenersExceededWarning when >10 MarkdownRenderer instances
  // were mounted simultaneously).
  initTerminalSize()

  inkInstance = render(<App gw={gw} />, { exitOnCtrlC: false })
  setInkInstance(inkInstance)
  inkInstance.waitUntilExit().then(() => {
    restoreTerminal()
    gw.kill()
    process.exit(0)
  })
}
