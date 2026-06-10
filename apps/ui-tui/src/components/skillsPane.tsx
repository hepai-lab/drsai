/**
 * SkillsPane — interactive TUI panel for browsing and managing user skills.
 *
 * Activated by the /skills slash command in composerPane.
 *
 * Features:
 *   - List all installed user skills (name + description)
 *   - Show full SKILL.md content for a selected skill
 *   - Delete a skill with confirmation
 *   - Reload skills on the active agent without restarting
 *
 * Navigation:
 *   ↑ / ↓  — move cursor
 *   Enter   — show skill detail
 *   d       — delete highlighted skill (prompts confirmation)
 *   r       — reload skills on current agent session
 *   Esc / q — dismiss / go back
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

// ── Types ─────────────────────────────────────────────────────────────

interface SkillInfo {
  name: string
  description: string
  dir: string
  size: number
  mtime: number
}

type PaneView =
  | { kind: 'list' }
  | { kind: 'detail'; skill: SkillInfo; content: string; path: string }
  | { kind: 'confirm-delete'; skill: SkillInfo }
  | { kind: 'message'; text: string; isError?: boolean }

// ── Props ─────────────────────────────────────────────────────────────

export interface SkillsPaneProps {
  gw: GatewayClient
  sessionId: string
  /** Called when the user presses Esc or q on the root list. */
  onDismiss: () => void
}

// ── Component ─────────────────────────────────────────────────────────

export function SkillsPane({ gw, sessionId, onDismiss }: SkillsPaneProps) {
  const [view, setView] = useState<PaneView>({ kind: 'list' })
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load skills on mount.
  // We use a plain effect via useEffect — but since Ink renders synchronously
  // and we can't use hooks conditionally, we trigger it once via a flag.
  const [didLoad, setDidLoad] = useState(false)
  if (!didLoad) {
    setDidLoad(true)
    gw.request<{ skills: SkillInfo[] }>('skills.manage', { action: 'list' })
      .then(res => {
        setSkills(res.skills ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setLoadError(msg)
        setLoading(false)
      })
  }

  // ── Input handler ──────────────────────────────────────────────────
  useInput((_input, key) => {
    // ── In list view ───────────────────────────────────────────────
    if (view.kind === 'list') {
      if (key.escape || _input === 'q') {
        onDismiss()
        return
      }
      if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setCursor(c => Math.min(skills.length - 1, c + 1))
        return
      }
      if (key.return && skills.length > 0) {
        const skill = skills[cursor]
        if (!skill) return
        setView({ kind: 'message', text: 'Loading…' })
        gw.request<{ content: string; path: string }>('skills.manage', {
          action: 'show',
          name: skill.name,
        })
          .then(res => setView({ kind: 'detail', skill, content: res.content, path: res.path }))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            setView({ kind: 'message', text: `Error: ${msg}`, isError: true })
          })
        return
      }
      if (_input === 'd' && skills.length > 0) {
        const skill = skills[cursor]
        if (skill) setView({ kind: 'confirm-delete', skill })
        return
      }
      if (_input === 'r') {
        setView({ kind: 'message', text: 'Reloading skills on agent…' })
        gw.request('skills.manage', { action: 'reload', session_id: sessionId })
          .then(() => setView({ kind: 'message', text: '✓ Skills reloaded.' }))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            setView({ kind: 'message', text: `Reload failed: ${msg}`, isError: true })
          })
        return
      }
    }

    // ── In detail view ─────────────────────────────────────────────
    if (view.kind === 'detail') {
      if (key.escape || _input === 'q' || key.return) {
        setView({ kind: 'list' })
        return
      }
    }

    // ── In confirm-delete view ─────────────────────────────────────
    if (view.kind === 'confirm-delete') {
      if (_input === 'y' || _input === 'Y') {
        const skill = view.skill
        setView({ kind: 'message', text: `Deleting '${skill.name}'…` })
        gw.request('skills.manage', {
          action: 'delete',
          name: skill.name,
          session_id: sessionId,
        })
          .then(() => {
            // Refresh the list.
            setSkills(prev => prev.filter(s => s.name !== skill.name))
            setCursor(0)
            setView({ kind: 'list' })
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            setView({ kind: 'message', text: `Delete failed: ${msg}`, isError: true })
          })
        return
      }
      if (key.escape || _input === 'n' || _input === 'N') {
        setView({ kind: 'list' })
        return
      }
    }

    // ── In message view ────────────────────────────────────────────
    if (view.kind === 'message') {
      if (key.escape || key.return || _input === 'q') {
        setView({ kind: 'list' })
        return
      }
    }
  })

  // ── Render helpers ─────────────────────────────────────────────────

  function renderHeader() {
    return (
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          {'⚡ Skills Manager'}
        </Text>
      </Box>
    )
  }

  function renderDivider() {
    return (
      <Box>
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
    )
  }

  // ── Loading / error state ──────────────────────────────────────────
  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        <Text color={theme.muted}>Loading skills…</Text>
      </Box>
    )
  }

  if (loadError) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        <Text color={theme.error}>Error: {loadError}</Text>
        <Text color={theme.muted} dimColor>
          Press Esc to dismiss
        </Text>
      </Box>
    )
  }

  // ── List view ──────────────────────────────────────────────────────
  if (view.kind === 'list') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        {renderDivider()}
        {skills.length === 0 ? (
          <Box marginTop={1}>
            <Text color={theme.muted}>
              No skills installed.{'\n'}
              Skills are stored as SKILL.md files under:{'\n'}
              {'  '}~/.drsai/workspace/runs/&lt;user&gt;/configs/skills/&lt;name&gt;/SKILL.md
            </Text>
          </Box>
        ) : (
          skills.map((skill, i) => {
            const isSelected = i === cursor
            return (
              <Box key={skill.name} marginTop={i === 0 ? 1 : 0}>
                <Text
                  color={isSelected ? theme.primary : theme.text}
                  bold={isSelected}
                >
                  {isSelected ? '▶ ' : '  '}
                  {skill.name}
                </Text>
                <Text color={theme.muted}>{' — '}</Text>
                <Text color={isSelected ? theme.accent : theme.textDim}>
                  {skill.description.length > 60
                    ? skill.description.slice(0, 57) + '…'
                    : skill.description}
                </Text>
              </Box>
            )
          })
        )}
        {renderDivider()}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓ navigate  Enter show  d delete  r reload  q dismiss
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Detail view ────────────────────────────────────────────────────
  if (view.kind === 'detail') {
    const { skill, content, path } = view
    // Truncate very large content for display.
    const MAX_LINES = 40
    const lines = content.split('\n')
    const displayed = lines.length > MAX_LINES
      ? lines.slice(0, MAX_LINES).join('\n') + `\n… (${lines.length - MAX_LINES} more lines)`
      : content
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        <Box marginBottom={1}>
          <Text bold color={theme.accent}>{skill.name}</Text>
          <Text color={theme.muted}> — {path}</Text>
        </Box>
        {renderDivider()}
        <Box marginTop={1}>
          <Text color={theme.text}>{displayed}</Text>
        </Box>
        {renderDivider()}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Press Enter or Esc to go back
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Confirm-delete view ────────────────────────────────────────────
  if (view.kind === 'confirm-delete') {
    const { skill } = view
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        {renderDivider()}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warn}>
            Delete skill <Text bold color={theme.error}>{skill.name}</Text>?
          </Text>
          <Text color={theme.muted} dimColor>
            This will permanently remove the skill directory.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text}>
            Press <Text bold color={theme.good}>y</Text> to confirm,{' '}
            <Text bold color={theme.muted}>n / Esc</Text> to cancel.
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Message view (loading / success / error) ───────────────────────
  if (view.kind === 'message') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {renderHeader()}
        {renderDivider()}
        <Box marginTop={1}>
          <Text color={view.isError ? theme.error : theme.good}>{view.text}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Press Enter or Esc to go back
          </Text>
        </Box>
      </Box>
    )
  }

  return null
}
