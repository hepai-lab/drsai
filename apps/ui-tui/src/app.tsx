/**
 * App — startup orchestration:
 *   1. Spawn gateway via GatewayClient (entry already constructs it)
 *   2. Wait for gateway.ready
 *   3. Resolve current session (cwd-bound; create if none)
 *   4. session.resume → loads agent (slow first time; shows spinner)
 *   5. Subscribe gateway events → store mutations
 *   6. Render AppLayout
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createGatewayEventHandler } from './app/createGatewayEventHandler.js'
import { FOCUS_IN_INPUT, FOCUS_OUT_INPUT, parseMouseEvent } from './app/focusEvents.js'
import { parseHistory } from './app/historyParser.js'
import { disableMouseTracking, enableMouseTracking } from './app/terminalControl.js'
import { TurnController } from './app/turnController.js'
import { $current, $isStreaming, $transcript, setTranscript } from './app/turnStore.js'
import { $connectionError, $connectionStatus, $copyMode, $lastUsage, $memoryPreview, $statusLine, $terminalFocused, $toolDetail, $userId } from './app/uiStore.js'
import { AppLayout } from './components/appLayout.js'
import { SetupScreen } from './components/setupScreen.js'
import type { GatewayClient } from './gatewayClient.js'
import type { SessionCreateResult, SessionInfo, SessionListResult, SessionResumeResult } from './gatewayTypes.js'
import { theme } from './theme.js'

interface AppProps {
  gw: GatewayClient
}

/**
 * Pre-print the MEMORY.md banner to stdout BEFORE Ink commits <Static> items.
 *
 * The banner is now a compact one-line summary: file path + entry count.
 * This avoids flooding the terminal with full MEMORY.md content on startup.
 * Users can open the file directly to see details.
 *
 * IMPORTANT: We use `console.log()` (NOT `process.stdout.write()`) because
 * Ink patches `console.*` via `patch-console`.  The patched `console.log`
 * coordinates with Ink's output management:
 *   1. `logUpdate.clear()` — erases the current dynamic frame
 *   2. `stdout.write(data)` — writes the banner into scrollback
 *   3. `restoreLastOutput()` — re-renders the dynamic frame below the banner
 *
 * Using `process.stdout.write()` directly bypasses this coordination,
 * corrupting Ink's cursor/line-count tracking and causing the TUI to crash
 * on the next render cycle.
 *
 * Backend sends: "~/.drsai/.../MEMORY.md (2/15 entries)"
 */
function preprintMemoryBanner(text: string): void {
  const clean = text.trim()
  if (!clean) return

  const primary = '\x1b[1m\x1b[38;2;255;215;0m' // bold gold
  const muted = '\x1b[38;2;110;110;110m'       // grey
  const reset = '\x1b[0m'

  // Single-line: 📋 Memory  ~/.drsai/.../MEMORY.md (2/15 entries)
  console.log(`${primary}📋 Memory${reset} ${muted}${clean}${reset}`)
}

type Bootstrap =
  | { phase: 'connecting' }
  | { phase: 'setup'; configExists: boolean }
  | { phase: 'resuming'; session: SessionInfo }
  | { phase: 'ready'; sessionId: string; controller: TurnController }
  | { phase: 'error'; message: string }
  | { phase: 'remote_lost'; reason: string }

export function App({ gw }: AppProps) {
  const { exit } = useApp()
  const [boot, setBoot] = useState<Bootstrap>({ phase: 'connecting' })

  // Ref so the SetupScreen can trigger the post-setup boot path without
  // needing the App's effect to re-run (which would recreate the controller).
  const setupCompleteHandlerRef = useRef<(() => Promise<void>) | null>(null)

  // Graceful exit on Ctrl+D / double Ctrl+C:
  //   1. Send gateway.shutdown RPC to trigger session save on the Python side.
  //   2. Wait up to 5 s for the gateway process to exit on its own.
  //   3. If it doesn't exit within 5 s, force-kill and exit anyway.
  // This prevents session history loss that occurred with the old `gw.kill(); exit()`.
  const isExitingRef = useRef(false)

  function gracefulExit() {
    if (isExitingRef.current) return
    isExitingRef.current = true

    // Fire-and-forget shutdown RPC; don't await (the gateway may die mid-flight).
    gw.request('gateway.shutdown', {}).catch(() => {})

    // Wait for gateway to exit gracefully, then hard-exit.
    const TIMEOUT_MS = 5000
    const deadline = setTimeout(() => {
      gw.kill()
      exit()
    }, TIMEOUT_MS)

    // If the gateway sends a gateway.exit event before the timeout, exit cleanly.
    const offExit = gw.onEvent('gateway.exit', () => {
      clearTimeout(deadline)
      offExit()
      exit()
    })
  }

  // Ctrl+C semantics (P2-10):
  //   - During streaming: cancel the current turn (handled in
  //     composerPane.tsx, NOT here — its useInput sees the key first
  //     because of nanostores subscription order doesn't matter; Ink
  //     broadcasts to all).
  //   - When idle: the FIRST Ctrl+C shows a transient "press again to
  //     exit" status line. A SECOND Ctrl+C within 2 s triggers the
  //     same gracefulExit() as Ctrl+D. After 2 s the prompt is
  //     forgotten and the user starts fresh.
  //
  //   We don't try to clear the composer's TextInput value here — the
  //   prompt text is enough feedback, and adding cross-component
  //   "clear my buffer" wiring would require either a ref or another
  //   atom. Easy to add later if user feedback asks for it.
  const ctrlCArmedRef = useRef(false)
  const ctrlCResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const CTRL_C_DOUBLE_PRESS_MS = 2000

  useInput((_input, key) => {
    // ── Terminal focus reporting sniff ──────────────────────────────
    //
    // XTerm focus reporting (enabled in entry.tsx) makes the terminal
    // send "\x1b[I" on focus-in and "\x1b[O" on focus-out. Ink's
    // parseKeypress doesn't recognize these as a named key, so the
    // `input` arg arrives as plain "[I" / "[O" (Ink strips the leading
    // ESC byte). These two strings are not producible by a single
    // human keypress (Alt+[ then I would be two separate useInput
    // callbacks), so detection here is safe.
    //
    // This is the ONLY place that updates $terminalFocused. Other
    // useInput sites just swallow the event via isTerminalFocusEvent
    // so they don't mis-handle it as user input. See
    // src/app/focusEvents.ts for the shared helper and rationale.
    if (_input === FOCUS_IN_INPUT) {
      $terminalFocused.set(true)
      return
    }
    if (_input === FOCUS_OUT_INPUT) {
      $terminalFocused.set(false)
      return
    }

    // ── Mouse events ────────────────────────────────────────────────
    // Mouse tracking is enabled in entry.tsx so wheel events arrive as
    // SGR mouse events instead of fake arrow keys (which would otherwise
    // be misinterpreted as composer history navigation, Issue #7).
    //
    // We do NOT intercept the wheel for in-TUI scroll. With the new
    // <Static> based transcript (transcriptPane.tsx), completed turns
    // live in the terminal's native scrollback — letting the terminal
    // handle wheel scrolling natively gives the user a smoother and
    // more familiar experience than a custom turn-stepping hack.
    //
    // We swallow the events here so they don't leak into composer.
    const mouse = parseMouseEvent(_input)
    if (mouse.isMouse) {
      return
    }

    if (key.ctrl && _input === 'd') {
      gracefulExit()
      return
    }

    // Ctrl+T: toggle tool-call detail mode (compact ↔ expanded).
    // Surfaces full bash commands / grep patterns / file paths during
    // debugging without permanently cluttering the transcript.
    if (key.ctrl && _input === 't') {
      const next = $toolDetail.get() === 'compact' ? 'expanded' : 'compact'
      $toolDetail.set(next)
      $statusLine.set(`Tool detail: ${next}`)
      // Brief hint that fades on the next status update.
      setTimeout(() => {
        if ($statusLine.get() === `Tool detail: ${next}`) {
          $statusLine.set('')
        }
      }, 2000)
      return
    }

    // Ctrl+Y: toggle mouse tracking on / off.
    //
    // Mouse tracking is OFF by default — terminal owns the scrollback
    // and selection UX (you can drag-select with the mouse and roll
    // the wheel to view scrollback). This hotkey only matters if you
    // started the TUI with DRSAI_TUI_ENABLE_MOUSE_TRACKING=1: pressing
    // Ctrl+Y will release the mouse so you can copy, and pressing it
    // again restores program-side mouse capture. In the default
    // configuration the toggle is essentially a no-op (already off).
    if (key.ctrl && _input === 'y') {
      const next = !$copyMode.get()
      $copyMode.set(next)
      if (next) {
        disableMouseTracking()
        $statusLine.set('● Mouse released · drag to select / wheel to scroll · Ctrl+Y to recapture')
      } else {
        enableMouseTracking()
        $statusLine.set('Mouse recaptured by program')
        setTimeout(() => {
          if ($statusLine.get() === 'Mouse recaptured by program') {
            $statusLine.set('')
          }
        }, 2000)
      }
      return
    }

    if (key.ctrl && _input === 'c') {
      // Don't interfere with streaming-cancel: composerPane handles
      // Ctrl+C while $isStreaming === true. We only act when idle.
      if ($isStreaming.get()) return

      if (ctrlCArmedRef.current) {
        // Second press within the window → exit.
        ctrlCArmedRef.current = false
        if (ctrlCResetTimerRef.current) {
          clearTimeout(ctrlCResetTimerRef.current)
          ctrlCResetTimerRef.current = null
        }
        $statusLine.set('')
        gracefulExit()
        return
      }
      // First press → arm and show hint.
      ctrlCArmedRef.current = true
      $statusLine.set('Ctrl+C again within 2 s to exit · Ctrl+D also exits')
      if (ctrlCResetTimerRef.current) {
        clearTimeout(ctrlCResetTimerRef.current)
      }
      ctrlCResetTimerRef.current = setTimeout(() => {
        ctrlCArmedRef.current = false
        ctrlCResetTimerRef.current = null
        // Only clear if our hint is still the active status line.
        const cur = $statusLine.get()
        if (cur && cur.startsWith('Ctrl+C again')) {
          $statusLine.set('')
        }
      }, CTRL_C_DOUBLE_PRESS_MS)
      return
    }
  })

  // Switch the UI to a different session (used by /new and /switch).
  // Resets the transcript + streaming state and re-resumes the agent for sid.
  const switchSession = useCallback(
    async (sid: string) => {
      try {
        // Clear the in-memory transcript so the new session starts fresh in
        // the UI. (The DB-side history for the OLD session is untouched.)
        $transcript.set([])
        $current.set(null)
        // Reset cached usage badge — otherwise the StatusBar would keep
        // showing the previous session's token counts until the next turn
        // completes in the new session. We refill it below from history.
        $lastUsage.set(null)
        // Clear any stale memory preview from the previous session.
        $memoryPreview.set('')
        const result = await gw.request<SessionResumeResult>('session.resume', {
          session_id: sid,
        })

        // Pre-print memory banner BEFORE loading transcript into <Static>.
        if (result.memory_preview && result.memory_preview.trim()) {
          preprintMemoryBanner(result.memory_preview)
          $memoryPreview.set('')  // Clear to avoid duplicate in dynamic frame
        }

        // Load history for the new session (Issue #2 fix)
        if (result.history && result.history.length > 0) {
          const turns = parseHistory(result.history)
          setTranscript(turns)

          // Refill $lastUsage from the most recent assistant turn that
          // carries usage metadata so the StatusBar reflects this session
          // immediately after switching (instead of staying blank until
          // the user sends a new message).
          for (let i = turns.length - 1; i >= 0; i -= 1) {
            const t = turns[i]
            if (t.role === 'assistant' && t.usage) {
              $lastUsage.set({
                model: t.usage.model,
                prompt_tokens: t.usage.prompt_tokens,
                completion_tokens: t.usage.completion_tokens,
                total_tokens: t.usage.total_tokens,
              })
              break
            }
          }
        }

        const userId = (result as { user_id?: string }).user_id || $userId.get()
        if (userId) $userId.set(userId)
        setBoot(prev =>
          prev.phase === 'ready'
            ? { ...prev, sessionId: result.session.session_id }
            : prev,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setBoot({ phase: 'error', message: msg })
      }
    },
    [gw],
  )

  useEffect(() => {
    let cancelled = false

    // Create the controller up-front so the event handler can call
    // controller.finalize() when message.complete arrives. (prompt.submit
    // returns immediately now; the end-of-turn is event-driven.)
    const controller = new TurnController(gw)

    // Wire events first so we don't miss anything (session.info etc.)
    const handler = createGatewayEventHandler(gw, controller)
    const unsub = gw.onAny(handler)

    // Capture setup status from gateway.ready before deciding to boot.
    // Stored in a closure so the async block below can read it.
    interface SetupSnapshot {
      setup_required?: boolean
      config_exists?: boolean
    }
    let setupStatus: SetupSnapshot | null = null
    const unsubSetup = gw.onEvent('gateway.ready', ev => {
      const p = ev.payload as { setup?: SetupSnapshot } | undefined
      if (p?.setup) setupStatus = p.setup
    })

    // Listen for unexpected remote SSH disconnection.
    // When the user is connected via /remote and the WebSocket drops,
    // we show a reconnect prompt instead of exiting the TUI.
    const unsubRemoteLost = gw.onEvent('remote.lost', ev => {
      if (cancelled) return
      const p = ev.payload as { reason?: string } | undefined
      $connectionStatus.set('remote_lost')
      $connectionError.set(p?.reason || 'Remote connection lost')
      setBoot(prev => {
        // Only transition if we're in the ready phase — don't interrupt boot/setup
        if (prev.phase === 'ready') {
          return { phase: 'remote_lost', reason: p?.reason || 'Connection lost' }
        }
        return prev
      })
    })

    // Resolve session + ready phase. Reusable so SetupScreen.onComplete can
    // re-run it after the user enters credentials.
    async function resolveSession() {
      // Resolve session: most_recent for current cwd → create new (named after cwd)
      // Do NOT fall back to list[0] — that would grab some random old session
      // from an unrelated workdir.
      let session: SessionInfo | null = null
      const recent = await gw.request<{ session: SessionInfo | null; user_id?: string }>(
        'session.most_recent',
        {},
      )
      if (recent.user_id) $userId.set(recent.user_id)
      if (recent.session) {
        session = recent.session
      }
      if (!session) {
        const created = await gw.request<SessionCreateResult>('session.create', {
          name: process.env.DRSAI_SESSION_NAME || undefined,
        })
        session = created.session
        if (created.user_id) $userId.set(created.user_id)
      }

      if (cancelled) return
      setBoot({ phase: 'resuming', session })

      const result = await gw.request<SessionResumeResult>('session.resume', {
        session_id: session.session_id,
      })
      if (cancelled) return
      
      // Pre-print memory banner BEFORE loading transcript into <Static>.
      // This places it above transcript history in terminal scrollback.
      if (result.memory_preview && result.memory_preview.trim()) {
        preprintMemoryBanner(result.memory_preview)
        $memoryPreview.set('')  // Clear to avoid duplicate in dynamic frame
      }
      
      // ADDED: Load history into transcript (Issue #2 fix)
      if (result.history && result.history.length > 0) {
        const turns = parseHistory(result.history)
        setTranscript(turns)

        // Also seed $lastUsage from the most recent assistant turn that
        // carries usage so the StatusBar token badge is correct on cold
        // start, not just after the first message in this run.
        for (let i = turns.length - 1; i >= 0; i -= 1) {
          const t = turns[i]
          if (t.role === 'assistant' && t.usage) {
            $lastUsage.set({
              model: t.usage.model,
              prompt_tokens: t.usage.prompt_tokens,
              completion_tokens: t.usage.completion_tokens,
              total_tokens: t.usage.total_tokens,
            })
            break
          }
        }
      }
      
      const userId = (result as { user_id?: string }).user_id || $userId.get()
      if (userId) $userId.set(userId)

      setBoot({ phase: 'ready', sessionId: result.session.session_id, controller })
    }

    // Stash on the App's closure so SetupScreen can trigger it after save.
    setupCompleteHandlerRef.current = async () => {
      try {
        await resolveSession()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setBoot({ phase: 'error', message: msg })
      }
    }

    void (async () => {
      try {
        await gw.ready_()
        // The gateway.ready handler above has now run (synchronously, before
        // ready_ resolves), so setupStatus is populated if the gateway sent it.
        unsubSetup()
        if (cancelled) return

        // First-run or missing-API-key → drop into the interactive setup
        // screen. SetupScreen.onComplete will call our resolveSession later.
        const captured = setupStatus as SetupSnapshot | null
        if (captured?.setup_required) {
          setBoot({
            phase: 'setup',
            configExists: !!captured.config_exists,
          })
          return
        }

        await resolveSession()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!cancelled) setBoot({ phase: 'error', message: msg })
      }
    })()

    return () => {
      cancelled = true
      unsub()
      unsubRemoteLost()
    }
  }, [gw])

  if (boot.phase === 'connecting') {
    return <BootScreen text="connecting to gateway…" />
  }
  if (boot.phase === 'resuming') {
    return (
      <BootScreen
        text={`resuming session ${boot.session.name} (${boot.session.session_id.slice(0, 8)})… first run can take ~30-60s for skill loading`}
      />
    )
  }
  if (boot.phase === 'setup') {
    return (
      <SetupScreen
        gw={gw}
        configExists={boot.configExists}
        onComplete={() => {
          setBoot({ phase: 'connecting' })
          void setupCompleteHandlerRef.current?.()
        }}
      />
    )
  }
  if (boot.phase === 'error') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.error}>✗ Failed to start: {boot.message}</Text>
        <Text color={theme.muted} dimColor>press Ctrl+D to exit</Text>
      </Box>
    )
  }
  if (boot.phase === 'remote_lost') {
    return (
      <RemoteLostScreen
        reason={boot.reason}
        gw={gw}
        onReconnect={() => {
          setBoot({ phase: 'connecting' })
          // Reconnect is handled by the /remote panel — user opens it manually
        }}
        onSwitchToLocal={() => {
          setBoot({ phase: 'connecting' })
          // Switch back to local subprocess and re-boot
          void (async () => {
            try {
              await gw.switchToSubprocess()
              await gw.ready_()
              // Re-resolve session
              const recent = await gw.request<{ session: SessionInfo | null; user_id?: string }>(
                'session.most_recent',
                {},
              )
              if (recent.user_id) $userId.set(recent.user_id)
              let session: SessionInfo | null = recent.session || null
              if (!session) {
                const created = await gw.request<SessionCreateResult>('session.create', {})
                session = created.session
                if (created.user_id) $userId.set(created.user_id)
              }
              if (!session) throw new Error('Failed to create session')
              setBoot({ phase: 'resuming', session })
              const result = await gw.request<SessionResumeResult>('session.resume', {
                session_id: session.session_id,
              })
              if (result.history && result.history.length > 0) {
                const turns = parseHistory(result.history)
                setTranscript(turns)
              }
              const userId = (result as { user_id?: string }).user_id || $userId.get()
              if (userId) $userId.set(userId)
              setBoot(prev =>
                prev.phase === 'resuming'
                  ? { phase: 'ready', sessionId: result.session.session_id, controller: new TurnController(gw) }
                  : prev,
              )
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              setBoot({ phase: 'error', message: msg })
            }
          })()
        }}
      />
    )
  }

  return <AppLayout gw={gw} controller={boot.controller} sessionId={boot.sessionId} switchSession={switchSession} />
}

function BootScreen({ text }: { text: string }) {
  const conn = useStore($connectionStatus)
  const err = useStore($connectionError)
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Banner is pre-printed in entry.tsx; only show "· starting" here */}
      <Box>
        <Text color={theme.muted} dimColor>· starting</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.warn}>○ </Text>
        <Text color={theme.text}>{text}</Text>
      </Box>
      {err && (
        <Box marginTop={1}>
          <Text color={theme.error}>{err}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>status: {conn}</Text>
      </Box>
    </Box>
  )
}

/**
 * Shown when the remote SSH WebSocket connection drops unexpectedly.
 * Gives the user three options: reconnect via /remote panel, switch back
 * to local mode, or exit.
 */
function RemoteLostScreen({
  reason,
  gw,
  onReconnect,
  onSwitchToLocal,
}: {
  reason: string
  gw: GatewayClient
  onReconnect: () => void
  onSwitchToLocal: () => void
}) {
  const { exit } = useApp()

  useInput((input, key) => {
    if (input === 'r' || input === 'R') {
      // Open /remote panel for reconnection — but we need to switch to
      // local mode first so the user can interact with the local gateway
      // to issue remote.connect again.
      onReconnect()
      return
    }
    if (input === 'l' || input === 'L') {
      onSwitchToLocal()
      return
    }
    if (key.ctrl && input === 'd') {
      gw.kill()
      exit()
      return
    }
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginTop={1}>
        <Text color={theme.error} bold>⚠  Remote connection lost</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text}>{reason}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.muted}>Choose an action:</Text>
        <Text color={theme.warn}>  [R] — Reconnect (switch to local, then open /remote panel)</Text>
        <Text color={theme.good}>  [L] — Switch to local mode</Text>
        <Text color={theme.muted}>  [Ctrl+D] — Exit</Text>
      </Box>
    </Box>
  )
}
