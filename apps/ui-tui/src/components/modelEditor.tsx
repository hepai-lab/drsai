/** Compact ~/.drsai/config.toml model and Provider editor. */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import { theme } from '../theme.js'

export type WireApi = 'openai' | 'anthropic'
export type KeySource = 'secure' | 'env' | 'none'

export interface ModelProviderPreset {
  id: string
  label: string
  base_url: string
  wire_api: WireApi
  requires_api_key: boolean
  api_key_env?: string
}

export interface ModelEditorValues {
  provider: string
  model: string
  base_url?: string
  api_key?: string
  api_key_env?: string
  wire_api: WireApi
  requires_api_key: boolean
}

export interface ModelEditorProps {
  initial?: Partial<ModelEditorValues>
  isNew: boolean
  originalAlias?: string
  onSubmit: (values: ModelEditorValues) => Promise<{ ok: boolean; error?: string }>
  onTest?: (values: ModelEditorValues) => Promise<{ ok: boolean; error?: string }>
  presets?: ModelProviderPreset[]
  onCancel: () => void
}

type FieldKey = 'preset' | 'provider' | 'model' | 'base_url' | 'key_source' | 'api_key' | 'api_key_env' | 'wire_api'

interface EditorState {
  provider: string
  model: string
  base_url: string
  api_key: string
  api_key_env: string
  wire_api: WireApi
  requires_api_key: boolean
  preset: string
  key_source: KeySource
}

type EditorField = { key: FieldKey; label: string; kind: 'text' | 'secret' | 'enum' }

function editorFields(state: EditorState, hasPresets: boolean): EditorField[] {
  return [
    ...(hasPresets ? [{ key: 'preset', label: 'service preset', kind: 'enum' } as EditorField] : []),
    { key: 'provider', label: 'provider *', kind: 'text' },
    { key: 'model', label: 'model ID *', kind: 'text' },
    { key: 'base_url', label: 'base URL', kind: 'text' },
    { key: 'key_source', label: 'key source', kind: 'enum' },
    ...(state.key_source === 'secure' ? [{ key: 'api_key', label: 'API key', kind: 'secret' } as EditorField] : []),
    ...(state.key_source === 'env' ? [{ key: 'api_key_env', label: 'environment variable', kind: 'text' } as EditorField] : []),
    { key: 'wire_api', label: 'protocol (advanced)', kind: 'enum' },
  ]
}

function initialState(initial?: Partial<ModelEditorValues>): EditorState {
  return {
    provider: initial?.provider ?? '',
    model: initial?.model ?? '',
    base_url: initial?.base_url ?? '',
    api_key: '',
    api_key_env: initial?.api_key_env ?? '',
    wire_api: initial?.wire_api ?? 'openai',
    requires_api_key: initial?.requires_api_key ?? true,
    preset: '',
    key_source: initial?.requires_api_key === false ? 'none' : initial?.api_key_env ? 'env' : 'secure',
  }
}

export function ModelEditor(props: ModelEditorProps) {
  const [state, setState] = useState<EditorState>(() => initialState(props.initial))
  const [focus, setFocus] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fields = editorFields(state, Boolean(props.presets?.length))

  function move(delta: number) {
    setFocus((focus + delta + fields.length) % fields.length)
  }

  async function submit() {
    if (busy) return
    const provider = state.provider.trim()
    const model = state.model.trim()
    const baseUrl = state.base_url.trim()
    const apiKey = state.api_key.trim()
    const apiKeyEnv = state.api_key_env.trim()
    if (!provider) { setError('provider is required'); setFocus(0); return }
    if (!/^[A-Za-z0-9_-]+$/.test(provider)) {
      setError("provider may contain only letters, numbers, '_' and '-'")
      setFocus(0)
      return
    }
    if (!model) { setError('model is required'); setFocus(1); return }
    if (provider !== 'hepai' && !baseUrl) { setError('base_url is required'); setFocus(2); return }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      setError('base_url must be an absolute http(s) URL')
      setFocus(2)
      return
    }
    if (apiKey && apiKeyEnv) {
      setError('api_key and api_key_env are mutually exclusive')
      setFocus(3)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await props.onSubmit({
        provider,
        model,
        base_url: baseUrl || undefined,
        api_key: apiKey || undefined,
        api_key_env: apiKeyEnv || undefined,
        wire_api: state.wire_api,
        requires_api_key: state.key_source !== 'none',
      })
      if (!result.ok) setError(result.error || 'save failed')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    if (busy || !props.onTest) return
    const provider = state.provider.trim()
    const model = state.model.trim()
    if (!provider || !model) { setError('provider and model are required'); return }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await props.onTest({
        provider,
        model,
        base_url: state.base_url.trim() || undefined,
        api_key: state.api_key.trim() || undefined,
        api_key_env: state.api_key_env.trim() || undefined,
        wire_api: state.wire_api,
        requires_api_key: state.key_source !== 'none',
      })
      if (result.ok) setNotice('Connection successful')
      else setError(result.error || 'connection test failed')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (isTerminalFocusEvent(input) || busy) return
    if (key.ctrl && input === 't') { void testConnection(); return }
    if (key.escape) { props.onCancel(); return }
    if (key.tab) { move(key.shift ? -1 : 1); return }
    if (key.upArrow) { move(-1); return }
    if (key.downArrow) { move(1); return }
    if (key.return) { void submit(); return }

    const field = fields[focus]
    if (!field) return
    if (field.key === 'wire_api' && (key.leftArrow || key.rightArrow || input === ' ')) {
      setState({ ...state, wire_api: state.wire_api === 'openai' ? 'anthropic' : 'openai' })
      return
    }
    if (field.key === 'key_source' && (key.leftArrow || key.rightArrow || input === ' ')) {
      const choices: KeySource[] = ['secure', 'env', 'none']
      const delta = key.leftArrow ? -1 : 1
      const next = choices[(choices.indexOf(state.key_source) + delta + choices.length) % choices.length]
      setState({ ...state, key_source: next, requires_api_key: next !== 'none', api_key: '', api_key_env: '' })
      setFocus(Math.min(focus, editorFields({ ...state, key_source: next }, Boolean(props.presets?.length)).length - 1))
      return
    }
    if (field.key === 'preset' && (key.leftArrow || key.rightArrow || input === ' ')) {
      const presets = props.presets || []
      const current = Math.max(0, presets.findIndex(item => item.id === state.preset))
      const delta = key.leftArrow ? -1 : 1
      const preset = presets[(current + delta + presets.length) % presets.length]
      if (preset) setState({ ...state, preset: preset.id, provider: preset.id.startsWith('custom-') ? 'custom' : preset.id, base_url: preset.base_url, wire_api: preset.wire_api, requires_api_key: preset.requires_api_key, key_source: preset.requires_api_key ? 'secure' : 'none', api_key: '', api_key_env: '' })
      return
    }
    if (field.kind === 'enum') return
    const fieldKey = field.key as 'provider' | 'model' | 'base_url' | 'api_key' | 'api_key_env'
    const current = state[fieldKey]
    if (key.backspace || key.delete) {
      setState({ ...state, [fieldKey]: current.slice(0, -1) })
      return
    }
    if (input && !key.ctrl && !key.meta) setState({ ...state, [fieldKey]: current + input })
  })

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Text color={theme.primary} bold>{props.isNew ? 'Add model service' : 'Edit model service'}</Text>
      <Text color={theme.muted}>Writes the compact ~/.drsai/config.toml configuration.</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((field, index) => {
          const selected = index === focus
          let display: string
          if (field.kind === 'secret') {
            display = state.api_key ? '*'.repeat(Math.min(16, state.api_key.length)) : '(unchanged/empty)'
          } else if (field.key === 'wire_api') {
            display = `< ${state.wire_api} >`
          } else if (field.key === 'key_source') {
            display = `< ${state.key_source} >`
          } else if (field.key === 'preset') {
            display = `< ${props.presets?.find(item => item.id === state.preset)?.label || 'choose'} >`
          } else {
            display = String(state[field.key] || ' ')
          }
          return (
            <Box key={field.key}>
              <Box width={22}><Text color={selected ? theme.accent : theme.text}>{selected ? '▶ ' : '  '}{field.label}</Text></Box>
              <Text inverse={selected}>{display}{selected && field.kind === 'text' ? '▌' : ''}</Text>
            </Box>
          )
        })}
      </Box>
      {error && <Text color={theme.error}>✗ {error}</Text>}
      {notice && <Text color={theme.good}>{notice}</Text>}
      <Text color={theme.muted}>{busy ? 'working…' : 'Tab/↑↓ fields · ←/→ toggle · Ctrl+T test · Enter save · Esc cancel'}</Text>
    </Box>
  )
}
