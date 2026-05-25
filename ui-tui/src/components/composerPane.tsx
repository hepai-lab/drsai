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
  const [sessionPicker, setSessionPicker] = useState<SessionInfo[] | null>(null)
  const [modelPicker, setModelPicker] = useState<ModelEntry[] | null>(null)
  const [completions, setCompletions] = useState<string[]>([])
  const [initialHistory] = useState(() => loadPromptHistory())
  const historyRef = useRef<string[]>(initialHistory)

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
      setSlashOutput(`Error loading sessions: ${msg}`)
      setTimeout(() => setSlashOutput(null), 5000)
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
      setSlashOutput(`Error loading models: ${msg}`)
      setTimeout(() => setSlashOutput(null), 5000)
    }
  }

  async function handleSubmit(text: string) {
    const trimmed = text.trim()

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
              setSlashOutput(`New session created: ${created.session.name} — switching…`)
              // Switch UI to the freshly created session.
              await switchSession(created.session_id)
              setTimeout(() => setSlashOutput(null), 3000)
            } catch (err) {
              setSlashOutput(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`)
              setTimeout(() => setSlashOutput(null), 5000)
            }
            return
          }
          case 'session.list':
          case 'session.switch': {
            // If user provided a target prefix, try direct resume
            if (result.target) {
              try {
                await switchSession(result.target)
                setSlashOutput(`Switched to: ${result.target}`)
              } catch (err) {
                setSlashOutput(`Switch failed: ${err instanceof Error ? err.message : String(err)}`)
              }
              setTimeout(() => setSlashOutput(null), 3000)
              return
            }
            // Otherwise pop the picker
            await openSessionPicker()
            return
          }
          case 'copy.reply': {
            // Future: read $transcript, emit OSC 52
            setSlashOutput('Clipboard copy not yet wired (OSC 52 pending).')
            setTimeout(() => setSlashOutput(null), 5000)
            return
          }
          case 'clear': {
            // Clear is handled by terminal scrollback; just hide message
            setSlashOutput(null)
            return
          }
        }

        setSlashOutput(output)
        // Clear after 5 seconds
        setTimeout(() => setSlashOutput(null), 5000)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setSlashOutput(`Error: ${msg}`)
        setTimeout(() => setSlashOutput(null), 5000)
      }
      return
    }

    // Regular prompt
    await controller.submit({ sessionId, text: trimmed })
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
            setSlashOutput(`Switched to session ${sid.slice(0, 8)}`)
            setTimeout(() => setSlashOutput(null), 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setSlashOutput(`Switch failed: ${msg}`)
            setTimeout(() => setSlashOutput(null), 5000)
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
            setSlashOutput(`Switched to model: ${alias}`)
            setTimeout(() => setSlashOutput(null), 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setSlashOutput(`Switch failed: ${msg}`)
            setTimeout(() => setSlashOutput(null), 5000)
          }
        }}
        onCancel={() => setModelPicker(null)}
      />
    )
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
        />
      )}
    </Box>
  )
}
