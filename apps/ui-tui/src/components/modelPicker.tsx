/**
 * ModelPicker — overlay for selecting an LLM model.
 *
 * Triggered by `/model` (without args). Displays available models from
 * `model.options` RPC merged with runtime-discovered models; Enter switches
 * the current session, Esc cancels.
 *
 * Layout:
 *   - A scrolling window of WINDOW_SIZE rows; ↑/↓ (and mouse wheel, which
 *     most terminals translate to ↑/↓ keys) scroll the window when the
 *     cursor reaches the edge. PgUp/PgDn jump a window.
 *   - The current/default model is centered in the window on open.
 *   - Predefined models (from llm_mode_config) show a 1..n numeric index;
 *     runtime-discovered extras show no index.
 *   - Press `/` to enter prefix search; typing filters by alias / model_name
 *     / provider (substring match). Backspace edits, Enter exits search,
 *     Esc cancels search (or the picker).
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
  /** True for models from llm_mode_config (predefined); false for runtime-discovered extras. */
  predefined?: boolean
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

const WINDOW_SIZE = 10

export function ModelPicker({
  models,
  currentAlias,
  onSelect,
  onCancel,
  onAdd,
  onEdit,
  onDelete,
}: ModelPickerProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? models.filter(model => `${model.alias} ${model.model_name || ''} ${model.provider || ''}`.toLowerCase().includes(needle)) : models
  }, [models, query])

  // Initial cursor + offset: center the current/default model in the window.
  const [cursor, setCursor] = useState(() => {
    if (currentAlias) {
      const idx = models.findIndex(m => m.alias === currentAlias)
      return idx >= 0 ? idx : 0
    }
    return 0
  })
  const [offset, setOffset] = useState(() => {
    if (currentAlias) {
      const idx = models.findIndex(m => m.alias === currentAlias)
      if (idx >= 0) {
        return Math.max(0, Math.min(
          models.length - WINDOW_SIZE,
          idx - Math.floor(WINDOW_SIZE / 2),
        ))
      }
    }
    return 0
  })

  // Reset viewport when the filtered list changes (search edited).
  useEffect(() => {
    // Keep the cursor on the current model if it's still visible, else 0.
    let next = 0
    if (currentAlias) {
      const idx = filteredModels.findIndex(m => m.alias === currentAlias)
      if (idx >= 0) next = idx
    }
    setCursor(next)
    setOffset(Math.max(0, Math.min(
      Math.max(0, filteredModels.length - WINDOW_SIZE),
      next - Math.floor(WINDOW_SIZE / 2),
    )))
  }, [filteredModels, currentAlias])

  // Move cursor and drag the window along so the cursor stays visible.
  function adjustWindow(newCursor: number) {
    setCursor(newCursor)
    if (newCursor < offset) {
      setOffset(newCursor)
    } else if (newCursor >= offset + WINDOW_SIZE) {
      setOffset(newCursor - WINDOW_SIZE + 1)
    }
  }

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
      adjustWindow(Math.max(0, cursor - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      adjustWindow(Math.min(filteredModels.length - 1, cursor + 1))
      return
    }
    if (key.pageUp) {
      adjustWindow(Math.max(0, cursor - WINDOW_SIZE))
      return
    }
    if (key.pageDown) {
      adjustWindow(Math.min(filteredModels.length - 1, cursor + WINDOW_SIZE))
      return
    }
    if (key.home) { adjustWindow(0); return }
    if (key.end) { adjustWindow(filteredModels.length - 1); return }
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
      // Direct-select the n-th *predefined* model (1-based). Discovered extras
      // have no numeric shortcut — use ↑/↓ + Enter or / search.
      const predefined = filteredModels.filter(m => m.predefined)
      const idx = parseInt(input, 10) - 1
      if (idx < predefined.length) {
        const target = predefined[idx]
        const targetIdx = filteredModels.indexOf(target)
        if (targetIdx >= 0) adjustWindow(targetIdx)
        onSelect(target.alias)
      }
      return
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

  const visible = filteredModels.slice(offset, offset + WINDOW_SIZE)
  const showingTo = Math.min(offset + WINDOW_SIZE, filteredModels.length)

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>Select model</Text>
        <Text color={theme.muted} dimColor>  ({offset + 1}-{showingTo} of {filteredModels.length})</Text>
      </Box>
      <Text color={searching ? theme.accent : theme.muted}>Search: {query || (searching ? 'type to filter…' : 'press /')}</Text>

      {offset > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>  ↑ ({offset} more above)</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {(() => {
          // Assign 1..n numeric indices to predefined models only, counting
          // over the *entire* filtered list so the index is stable as the
          // window scrolls.
          let predefinedCounter = 0
          const predefinedUpToWindow = filteredModels.slice(0, offset).filter(m => m.predefined).length
          predefinedCounter = predefinedUpToWindow
          return visible.map((m, i) => {
          const absIdx = offset + i
          const isCurrent = m.alias === currentAlias
          const isCursor = absIdx === cursor
          const prefix = isCursor ? '▶ ' : '  '
          const color = isCursor ? theme.accent : isCurrent ? theme.good : theme.text
          // Numeric index for predefined models; discovered extras get no index.
          let idx: string
          if (m.predefined) {
            predefinedCounter += 1
            idx = `${predefinedCounter}.`
          } else {
            idx = '  '
          }
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
        })
        })()}
      </Box>

      {showingTo < filteredModels.length && (
        <Box>
          <Text color={theme.muted} dimColor>  ↓ ({filteredModels.length - showingTo} more below)</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ or wheel scroll · PgUp/PgDn page · / search · Enter select · 1-9 pick predefined · a add · e edit · d delete · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}
