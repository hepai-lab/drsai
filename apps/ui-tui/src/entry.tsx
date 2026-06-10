#!/usr/bin/env -S node --no-warnings
/**
 * DrSai TUI — Phase 2 entry point.
 *
 * Spawns the Python gateway, mounts the React/Ink app, waits for shutdown.
 */

import { render } from 'ink'

import { App } from './app.js'
import { GatewayClient } from './gatewayClient.js'

const gw = new GatewayClient()

let inkInstance: ReturnType<typeof render> | null = null
let terminalRestored = false
function restoreTerminal(): void {
  if (terminalRestored) return
  terminalRestored = true
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
  process.stdout.write('\x1b[2J\x1b[H')
  inkInstance = render(<App gw={gw} />, { exitOnCtrlC: false })
  inkInstance.waitUntilExit().then(() => {
    restoreTerminal()
    gw.kill()
    process.exit(0)
  })
}
