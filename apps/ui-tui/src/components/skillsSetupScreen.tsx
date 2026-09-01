/**
 * SkillsSetupScreen — first-run built-in skills selection.
 *
 * Shows the list of pre-installed skills from skills/skills/ and lets
 * the user toggle which ones to install to their own skills directory.
 *
 * On submit, calls setup.skills.install with the selected skill names.
 * On complete, calls onComplete() to continue the boot flow.
 */

import { Box, Text, useInput } from 'ink'
import { useEffect, useState, useCallback } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

interface SkillsSetupScreenProps {
  gw: GatewayClient
  /** Called after successful installation. */
  onComplete: () => void
  /** Called when user skips (Ctrl+S). */
  onSkip: () => void
}

interface SkillInfo {
  name: string
  description: string
  dir: string
  installed: boolean
  enabled?: boolean
}

interface SkillsListResponse {
  skills: SkillInfo[]
  skills_selected: boolean
  enabled_skills: string[]
}

interface InstallResult {
  installed: string[]
  failed: { name: string; error: string }[]
  skills_selected: boolean
}

type Phase = 'loading' | 'listing' | 'installing' | 'done' | 'error'

export function SkillsSetupScreen({ gw, onComplete, onSkip }: SkillsSetupScreenProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [errorMsg, setErrorMsg] = useState('')
  const [installResult, setInstallResult] = useState<InstallResult | null>(null)

  // Load skills on mount
  useEffect(() => {
    void (async () => {
      try {
        const resp = await gw.request<SkillsListResponse>('setup.skills.list', {})
        setSkills(resp.skills)
        // Pre-select: skills that are already installed or enabled
        const preSelected = new Set<string>(
          resp.skills
            .filter(s => s.installed || s.enabled)
            .map(s => s.name),
        )
        // If user already completed selection, use their enabled_skills
        if (resp.enabled_skills && resp.enabled_skills.length > 0) {
          setSelected(new Set(resp.enabled_skills))
        } else {
          setSelected(preSelected)
        }
        setPhase('listing')
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    })()
  }, [gw])

  const toggleSkill = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }, [])

  const installSkills = useCallback(async () => {
    setPhase('installing')
    try {
      const result = await gw.request<InstallResult>('setup.skills.install', {
        skills: Array.from(selected),
      })
      setInstallResult(result)
      setPhase('done')
      setTimeout(onComplete, 1000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [gw, selected, onComplete])

  // Handle input
  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return
    if (phase !== 'listing') return

    if (key.escape) {
      onSkip()
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

    if (key.return) {
      // Enter on a skill toggles it
      if (skills[cursor]) {
        toggleSkill(skills[cursor].name)
      }
      return
    }

    // 'a' = select all, 'n' = deselect all, 's' = skip/install
    if (input === 'a' || input === 'A') {
      setSelected(new Set(skills.map(s => s.name)))
      return
    }
    if (input === 'n' || input === 'N') {
      setSelected(new Set())
      return
    }
    if (input === 'i' || input === 'I') {
      void installSkills()
      return
    }
  })

  // ── Render ────────────────────────────────────────────────────────

  const banner = (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>⚡ OpenDrSai </Text>
        <Text color={theme.accent}>· Skills Setup</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          Choose which built-in skills to install. You can manage them later with /skills.
        </Text>
      </Box>
    </Box>
  )

  if (phase === 'loading') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.warn}>○ Loading available skills…</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'installing') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.warn}>○ Installing {selected.size} skill(s)…</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'done') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.good}>✓ Skills installed successfully!</Text>
        </Box>
        {installResult && installResult.failed.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.warn}>Some skills failed to install:</Text>
            {installResult.failed.map(f => (
              <Text key={f.name} color={theme.muted}>  {f.name}: {f.error}</Text>
            ))}
          </Box>
        )}
        {installResult && (
          <Box marginTop={1}>
            <Text color={theme.text}>
              Installed: {installResult.installed.join(', ') || '(none)'}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.error}>✗ Error: {errorMsg}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>Esc to skip</Text>
        </Box>
      </Box>
    )
  }

  // phase === 'listing'
  return (
    <Box flexDirection="column" paddingX={1}>
      {banner}
      <Box marginTop={1} flexDirection="column">
        {skills.map((skill, i) => {
          const isCursor = i === cursor
          const isSelected = selected.has(skill.name)
          const checkbox = isSelected ? '◉' : '◯'
          const color = isCursor ? theme.accent : theme.text
          return (
            <Box key={skill.name} flexDirection="column">
              <Box>
                <Text color={color}>
                  {isCursor ? '▶ ' : '  '}
                  {checkbox} {skill.name.padEnd(30)}
                  {skill.installed && (
                    <Text color={theme.muted} dimColor> (installed)</Text>
                  )}
                </Text>
              </Box>
              {isCursor && (
                <Box paddingLeft={6}>
                  <Text color={theme.muted} dimColor>{skill.description}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑/↓ navigate · Enter toggle · A all · N none · I install · Esc skip
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.accent} bold>
          {selected.size} skill(s) selected
        </Text>
      </Box>
    </Box>
  )
}
