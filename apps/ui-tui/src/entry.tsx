#!/usr/bin/env -S node --no-warnings
/**
 * DrSai TUI — Phase 2 entry point.
 *
 * Spawns the Python gateway, mounts the React/Ink app, waits for shutdown.
 */

import { render } from 'ink'

import { App } from './app.js'
import { GatewayClient } from './gatewayClient.js'

// ── Terminal focus reporting (XTerm \x1b[?1004) ───────────────────────
//
// We enable focus reporting so the app can pause cursor-blink and other
// "look alive" effects when the user switches away from the terminal.
// When enabled, the terminal sends ``\x1b[I`` on focus-in and ``\x1b[O``
// on focus-out. We sniff these inside <App> via useInput (Ink delivers
// the raw ESC sequence as the `input` arg).
//
// Restoration: ``\x1b[?1004l`` must be written on exit, otherwise the
// next shell prompt sees garbage characters every time the user switches
// windows. We wire it into the same restoreTerminal() path that already
// shows the cursor back.
//
// Compatibility: silently ignored by terminals that don't support it
// (macOS Terminal.app, ancient Linux consoles). In that case the focus
// state stays "true" forever — i.e. behavior degrades back to "always
// blinking", which is what we used to have.
const FOCUS_REPORTING_ENABLE = '\x1b[?1004h'
const FOCUS_REPORTING_DISABLE = '\x1b[?1004l'

let focusReportingEnabled = false

function enableFocusReporting(): void {
  if (focusReportingEnabled) return
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(FOCUS_REPORTING_ENABLE)
      focusReportingEnabled = true
    }
  } catch {
    // best-effort
  }
}

function disableFocusReporting(): void {
  if (!focusReportingEnabled) return
  try {
    process.stdout.write(FOCUS_REPORTING_DISABLE)
  } catch {
    // ignore
  }
  focusReportingEnabled = false
}

const gw = new GatewayClient()

let inkInstance: ReturnType<typeof render> | null = null
let terminalRestored = false
function restoreTerminal(): void {
  if (terminalRestored) return
  terminalRestored = true
  // Turn off focus reporting BEFORE the next shell sees stdin again,
  // otherwise switching windows would smear "\e[I" / "\e[O" into the
  // shell prompt forever.
  disableFocusReporting()
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
  // Root cause: the cursor block is rendered as a Text node with
  // `inverse` toggling. Toggling the ANSI inverse flag changes byte-
  // identity of the line string, so incremental sees `prevLines[i] !==
  // nextLines[i]` and writes the line — but its cursor accounting
  // (cursorNextLine + cursorTo(0)) does not always land on the same
  // row when other dynamic-frame heights have changed in the same
  // tick. The end-state is that subsequent renders write below the
  // previous tick's last line instead of overwriting it.
  //
  // Until either (a) we restructure the cursor as a separate React
  // node that doesn't ripple up to the parent's line strings, or
  // (b) Ink upstream fixes its diff/cursor accounting, we MUST keep
  // the legacy `createStandard` path. That is the default — i.e. we
  // simply don't pass `incrementalRendering`.
  //
  // The relief we still ship for P1-01:
  //   - DRSAI_TUI_FLUSH_MS bumped 80 → 160 (see createGatewayEventHandler)
  //   - The full fix (alt-screen mode) is tracked under P3-15.

  // Tell the terminal to send focus-in / focus-out events on stdin.
  // The App component sniffs them via useInput to drive the cursor blink.
  enableFocusReporting()

  inkInstance = render(<App gw={gw} />, { exitOnCtrlC: false })
  inkInstance.waitUntilExit().then(() => {
    restoreTerminal()
    gw.kill()
    process.exit(0)
  })
}
