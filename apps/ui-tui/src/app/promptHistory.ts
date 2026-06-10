/**
 * Persistent prompt history for the TUI composer.
 *
 * TextInput keeps history in-memory for fast ↑/↓ navigation. This module
 * loads/saves that history across TUI restarts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const MAX_PROMPT_HISTORY = 500

export function getPromptHistoryPath(): string {
  const explicit = process.env.DRSAI_TUI_HISTORY_FILE?.trim()
  if (explicit) return explicit
  return join(homedir(), '.drsai', 'tui_prompt_history.json')
}

export function loadPromptHistory(): string[] {
  const path = getPromptHistoryPath()
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(-MAX_PROMPT_HISTORY)
  } catch {
    return []
  }
}

export function savePromptHistory(history: string[]): void {
  const path = getPromptHistoryPath()
  const cleaned = history
    .filter(item => typeof item === 'string' && item.trim().length > 0)
    .slice(-MAX_PROMPT_HISTORY)

  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(cleaned, null, 2) + '\n', 'utf8')
  } catch {
    // History persistence should never break the TUI.
  }
}
