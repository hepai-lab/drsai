/**
 * ComposerPane — composer area with TextInput, hooked to TurnController.
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useApp, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'

import { loadPromptHistory, savePromptHistory } from '../app/promptHistory.js'
import { $isStreaming } from '../app/turnStore.js'
import type { TurnController } from '../app/turnController.js'
import type { SessionInfo, SessionListResult } from '../gatewayTypes.js'
import { theme } from '../theme.js'

import { ModelPicker, type ModelEntry } from './modelPicker.js'
import { SessionPicker } from './sessionPicker.js'
import { SlashOutputOverlay } from './slashOutputOverlay.js'
import { TextInput } from './textInput.js'

export interface ComposerPaneProps {
  sessionId: string
  controller: TurnController
  switchSession: (sid: string) => Promise<void>
}

export function ComposerPane({ sessionId, controller, switchSession }: ComposerPaneProps) {
  const { exit } = useApp()
  const isStreaming = useStore($isStreaming)
  const [slashOutput, setSlashOutput] = useState<string | null>(null)
  const slashOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sessionPicker, setSessionPicker] = useState<SessionInfo[] | null>(null)
  const [modelPicker, setModelPicker] = useState<ModelEntry[] | null>(null)
  const [completions, setCompletions] = useState<string[]>([])
  const [initialHistory] = useState(() => loadPromptHistory())
  const historyRef = useRef<string[]>(initialHistory)

  // Long-paste collapsing: when a paste exceeds the threshold we insert a
  // ``[[ Pasted #N: ... → /path/to/paste.txt ]]`` token into the visible input
  // and remember the real text in ``pasteSnipsRef``. On submit we substitute
  // the token back to the real text for the agent, while the transcript keeps
  // the compact token so huge logs/code files do not flood the TUI.
  const pasteSnipsRef = useRef<Array<{ inputLabel: string; displayLabel: string; text: string; path?: string }>>([])
  const pasteCounterRef = useRef(0)

  function clearSlashOutputTimer() {
    if (slashOutputTimerRef.current) {
      clearTimeout(slashOutputTimerRef.current)
      slashOutputTimerRef.current = null
    }
  }

  function showSlashOutput(output: string, timeoutMs?: number) {
    clearSlashOutputTimer()
    setSlashOutput(output)
    if (timeoutMs && timeoutMs > 0) {
      slashOutputTimerRef.current = setTimeout(() => {
        setSlashOutput(null)
        slashOutputTimerRef.current = null
      }, timeoutMs)
    }
  }

  function dismissSlashOutput() {
    clearSlashOutputTimer()
    setSlashOutput(null)
  }

  useEffect(() => clearSlashOutputTimer, [])

  // Load slash command catalog once for Tab completion
  useEffect(() => {
    let cancelled = false
    controller.gw
      .request<{ pairs: [string, string][] }>('commands.catalog', {})
      .then(result => {
        if (cancelled) return
        const cmds = (result.pairs || []).map(([name]) => '/' + name)
        setCompletions(cmds)
      })
      .catch(() => {/* ignore */})
    return () => {
      cancelled = true
    }
  }, [controller])

  // While streaming, capture Ctrl+C to cancel without exiting the app.
  useInput((_input, key) => {
    if (isStreaming && key.ctrl && _input === 'c') {
      controller.cancel(sessionId)
    }
  })

  async function openSessionPicker() {
    try {
      const result = await controller.gw.request<SessionListResult>('session.list', { limit: 50 })
      setSessionPicker(result.sessions || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Error loading sessions: ${msg}`, 5000)
    }
  }

  async function openModelPicker() {
    try {
      const result = await controller.gw.request<{ models: ModelEntry[]; current?: string }>(
        'model.options',
        {},
      )
      setModelPicker(result.models || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Error loading models: ${msg}`, 5000)
    }
  }

  // Threshold above which a paste collapses to a placeholder token.
  const LARGE_PASTE_CHARS = 1000
  const LARGE_PASTE_LINES = 20

  function maybeCollapsePaste(pasted: string): string | undefined {
    const lineCount = pasted.split('\n').length
    if (pasted.length < LARGE_PASTE_CHARS && lineCount < LARGE_PASTE_LINES) {
      return undefined // small enough, fall back to literal insertion
    }

    pasteCounterRef.current += 1
    const localId = pasteCounterRef.current
    const head = pasted.slice(0, 24).replace(/\s+/g, ' ').trim() || 'text'
    const fallbackLabel = `[[ Pasted #${localId}: ${head}… ${pasted.length} chars, ${lineCount} lines ]]`
    pasteSnipsRef.current.push({ inputLabel: fallbackLabel, displayLabel: fallbackLabel, text: pasted })

    // Best effort: ask backend to save a .txt copy and return a path-backed
    // label. The callback must be synchronous, so the first render may show the
    // fallback label; the final submitted transcript will use the path label if
    // the RPC finishes before submit.
    controller.gw
      .request<{ placeholder?: string; path?: string }>('paste.collapse', { text: pasted })
      .then(result => {
        if (!result.placeholder && !result.path) return
        const pathLabel = result.placeholder || `[[ Pasted #${localId}: ${pasted.length} chars, ${lineCount} lines → ${result.path} ]]`
        pasteSnipsRef.current = pasteSnipsRef.current.map(s =>
          s.inputLabel === fallbackLabel ? { ...s, displayLabel: pathLabel, path: result.path } : s,
        )
      })
      .catch(() => {})

    return fallbackLabel
  }

  function expandSnips(text: string): string {
    if (pasteSnipsRef.current.length === 0) return text
    let out = text
    for (const snip of pasteSnipsRef.current) {
      // Replace ONLY occurrences that survived editing — if the user deleted
      // the token before submitting, the real text stays out too.
      out = out.split(snip.inputLabel).join(snip.text)
    }
    return out
  }

  function displaySnips(text: string): string {
    if (pasteSnipsRef.current.length === 0) return text
    let out = text
    for (const snip of pasteSnipsRef.current) {
      out = out.split(snip.inputLabel).join(snip.displayLabel)
    }
    return out
  }

  function resetPasteSnips() {
    pasteSnipsRef.current = []
    pasteCounterRef.current = 0
  }

  async function handleSubmit(text: string) {
    const expanded = expandSnips(text)
    const displayText = displaySnips(text)
    resetPasteSnips()
    const trimmed = expanded.trim()

    // Detect slash command
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const command = parts[0]
      const args = parts.slice(1).join(' ')

      // Special case: /quit should exit
      if (command === 'quit' || command === 'exit' || command === 'q') {
        controller.gw.kill()
        exit()
        return
      }

      // Interactive pickers (when called with no args)
      if ((command === 'list' || command === 'ls' || command === 'switch') && !args) {
        await openSessionPicker()
        return
      }
      if ((command === 'model' || command === 'm') && !args) {
        await openModelPicker()
        return
      }

      // Execute via slash.exec RPC
      try {
        const result = await controller.gw.request('slash.exec', {
          session_id: sessionId,
          command,
          args,
        }) as { output?: string; ui_action?: string; name?: string; target?: string; n?: number }
        const output = result.output || '(no output)'

        // Handle UI actions returned by handlers
        switch (result.ui_action) {
          case 'session.new': {
            try {
              const created = await controller.gw.request<{
                session_id: string
                session: SessionInfo
                user_id: string
              }>('session.create', {
                name: result.name || undefined,
              })
              showSlashOutput(`New session created: ${created.session.name} — switching…`, 3000)
              // Switch UI to the freshly created session.
              await switchSession(created.session_id)
            } catch (err) {
              showSlashOutput(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`, 5000)
            }
            return
          }
          case 'session.list':
          case 'session.switch': {
            // If user provided a target prefix, try direct resume
            if (result.target) {
              try {
                await switchSession(result.target)
                showSlashOutput(`Switched to: ${result.target}`, 3000)
              } catch (err) {
                showSlashOutput(`Switch failed: ${err instanceof Error ? err.message : String(err)}`, 5000)
              }
              return
            }
            // Otherwise pop the picker
            await openSessionPicker()
            return
          }
          case 'copy.reply': {
            // Future: read $transcript, emit OSC 52
            showSlashOutput('Clipboard copy not yet wired (OSC 52 pending).', 5000)
            return
          }
          case 'clear': {
            // Clear is handled by terminal scrollback; just hide message
            setSlashOutput(null)
            return
          }
        }

        // Keep informational slash-command output visible until the user dismisses it.
        showSlashOutput(output)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        showSlashOutput(`Error: ${msg}`, 5000)
      }
      return
    }

    // Regular prompt
    await controller.submit({ sessionId, text: trimmed, displayText: displayText.trim() })
  }

  // Session picker overlay
  if (sessionPicker) {
    return (
      <SessionPicker
        sessions={sessionPicker}
        currentId={sessionId}
        onSelect={async sid => {
          setSessionPicker(null)
          try {
            await switchSession(sid)
            showSlashOutput(`Switched to session ${sid.slice(0, 8)}`, 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`Switch failed: ${msg}`, 5000)
          }
        }}
        onCancel={() => setSessionPicker(null)}
      />
    )
  }

  // Model picker overlay
  if (modelPicker) {
    return (
      <ModelPicker
        models={modelPicker}
        onSelect={async alias => {
          setModelPicker(null)
          try {
            await controller.gw.request('slash.exec', {
              session_id: sessionId,
              command: 'model',
              args: alias,
            })
            showSlashOutput(`Switched to model: ${alias}`, 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`Switch failed: ${msg}`, 5000)
          }
        }}
        onCancel={() => setModelPicker(null)}
      />
    )
  }

  if (slashOutput && !slashOutputTimerRef.current) {
    return <SlashOutputOverlay output={slashOutput} onDismiss={dismissSlashOutput} />
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
      {slashOutput && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.muted}>{slashOutput}</Text>
        </Box>
      )}
      {isStreaming ? (
        <Box>
          <Text color={theme.warn}>⏳ </Text>
          <Text color={theme.muted}>streaming… (Ctrl+C to cancel)</Text>
        </Box>
      ) : (
        <TextInput
          prompt=" › "
          placeholder="type a message (Alt+Enter/Ctrl+O newline, / commands, Tab complete, ↑/↓ history)"
          onSubmit={handleSubmit}
          completions={completions}
          history={historyRef.current}
          onHistoryChange={savePromptHistory}
          onPaste={maybeCollapsePaste}
        />
      )}
    </Box>
  )
}
