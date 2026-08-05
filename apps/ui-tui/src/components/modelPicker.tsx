/**
 * ModelPicker — overlay for selecting an LLM model.
 *
 * Triggered by `/model` (without args). Displays available models from
 * `model.options` RPC; Enter switches the current session, Esc cancels.
 */

import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import { theme } from '../theme.js'

export interface ModelEntry {
  alias: string
  model_name?: string
  reasoning?: string[]
  provider?: string
  known_model?: boolean
}

export interface ModelPickerProps {
  models: ModelEntry[]
  currentAlias?: string
  onSelect: (alias: string) => void
  onCancel: () => void
  /** Pressed `a` — request the add-model editor. */
  onAdd?: () => void
  /** Pressed `e` on the highlighted entry — request the edit editor. */
  onEdit?: (alias: string) => void
  /** Pressed `d` on the highlighted entry — request deletion. */
  onDelete?: (alias: string) => void
}

export function ModelPicker({
  models,
  currentAlias,
  onSelect,
  onCancel,
  onAdd,
  onEdit,
  onDelete,
}: ModelPickerProps) {
  const [cursor, setCursor] = useState(() => {
    if (currentAlias) {
      const idx = models.findIndex(m => m.alias === currentAlias)
      return idx >= 0 ? idx : 0
    }
    return 0
  })
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? models.filter(model => `${model.alias} ${model.model_name || ''} ${model.provider || ''}`.toLowerCase().includes(needle)) : models
  }, [models, query])
  useEffect(() => setCursor(0), [query])

  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return
    if (key.escape) {
      if (searching) { setSearching(false); setQuery(''); return }
      onCancel()
      return
    }
    if (searching) {
      if (key.return) { setSearching(false); return }
      if (key.backspace || key.delete) { setQuery(value => value.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setQuery(value => value + input)
      return
    }
    if (input === '/') { setSearching(true); return }
    if (key.return) {
      const selected = filteredModels[cursor]
      if (selected) onSelect(selected.alias)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setCursor(Math.max(0, cursor - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setCursor(Math.min(filteredModels.length - 1, cursor + 1))
      return
    }
    // Editor shortcuts (only when handlers wired in)
    if (input === 'a' && onAdd) {
      onAdd()
      return
    }
    if (input === 'e' && onEdit && filteredModels[cursor]) {
      onEdit(filteredModels[cursor].alias)
      return
    }
    if (input === 'd' && onDelete && filteredModels[cursor]) {
      onDelete(filteredModels[cursor].alias)
      return
    }
    if (input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1
      if (idx < filteredModels.length) {
        setCursor(idx)
        onSelect(filteredModels[idx].alias)
      }
      return
    }
    if (input.length === 1 && input >= 'f' && input <= 'z') {
      // Letter shortcuts start at 'f' (so a/e/d are reserved for actions)
      const idx = 9 + (input.charCodeAt(0) - 'f'.charCodeAt(0))
      if (idx < filteredModels.length) {
        setCursor(idx)
        onSelect(filteredModels[idx].alias)
      }
    }
  })

  if (models.length === 0) {
    return (
      <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexDirection="column">
        <Text color={theme.warn}>No models configured</Text>
        <Text color={theme.muted} dimColor>Press a to add one, Esc to dismiss</Text>
      </Box>
    )
  }

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Text color={theme.primary} bold>
        Select model
      </Text>
      <Text color={searching ? theme.accent : theme.muted}>Search: {query || (searching ? 'type to filter…' : 'press /')}</Text>
      <Box marginTop={1} flexDirection="column">
        {filteredModels.map((m, i) => {
          const isCurrent = m.alias === currentAlias
          const isCursor = i === cursor
          const prefix = isCursor ? '▶ ' : '  '
          const color = isCursor ? theme.accent : isCurrent ? theme.good : theme.text
          // Numeric shortcut for first 9, letter shortcut f-z for next 21
          let idx: string
          if (i < 9) idx = `${i + 1}.`
          else if (i < 9 + 21) idx = `${String.fromCharCode('f'.charCodeAt(0) + i - 9)}.`
          else idx = '  '
          const reasoning = m.reasoning && m.reasoning.length > 0
            ? ` [reasoning: ${m.reasoning.join(',')}]`
            : ''
          const calibration = m.known_model === false ? ' [capabilities uncalibrated]' : ''
          return (
            <Box key={m.alias}>
              <Text color={color}>
                {prefix}
                {idx} {m.alias.padEnd(20)}
                {m.model_name && ` — ${m.model_name}`}
                {reasoning}
                {calibration}
                {isCurrent && ' ← current'}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ navigate · / search · Enter select · a add · e edit · d delete · Esc cancel · {filteredModels.length}/{models.length}
        </Text>
      </Box>
    </Box>
  )
}
