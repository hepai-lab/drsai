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
  const ink = render(<App gw={gw} />, { exitOnCtrlC: false })
  ink.waitUntilExit().then(() => {
    gw.kill()
    process.exit(0)
  })
}
