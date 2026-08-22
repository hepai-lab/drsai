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
import { useMemo, useState } from 'react'

import { isTerminalFocusEvent } from '../app/focusEvents.js'
import type { GatewayClient } from '../gatewayClient.js'
import { theme } from '../theme.js'

import { TextInput } from './textInput.js'

type Provider = 'hepai' | 'anthropic' | 'openai' | 'skip'

interface ProviderOption {
  key: Provider
  label: string
  hint: string
  url?: string
}

const PROVIDERS: ProviderOption[] = [
  {
    key: 'hepai',
    label: 'HepAI',
    hint: '推荐 — IHEP/CAS 高速访问',
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
  /** Called after a successful save. Triggers App to re-bootstrap. */
  onComplete: () => void
}

type Step = 'username' | 'provider' | 'apikey' | 'baseurl' | 'submitting' | 'done' | 'error'

export function SetupScreen({ gw, configExists, onComplete }: SetupScreenProps) {
  // Skip the username prompt when re-running setup just to fix a missing key
  // — config already has a user_id we shouldn't overwrite.
  const [step, setStep] = useState<Step>(configExists ? 'provider' : 'username')
  const [cursor, setCursor] = useState(0)
  const [userId, setUserIdValue] = useState('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [, setBaseUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const selectedProvider = useMemo(
    () => PROVIDERS.find(p => p.key === provider) ?? null,
    [provider],
  )

  // Provider selection (arrow keys + Enter + number shortcuts)
  useInput(
    (input, key) => {
      if (isTerminalFocusEvent(input)) return
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
      // Small delay so the user sees the success message
      setTimeout(onComplete, 500)
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
            ? 'No API key configured. Add one below to continue.'
            : 'First run — choose a provider and enter your API key.'}
        </Text>
      </Box>
    </Box>
  )

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
          <Text color={theme.good}>✓ Saved. Starting TUI…</Text>
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
          Press Ctrl+D to exit, then re-run `drsai`.
        </Text>
      </Box>
    </Box>
  )
}
