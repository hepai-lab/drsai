/**
 * SetupScreen — first-run interactive setup that runs inside the Ink UI.
 *
 * Triggered when ``gateway.ready.setup.setup_required`` is true (no config
 * file, or no API key reachable via config / env). Walks the user through:
 *   1. choose provider (HepAI / Anthropic / OpenAI / skip)
 *   2. enter API key (input masked-on-display, value typed normally)
 *   3. optional base URL
 *
 * On submit, calls the ``setup.save`` RPC and invokes ``onComplete()`` so the
 * App can re-bootstrap as if first-launch had succeeded.
 *
 * HepAI gets a clickable hint linking to https://aiapi.ihep.ac.cn/ where
 * users in the IHEP / CAS network can request a key.
 */

import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

import { TextInput } from './textInput.js'

type Provider = 'oidc' | 'hepai' | 'anthropic' | 'openai' | 'skip'

interface ProviderOption {
  key: Provider
  label: string
  hint: string
  url?: string
}

const PROVIDERS: ProviderOption[] = [
  {
    key: 'oidc',
    label: 'OIDC Login',
    hint: '推荐 — 通过 IHEP HAI 统一身份认证登录',
    url: 'https://ai-dev.ihep.ac.cn',
  },
  {
    key: 'hepai',
    label: 'HepAI',
    hint: 'IHEP/CAS 高速访问（API Key）',
    url: 'https://aiapi.ihep.ac.cn/',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude 系列模型',
    url: 'https://console.anthropic.com/',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    hint: 'GPT 系列模型',
    url: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'skip',
    label: 'Skip',
    hint: '我会通过环境变量设置',
  },
]

interface SetupScreenProps {
  gw: GatewayClient
  configExists: boolean
  /** Called after a successful save in boot mode. Triggers App to re-bootstrap. */
  onComplete: () => void
  /** When provided, the component runs in overlay mode: submit() calls this
   *  instead of onComplete, and Esc/Enter dismisses the error step. */
  onDismiss?: () => void
}

type Step = 'username' | 'config' | 'provider' | 'apikey' | 'baseurl' | 'submitting' | 'done' | 'error'

interface ConfigEntry {
  value: string
  source?: string
}

interface ConfigResponse {
  config: Record<string, ConfigEntry | string | number | boolean | null>
  config_path: string
}

export function SetupScreen({ gw, configExists, onComplete, onDismiss }: SetupScreenProps) {
  // In overlay mode (configExists=true), start with a 'config' step that
  // shows the current configuration and lets the user choose to reconfigure
  // or dismiss. In boot mode (configExists=false), start at 'username'.
  const [step, setStep] = useState<Step>(configExists ? 'config' : 'username')
  const [cursor, setCursor] = useState(0)
  const [userId, setUserIdValue] = useState('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [, setBaseUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Current config (fetched in overlay mode for display)
  const [currentConfig, setCurrentConfig] = useState<ConfigResponse | null>(null)

  // Fetch current config when in overlay mode
  useEffect(() => {
    if (configExists && step === 'config') {
      gw.request<ConfigResponse>('setup.config', {})
        .then((resp: ConfigResponse) => setCurrentConfig(resp))
        .catch(() => {/* ignore — config display is optional */})
    }
  }, [configExists, step, gw])

  const selectedProvider = useMemo(
    () => PROVIDERS.find(p => p.key === provider) ?? null,
    [provider],
  )

  // Provider selection (arrow keys + Enter + number shortcuts)
  // Config step (overlay mode): Enter to reconfigure, Esc to dismiss
  // Error step (overlay mode): Esc/Enter to dismiss
  useInput(
    (input, key) => {
      if (isTerminalFocusEvent(input)) return

      // Config step in overlay mode: Enter starts reconfig, Esc dismisses
      if (step === 'config' && onDismiss) {
        if (key.escape) {
          onDismiss()
          return
        }
        if (key.return) {
          setStep('provider')
          return
        }
        return
      }

      // Error step in overlay mode: Esc or Enter dismisses the panel
      if (step === 'error' && onDismiss) {
        if (key.escape || key.return) {
          onDismiss()
        }
        return
      }

      if (step !== 'provider') return
      if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setCursor(c => Math.min(PROVIDERS.length - 1, c + 1))
        return
      }
      if (key.return) {
        const picked = PROVIDERS[cursor]
        setProvider(picked.key)
        if (picked.key === 'skip') {
          // Save an empty record so we don't keep nagging across launches.
          void submit('skip', '', '')
        } else if (picked.key === 'oidc') {
          // OIDC: save user_id + set auth_mode=oidc, then let onComplete
          // trigger the auth phase in app.tsx
          void submitOidc()
        } else {
          setStep('apikey')
        }
        return
      }
      if (input >= '1' && input <= String(PROVIDERS.length)) {
        const idx = parseInt(input, 10) - 1
        setCursor(idx)
        const picked = PROVIDERS[idx]
        setProvider(picked.key)
        if (picked.key === 'skip') {
          void submit('skip', '', '')
        } else if (picked.key === 'oidc') {
          void submitOidc()
        } else {
          setStep('apikey')
        }
      }
    },
  )

  async function submit(prov: Provider, key: string, url: string) {
    setStep('submitting')
    try {
      await gw.request('setup.save', {
        provider: prov,
        api_key: key,
        base_url: url,
        user_id: userId || undefined,
      })
      setStep('done')
      // Overlay mode: close panel after brief success display.
      // Boot mode: trigger App re-bootstrap.
      if (onDismiss) {
        setTimeout(onDismiss, 500)
      } else {
        setTimeout(onComplete, 500)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStep('error')
    }
  }

  async function submitOidc() {
    // Save user_id + set auth_mode=oidc. No API key needed —
    // the actual OIDC login happens in the AuthScreen phase.
    setStep('submitting')
    try {
      await gw.request('setup.save', {
        provider: 'skip',
        user_id: userId || undefined,
        auth_mode: 'oidc',
      })
      setStep('done')
      // Trigger onComplete → app.tsx will check auth.status and route
      // to the auth screen since auth_mode=oidc + not authenticated
      if (onDismiss) {
        setTimeout(onDismiss, 500)
      } else {
        setTimeout(onComplete, 500)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStep('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const banner = (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.primary} bold>⚡ OpenDrSai </Text>
        <Text color={theme.warn}>· setup</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          {configExists
            ? step === 'config'
              ? 'Review your configuration below. Press Enter to modify, Esc to close.'
              : 'No API key configured. Add one below to continue.'
            : 'First run — choose a provider and enter your API key.'}
        </Text>
      </Box>
    </Box>
  )

  if (step === 'config') {
    // Render current config fields
    const cfg = currentConfig?.config
    const configLines: ReactNode[] = []
    if (cfg) {
      const entries = Object.entries(cfg).sort(([a], [b]) => a.localeCompare(b))
      for (const [k, v] of entries) {
        let display: string
        if (v && typeof v === 'object' && 'value' in v) {
          const entry = v as ConfigEntry
          display = entry.value + (entry.source ? `  (${entry.source})` : '')
        } else if (v === null || v === undefined) {
          display = '<not set>'
        } else {
          display = String(v)
        }
        configLines.push(
          <Box key={k}>
            <Text color={theme.text}>  {k.padEnd(20)} </Text>
            <Text color={theme.muted}>{display}</Text>
          </Box>
        )
      }
    } else {
      configLines.push(<Text key="loading" color={theme.muted} dimColor>Loading config…</Text>)
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>Current Configuration</Text>
          {currentConfig?.config_path && (
            <Text color={theme.muted} dimColor>{currentConfig.config_path}</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {configLines}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Enter: reconfigure · Esc: close
          </Text>
        </Box>
      </Box>
    )
  }

  if (step === 'username') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>Your user id</Text>
          <Text color={theme.muted} dimColor>
            Identifies you in saved sessions and the status bar.
            (e.g. your IHEP/CAS username, GitHub handle, etc.)
          </Text>
        </Box>
        <Box marginTop={1}>
          <TextInput
            prompt="  user › "
            placeholder="enter a name (Enter alone uses 'anonymous')"
            allowEmpty
            onSubmit={text => {
              setUserIdValue(text || 'anonymous')
              setStep('provider')
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'provider') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>Choose a provider:</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {PROVIDERS.map((p, i) => {
            const isCursor = i === cursor
            const color = isCursor ? theme.accent : theme.text
            return (
              <Box key={p.key} flexDirection="column">
                <Box>
                  <Text color={color}>
                    {isCursor ? '▶ ' : '  '}
                    {i + 1}. {p.label.padEnd(12)}
                    <Text color={theme.muted} dimColor> — {p.hint}</Text>
                  </Text>
                </Box>
                {isCursor && p.url && (
                  <Box paddingLeft={6}>
                    <Text color={theme.muted} dimColor>
                      Get a key: <Text color={theme.good}>{p.url}</Text>
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            ↑/↓ navigate · Enter select · 1-{PROVIDERS.length} jump · Ctrl+D exit
          </Text>
        </Box>
      </Box>
    )
  }

  if (step === 'apikey') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>{selectedProvider?.label} API Key</Text>
          {selectedProvider?.url && (
            <Text color={theme.muted} dimColor>
              Need one? Visit <Text color={theme.good}>{selectedProvider.url}</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <TextInput
            prompt="  key › "
            placeholder="paste your API key here, then press Enter"
            onCancel={() => setStep('provider')}
            onSubmit={text => {
              setApiKey(text)
              setStep('baseurl')
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>
            Enter submits · Esc cancel (Ctrl+D to exit)
          </Text>
        </Box>
      </Box>
    )
  }

  if (step === 'baseurl') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent} bold>
            Base URL (optional — Enter to skip and use default)
          </Text>
          {provider === 'hepai' && (
            <Text color={theme.muted} dimColor>
              HepAI default: https://aiapi.ihep.ac.cn/apiv2
            </Text>
          )}
          {provider === 'anthropic' && (
            <Text color={theme.muted} dimColor>
              Anthropic default: https://api.anthropic.com
            </Text>
          )}
          {provider === 'openai' && (
            <Text color={theme.muted} dimColor>
              OpenAI default: https://api.openai.com/v1
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <TextInput
            prompt="  url › "
            placeholder="press Enter to use default"
            allowEmpty
            onCancel={() => setStep('apikey')}
            onSubmit={text => {
              setBaseUrl(text)
              void submit(provider!, apiKey, text)
            }}
          />
        </Box>
      </Box>
    )
  }

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.warn}>○ Saving config…</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'done') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {banner}
        <Box marginTop={1}>
          <Text color={theme.good}>
            {onDismiss ? '✓ Saved. New configuration is active.' : '✓ Saved. Starting TUI…'}
          </Text>
        </Box>
      </Box>
    )
  }

  // step === 'error'
  return (
    <Box flexDirection="column" paddingX={1}>
      {banner}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.error}>✗ Setup failed: {errorMsg}</Text>
        <Text color={theme.muted} dimColor>
          {onDismiss
            ? 'Press Esc or Enter to dismiss, then retry /setup wizard.'
            : 'Press Ctrl+D to exit, then re-run `drsai`.'}
        </Text>
      </Box>
    </Box>
  )
}
