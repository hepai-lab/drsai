/**
 * SchedulerPanel — interactive overlay for managing scheduled tasks.
 *
 * Triggered by `/schedule` (no args). Shows a list of scheduled tasks
 * with shortcuts to run, cancel, and create new tasks.
 *
 *   ↑↓ navigate · r run · d delete · n new · q quit
 */

import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import type { ScheduledTask } from '../gatewayTypes.js'
import { theme } from '../theme.js'

interface Props {
  gw: GatewayClient
  sessionId: string
  onDismiss: () => void
}

export function SchedulerPanel({ gw, sessionId, onDismiss }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [cursor, setCursor] = useState(0)
  const [message, setMessage] = useState('')
  const [view, setView] = useState<'list' | 'create'>('list')
  // Create form state
  const [createName, setCreateName] = useState('')
  const [createSchedule, setCreateSchedule] = useState('')
  const [createPrompt, setCreatePrompt] = useState('')
  const [createField, setCreateField] = useState(0) // 0=name, 1=schedule, 2=prompt

  const refresh = useCallback(async () => {
    try {
      const res = await gw.request<{ tasks: ScheduledTask[] }>('scheduler.list', {})
      setTasks(res.tasks || [])
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }, [gw])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  async function createTask() {
    if (!createPrompt.trim() || !createSchedule.trim()) {
      setMessage('Error: schedule and prompt are required')
      return
    }
    try {
      await gw.request('scheduler.create', {
        name: createName || undefined,
        prompt: createPrompt,
        schedule: createSchedule,
        session_id: sessionId,
      })
      setMessage(`✓ Task "${createName || 'unnamed'}" created`)
      setCreateName('')
      setCreateSchedule('')
      setCreatePrompt('')
      setCreateField(0)
      setView('list')
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  async function runTask(task: ScheduledTask) {
    try {
      await gw.request('scheduler.run', { task_id: task.id })
      setMessage(`✓ Task "${task.name}" started`)
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  async function cancelTask(task: ScheduledTask) {
    try {
      await gw.request('scheduler.cancel', { task_id: task.id })
      setMessage(`✓ Task "${task.name}" cancelled`)
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  useInput((input, key) => {
    if (view === 'create') {
      if (key.escape) {
        setView('list')
        return
      }
      if (key.return) {
        if (createField < 2) {
          setCreateField(f => f + 1)
        } else {
          createTask()
        }
        return
      }
      if (key.tab) {
        setCreateField(f => (f + 1) % 3)
        return
      }
      if (key.backspace) {
        if (createField === 0) setCreateName(s => s.slice(0, -1))
        else if (createField === 1) setCreateSchedule(s => s.slice(0, -1))
        else setCreatePrompt(s => s.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        if (createField === 0) setCreateName(s => s + input)
        else if (createField === 1) setCreateSchedule(s => s + input)
        else setCreatePrompt(s => s + input)
      }
      return
    }

    // List view
    if (key.escape || input === 'q') {
      onDismiss()
      return
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(tasks.length - 1, c + 1))
    if (input === 'n') {
      setView('create')
      setCreateField(0)
      return
    }
    if (input === 'r' && tasks[cursor]) runTask(tasks[cursor])
    if (input === 'd' && tasks[cursor]) cancelTask(tasks[cursor])
  })

  // ── Create view ──────────────────────────────────────────
  if (view === 'create') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>⏰ Create Scheduled Task</Text>
        </Box>
        <Text color={createField === 0 ? theme.accent : theme.text}>
          {createField === 0 ? '▶' : ' '} Name: {createName || '(optional)'}
        </Text>
        <Text color={createField === 1 ? theme.accent : theme.text}>
          {createField === 1 ? '▶' : ' '} Schedule: {createSchedule || '(interval:N or once)'}
        </Text>
        <Text color={createField === 2 ? theme.accent : theme.text}>
          {createField === 2 ? '▶' : ' '} Prompt: {createPrompt || '(required)'}
        </Text>
        {message && <Text color={theme.warn}>{message}</Text>}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Tab/Enter next field · Enter on last field to create · Esc cancel</Text>
        </Box>
      </Box>
    )
  }

  // ── List view ────────────────────────────────────────────
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>⏰ Scheduled Tasks</Text>
        <Text color={theme.muted} dimColor>  ({tasks.length} task{tasks.length !== 1 ? 's' : ''})</Text>
      </Box>

      {tasks.length === 0 ? (
        <Text color={theme.muted}>  No scheduled tasks. Press 'n' to create one.</Text>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.muted} dimColor>
            {'  ID'.padEnd(10)} {'Name'.padEnd(20)} {'Schedule'.padEnd(16)} {'Status'.padEnd(12)}
          </Text>
          {tasks.map((t, i) => {
            const isCursor = i === cursor
            const prefix = isCursor ? '▶ ' : '  '
            const statusIcon = {
              scheduled: '⏰', running: '🔄', completed: '✅',
              cancelled: '❌', error: '⚠',
            }[t.status] || '?'
            return (
              <Text key={t.id} color={isCursor ? theme.accent : theme.text} bold={isCursor}>
                {prefix}{t.id.padEnd(10)} {t.name.slice(0, 18).padEnd(20)} {t.schedule.slice(0, 14).padEnd(16)} {statusIcon} {t.status}
              </Text>
            )
          })}
        </Box>
      )}

      {message && (
        <Box marginTop={1}>
          <Text color={theme.warn}>{message}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑↓ navigate · r run · d delete · n new · q quit
        </Text>
      </Box>
    </Box>
  )
}
