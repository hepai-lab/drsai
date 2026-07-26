/**
 * GfsPanel — interactive overlay for managing GFS (高能所文件系统) configuration.
 *
 * Triggered by `/gfs`. Two views:
 *
 * 1. Status view — navigable list of config items.
 *    ↑↓ move cursor · Enter or type to edit selected item
 *    s toggle on/off · t test · c clear · q quit
 *
 * 2. Edit view — inline text input for the selected field.
 *    ↑↓/Tab switch field · type to edit · Backspace delete
 *    Enter on last field saves · s toggle on/off · Esc cancel
 *
 * Config persisted to ~/.drsai/configs/cli_config.json["gfs"].
 */

import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import type { GfsConfig, GfsTestResult, GfsSaveResult } from '../gatewayTypes.js'
import { theme } from '../theme.js'
import { isTerminalFocusEvent } from '../app/focusEvents.js'

interface Props {
  gw: GatewayClient
  onDismiss: () => void
}

interface FormField {
  key: string
  label: string
  placeholder: string
}

const FORM_FIELDS: FormField[] = [
  { key: 'access_key',  label: 'Access Key',  placeholder: 'e94UWOls...' },
  { key: 'secret_key',  label: 'Secret Key',  placeholder: '2psxS5dpw...' },
  { key: 'bucket',      label: 'Bucket',      placeholder: '20235-xiongdb' },
  { key: 'email',       label: 'Email',       placeholder: 'xiongdb@ihep.ac.cn (optional)' },
  { key: 's3_endpoint', label: 'S3 Endpoint', placeholder: '(default: https://fgws3-gfs.ihep.ac.cn)' },
]

// Rows in the status view: 0 = enabled toggle, 1..5 = fields
const STATUS_ROWS = ['enabled', ...FORM_FIELDS.map(f => f.key)]

export function GfsPanel({ gw, onDismiss }: Props) {
  const [config, setConfig] = useState<GfsConfig | null>(null)
  const [message, setMessage] = useState('')
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [testing, setTesting] = useState(false)

  const [cursor, setCursor] = useState(0)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formField, setFormField] = useState(0)
  const [formEnabled, setFormEnabled] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await gw.request<GfsConfig>('gfs.status', {})
      setConfig(res)
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }, [gw])

  useEffect(() => { refresh() }, [refresh])

  // ── Actions ──────────────────────────────────────────────────────────

  function enterEdit(fieldIdx: number) {
    if (!config) return
    setFormValues({
      access_key: '',
      secret_key: '',
      bucket: config.bucket || '',
      email: config.email || '',
      s3_endpoint: config.s3_endpoint && config.s3_endpoint !== 'https://fgws3-gfs.ihep.ac.cn'
        ? config.s3_endpoint : '',
    })
    setFormEnabled(config.enabled)
    setFormField(fieldIdx)
    setMessage('')
    setView('edit')
  }

  async function saveConfig() {
    if (formEnabled) {
      if (!formValues.access_key?.trim() && !config?.access_key_masked) {
        setMessage('⚠ Access Key is required when enabling GFS')
        return
      }
      if (!formValues.secret_key?.trim() && !config?.secret_key_masked) {
        setMessage('⚠ Secret Key is required when enabling GFS')
        return
      }
      if (!formValues.bucket?.trim() && !config?.bucket) {
        setMessage('⚠ Bucket is required when enabling GFS')
        return
      }
    }
    try {
      const params: Record<string, unknown> = { enabled: formEnabled, mode: 'personal' }
      for (const field of FORM_FIELDS) {
        const val = formValues[field.key]
        if (val !== undefined && val !== '') params[field.key] = val
      }
      const res = await gw.request<GfsSaveResult>('gfs.save', params)
      setMessage(res.message || '✓ Saved')
      setView('list')
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  async function testConnection() {
    setTesting(true)
    setMessage('Testing GFS connection...')
    try {
      const res = await gw.request<GfsTestResult>('gfs.test', {})
      setMessage(res.ok ? (res.message || `✓ GFS OK — bucket: ${res.bucket}`) : `✗ ${res.error || 'Test failed'}`)
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  async function clearConfig() {
    try {
      await gw.request('gfs.clear', {})
      setMessage('✓ GFS config cleared. Restart session for changes to take effect.')
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  async function toggleEnabled() {
    if (!config) return
    try {
      const res = await gw.request<GfsSaveResult>('gfs.save', { enabled: !config.enabled, mode: 'personal' })
      setMessage(res.message || `✓ GFS ${!config.enabled ? 'enabled' : 'disabled'}`)
      refresh()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  // ── Reserved single-char keys in list view ───────────────────────────
  const LIST_RESERVED = new Set(['e', 't', 's', 'c', 'q', 'r'])

  // ── Input handling ───────────────────────────────────────────────────

  useInput((input, key) => {
    if (isTerminalFocusEvent(input)) return

    // ═══════════════════════════════════════════════════════════════════
    //  Edit view
    // ═══════════════════════════════════════════════════════════════════
    if (view === 'edit') {
      if (key.escape) { setView('list'); return }
      if (key.upArrow) { setFormField(f => Math.max(0, f - 1)); return }
      if (key.downArrow) {
        if (formField < FORM_FIELDS.length - 1) setFormField(f => f + 1)
        else saveConfig()
        return
      }
      if (key.tab) { setFormField(f => (f + 1) % FORM_FIELDS.length); return }
      if (key.return) {
        if (formField < FORM_FIELDS.length - 1) setFormField(f => f + 1)
        else saveConfig()
        return
      }
      if (input === 's') { setFormEnabled(v => !v); return }
      if (key.backspace || key.delete) {
        const field = FORM_FIELDS[formField]
        setFormValues(v => ({ ...v, [field.key]: (v[field.key] || '').slice(0, -1) }))
        return
      }
      // Any other printable character → append to current field
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        const field = FORM_FIELDS[formField]
        setFormValues(v => ({ ...v, [field.key]: (v[field.key] || '') + input }))
      }
      return
    }

    // ═══════════════════════════════════════════════════════════════════
    //  List (status) view
    // ═══════════════════════════════════════════════════════════════════
    if (key.escape || input === 'q') { onDismiss(); return }

    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(STATUS_ROWS.length - 1, c + 1)); return }

    if (key.return) {
      if (cursor === 0) { toggleEnabled(); return }
      enterEdit(cursor - 1) // offset: cursor 1..5 → field 0..4
      return
    }

    // Right arrow → also enter edit for selected field
    if (key.rightArrow) {
      if (cursor > 0) enterEdit(cursor - 1)
      return
    }

    // Single-key shortcuts (only in list view, only for reserved keys)
    if (input === 'e') { enterEdit(0); return }
    if (input === 't' && !testing) { testConnection(); return }
    if (input === 's') { toggleEnabled(); return }
    if (input === 'c') { clearConfig(); return }
    if (input === 'r') { refresh(); return }
  })

  // ═════════════════════════════════════════════════════════════════════
  //  Render: Edit view
  // ═════════════════════════════════════════════════════════════════════
  if (view === 'edit') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>📁 Edit GFS Personal Config</Text>
        </Box>

        <Text color={formEnabled ? theme.good : theme.muted}>
          {formEnabled ? '●' : '○'} Enabled: {formEnabled ? 'true' : 'false'}
          <Text dimColor> (press 's' to toggle)</Text>
        </Text>

        {FORM_FIELDS.map((field, i) => {
          const isCursor = i === formField
          const val = formValues[field.key] || ''
          const hasExisting =
            (field.key === 'access_key' && !!config?.access_key_masked) ||
            (field.key === 'secret_key' && !!config?.secret_key_masked)
          return (
            <Text key={field.key} color={isCursor ? theme.accent : theme.text}>
              {isCursor ? '▶' : ' '} {field.label}:{' '}
              {val || (hasExisting ? '(unchanged — ***)' : field.placeholder)}
              {isCursor && val ? '█' : ''}
            </Text>
          )
        })}

        {message && <Text color={theme.warn}>{message}</Text>}

        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑↓/Tab switch field · type to edit · s toggle · Enter save (last) · Esc cancel
          </Text>
        </Box>
      </Box>
    )
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render: List (status) view
  // ═════════════════════════════════════════════════════════════════════

  if (!config) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>📁 GFS Configuration</Text>
        </Box>
        <Text color={theme.muted}>Loading...</Text>
        {message && <Text color={theme.warn}>{message}</Text>}
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>q quit</Text>
        </Box>
      </Box>
    )
  }

  const statusColor = config.enabled ? theme.good : theme.muted
  const statusIcon = config.enabled ? '●' : '○'
  const modeLabel = config.detected_mode || config.mode || 'auto'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>📁 GFS Configuration — 高能所文件系统</Text>
      </Box>

      <Text color={statusColor}>
        {statusIcon} GFS Tools: {config.enabled ? 'ENABLED' : 'disabled'}
        {config.enabled && <Text color={theme.text}> (mode: </Text>}
        {config.enabled && <Text color={theme.accent}>{modeLabel}</Text>}
        {config.enabled && <Text color={theme.text}>)</Text>}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text} bold>Credentials:</Text>

        {/* Enabled toggle row (cursor 0) */}
        <Text color={cursor === 0 ? theme.accent : theme.text}>
          {cursor === 0 ? '▶' : ' '} Enabled:{' '}
          <Text color={config.enabled ? theme.good : theme.muted}>
            {config.enabled ? 'true' : 'false'}
          </Text>
          {cursor === 0 && <Text dimColor> (Enter to toggle)</Text>}
        </Text>

        {/* Credential rows (cursor 1..5) */}
        {FORM_FIELDS.map((field, i) => {
          const rowIdx = i + 1
          const isCursor = cursor === rowIdx
          let displayVal: string
          if (field.key === 'access_key') displayVal = config.access_key_masked || '(not set)'
          else if (field.key === 'secret_key') displayVal = config.secret_key_masked || '(not set)'
          else if (field.key === 'bucket') displayVal = config.bucket || '(not set)'
          else if (field.key === 'email') displayVal = config.email || '(not set)'
          else if (field.key === 's3_endpoint') displayVal = config.s3_endpoint || '(default)'
          else displayVal = ''

          const valColor =
            (field.key === 'access_key' || field.key === 'secret_key')
              ? (config.access_key_masked || config.secret_key_masked ? theme.good : theme.warn)
              : field.key === 'bucket'
                ? (config.bucket ? theme.text : theme.warn)
                : theme.muted

          return (
            <Text key={field.key} color={isCursor ? theme.accent : theme.text}>
              {isCursor ? '▶' : ' '} {field.label}:{' '}
              <Text color={valColor}>{displayVal}</Text>
              {isCursor && <Text dimColor> (Enter to edit)</Text>}
            </Text>
          )
        })}
      </Box>

      {testing && <Text color={theme.accent}>⟳ Testing connection...</Text>}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          config: {config.config_exists ? config.config_path : '(not found)'}
        </Text>
      </Box>

      {message && (
        <Box marginTop={1}>
          <Text color={theme.warn}>{message}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑↓ navigate · Enter/→ edit · s toggle · t test · c clear · q quit
        </Text>
      </Box>
    </Box>
  )
}
