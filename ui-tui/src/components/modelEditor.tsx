/**
 * ModelEditor — overlay form for creating / editing a model entry.
 *
 * Triggered by `/model add` or `/model edit [alias]`. Calls `model.save` RPC
 * on submit; the backend persists to llm_mode_config.yaml and (for new
 * aliases) auto-switches the active session.
 *
 * Layout:
 *
 *   ┌─ Add Model ──────────────────────────────────────────┐
 *   │ alias        [______________________]                │
 *   │ model_id     [______________________]                │
 *   │ token_limit  [128000        ]                        │
 *   │ max_tokens   [0             ]  (0 = auto)            │
 *   │ client_type  < auto >                                │
 *   │ reasoning    [ ] supported                           │
 *   │   param_type < none >          (disabled)            │
 *   │   levels     [low,medium,high]  (disabled)           │
 *   │                                                      │
 *   │ Tab/Shift+Tab fields · ←/→ toggle · Enter save · Esc │
 *   └──────────────────────────────────────────────────────┘
 */

import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { theme } from '../theme.js'

type ClientType = 'auto' | 'openai' | 'anthropic'
type ParamType =
  | 'none'
  | 'adaptive'
  | 'enabled'
  | 'is_r1_model'
  | 'reasoning_effort'
  | 'minimax_format'
  | 'zhipu_format'

const CLIENT_TYPES: ClientType[] = ['auto', 'openai', 'anthropic']
const PARAM_TYPES: ParamType[] = [
  'none',
  'adaptive',
  'enabled',
  'is_r1_model',
  'reasoning_effort',
  'minimax_format',
  'zhipu_format',
]

export interface ModelEditorValues {
  alias: string
  model: string
  token_limit: number
  max_tokens: number
  client_type: ClientType
  reasoning: {
    supported: boolean
    effort_levels: string[]
    param_type: ParamType
  }
  vision: boolean
  /** Original alias if this is an edit; used by the backend to rename. */
  original_alias?: string
  is_new: boolean
}

export interface ModelEditorProps {
  initial?: Partial<ModelEditorValues>
  /** True when adding a new entry; false when editing an existing one. */
  isNew: boolean
  /** Original alias when editing (for rename detection). Undefined for add. */
  originalAlias?: string
  onSubmit: (values: ModelEditorValues) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
}

interface FieldDef {
  key:
    | 'alias'
    | 'model'
    | 'token_limit'
    | 'max_tokens'
    | 'client_type'
    | 'reasoning_supported'
    | 'param_type'
    | 'effort_levels'
    | 'vision'
  label: string
  kind: 'text' | 'number' | 'enum' | 'toggle'
  /** When non-null and false, the field is rendered dim and skipped on Tab. */
  enabledFn?: (state: State) => boolean
}

interface State {
  alias: string
  model: string
  token_limit: string  // kept as string so user can type freely
  max_tokens: string
  client_type: ClientType
  reasoning_supported: boolean
  param_type: ParamType
  effort_levels: string
  vision: boolean
}

const FIELDS: FieldDef[] = [
  { key: 'alias', label: 'alias *', kind: 'text' },
  { key: 'model', label: 'model_id *', kind: 'text' },
  { key: 'token_limit', label: 'token_limit', kind: 'number' },
  { key: 'max_tokens', label: 'max_tokens', kind: 'number' },
  { key: 'client_type', label: 'client_type', kind: 'enum' },
  { key: 'vision', label: 'vision (image input)', kind: 'toggle' },
  { key: 'reasoning_supported', label: 'reasoning supported', kind: 'toggle' },
  {
    key: 'param_type',
    label: '  param_type',
    kind: 'enum',
    enabledFn: s => s.reasoning_supported,
  },
  {
    key: 'effort_levels',
    label: '  effort_levels',
    kind: 'text',
    enabledFn: s => s.reasoning_supported,
  },
]

function buildInitial(props: ModelEditorProps): State {
  const init = props.initial || {}
  return {
    alias: init.alias ?? '',
    model: init.model ?? '',
    token_limit: String(init.token_limit ?? 128000),
    max_tokens: String(init.max_tokens ?? 0),
    client_type: (init.client_type as ClientType) ?? 'auto',
    reasoning_supported: init.reasoning?.supported ?? false,
    param_type: (init.reasoning?.param_type as ParamType) ?? 'none',
    effort_levels: (init.reasoning?.effort_levels || []).join(','),
    vision: init.vision ?? true,
  }
}

export function ModelEditor(props: ModelEditorProps) {
  const [state, setState] = useState<State>(() => buildInitial(props))
  const [focusIdx, setFocusIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function nextFocus(dir: 1 | -1) {
    const n = FIELDS.length
    let i = focusIdx
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n
      const f = FIELDS[i]
      if (!f.enabledFn || f.enabledFn(state)) {
        setFocusIdx(i)
        return
      }
    }
  }

  function adjustEnum(key: 'client_type' | 'param_type', dir: 1 | -1) {
    if (key === 'client_type') {
      const idx = CLIENT_TYPES.indexOf(state.client_type)
      const next = (idx + dir + CLIENT_TYPES.length) % CLIENT_TYPES.length
      setState({ ...state, client_type: CLIENT_TYPES[next] })
    } else {
      const idx = PARAM_TYPES.indexOf(state.param_type)
      const next = (idx + dir + PARAM_TYPES.length) % PARAM_TYPES.length
      setState({ ...state, param_type: PARAM_TYPES[next] })
    }
  }

  function toggleReasoning() {
    const next = !state.reasoning_supported
    setState({
      ...state,
      reasoning_supported: next,
      // When turning OFF, snap the dependent fields back to safe defaults
      // so a stale value isn't accidentally persisted on the next ON.
      param_type: next ? state.param_type : 'none',
      effort_levels: next ? state.effort_levels : '',
    })
  }

  async function handleSubmit() {
    if (busy) return
    setError(null)

    const aliasTrim = state.alias.trim()
    const modelTrim = state.model.trim()
    if (!aliasTrim) { setError('alias is required'); setFocusIdx(0); return }
    if (!modelTrim) { setError('model_id is required'); setFocusIdx(1); return }
    if (/\s/.test(aliasTrim)) { setError('alias must not contain whitespace'); setFocusIdx(0); return }
    if (aliasTrim.startsWith('_')) { setError('alias must not start with underscore'); setFocusIdx(0); return }

    const tl = parseInt(state.token_limit || '0', 10)
    const mt = parseInt(state.max_tokens || '0', 10)
    if (!Number.isFinite(tl) || tl < 0) { setError('token_limit must be a non-negative integer'); setFocusIdx(2); return }
    if (!Number.isFinite(mt) || mt < 0) { setError('max_tokens must be a non-negative integer'); setFocusIdx(3); return }

    const values: ModelEditorValues = {
      alias: aliasTrim,
      model: modelTrim,
      token_limit: tl,
      max_tokens: mt,
      client_type: state.client_type,
      reasoning: {
        supported: state.reasoning_supported,
        param_type: state.reasoning_supported ? state.param_type : 'none',
        effort_levels: state.reasoning_supported
          ? state.effort_levels.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      },
      vision: state.vision,
      original_alias: props.originalAlias,
      is_new: props.isNew,
    }

    setBusy(true)
    try {
      const result = await props.onSubmit(values)
      if (!result.ok && result.error) {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (busy) return
    if (key.escape) {
      props.onCancel()
      return
    }

    const field = FIELDS[focusIdx]

    // Tab navigation
    if (key.tab) {
      nextFocus(key.shift ? -1 : 1)
      return
    }

    // Enter = submit (anywhere in the form)
    if (key.return) {
      void handleSubmit()
      return
    }

    if (key.upArrow) { nextFocus(-1); return }
    if (key.downArrow) { nextFocus(1); return }

    // Field-specific handling
    if (field.kind === 'toggle') {
      if (input === ' ' || key.leftArrow || key.rightArrow) {
        if (field.key === 'vision') {
          setState({ ...state, vision: !state.vision })
        } else {
          toggleReasoning()
        }
      }
      return
    }
    if (field.kind === 'enum') {
      if (key.leftArrow) { adjustEnum(field.key as any, -1); return }
      if (key.rightArrow) { adjustEnum(field.key as any, 1); return }
      // Allow space to advance forward as a convenience
      if (input === ' ') { adjustEnum(field.key as any, 1); return }
      return
    }

    // Text/number fields: edit current state[field.key]
    if (key.backspace || key.delete) {
      const cur = (state as any)[field.key] as string
      setState({ ...state, [field.key]: cur.slice(0, -1) } as State)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      // Number fields: digits only
      if (field.kind === 'number' && !/^\d+$/.test(input)) return
      const cur = (state as any)[field.key] as string
      setState({ ...state, [field.key]: cur + input } as State)
    }
  })

  // ── Render ──────────────────────────────────────────────────────────
  const title = props.isNew ? 'Add Model' : `Edit Model: ${props.originalAlias ?? state.alias}`

  return (
    <Box borderStyle="round" borderColor={theme.primary} paddingX={1} flexDirection="column">
      <Text color={theme.primary} bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {FIELDS.map((f, i) => {
          const focused = i === focusIdx
          const enabled = !f.enabledFn || f.enabledFn(state)
          const labelColor = focused ? theme.accent : enabled ? theme.text : theme.muted

          let valueNode
          if (f.kind === 'toggle') {
            const toggleState = f.key === 'vision' ? state.vision : state.reasoning_supported
            const v = toggleState ? '[x]' : '[ ]'
            const suffix = f.key === 'vision' ? (toggleState ? ' image input' : ' text only') : ' supported'
            valueNode = <Text color={enabled ? theme.text : theme.muted} inverse={focused}>{v}{suffix}</Text>
          } else if (f.kind === 'enum') {
            const v = (state as any)[f.key]
            valueNode = (
              <Text color={enabled ? theme.text : theme.muted} inverse={focused}>
                {`< ${v} >`}
              </Text>
            )
          } else {
            const v = String((state as any)[f.key] ?? '')
            const display = v || (f.kind === 'number' ? '0' : ' ')
            valueNode = (
              <Text color={enabled ? theme.text : theme.muted} inverse={focused}>
                {display + (focused ? '▏' : '')}
              </Text>
            )
          }

          return (
            <Box key={f.key}>
              <Box width={20}>
                <Text color={labelColor}>{(focused ? '▶ ' : '  ') + f.label}</Text>
              </Box>
              {valueNode}
            </Box>
          )
        })}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color={theme.error}>✗ {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          {busy ? 'saving…' : 'Tab/↑↓ fields · ←/→ toggle · Enter save · Esc cancel'}
        </Text>
      </Box>
    </Box>
  )
}
