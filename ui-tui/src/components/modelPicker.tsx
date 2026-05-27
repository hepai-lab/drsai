/**
 * ModelPicker — overlay for selecting an LLM model.
 *
 * Triggered by `/model` (without args). Displays available models from
 * `model.options` RPC; Enter switches the current session, Esc cancels.
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { theme } from '../theme.js'

export interface ModelEntry {
  alias: string
  model_name?: string
  reasoning?: string[]
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

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.return) {
      const selected = models[cursor]
      if (selected) onSelect(selected.alias)
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setCursor(Math.max(0, cursor - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setCursor(Math.min(models.length - 1, cursor + 1))
      return
    }
    // Editor shortcuts (only when handlers wired in)
    if (input === 'a' && onAdd) {
      onAdd()
      return
    }
    if (input === 'e' && onEdit && models[cursor]) {
      onEdit(models[cursor].alias)
      return
    }
    if (input === 'd' && onDelete && models[cursor]) {
      onDelete(models[cursor].alias)
      return
    }
    if (input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1
      if (idx < models.length) {
        setCursor(idx)
        onSelect(models[idx].alias)
      }
      return
    }
    if (input.length === 1 && input >= 'f' && input <= 'z') {
      // Letter shortcuts start at 'f' (so a/e/d are reserved for actions)
      const idx = 9 + (input.charCodeAt(0) - 'f'.charCodeAt(0))
      if (idx < models.length) {
        setCursor(idx)
        onSelect(models[idx].alias)
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
      <Box marginTop={1} flexDirection="column">
        {models.map((m, i) => {
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
          return (
            <Box key={m.alias}>
              <Text color={color}>
                {prefix}
                {idx} {m.alias.padEnd(20)}
                {m.model_name && ` — ${m.model_name}`}
                {reasoning}
                {isCurrent && ' ← current'}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ navigate · Enter select · a add · e edit · d delete · Esc cancel · {models.length} total
        </Text>
      </Box>
    </Box>
  )
}
