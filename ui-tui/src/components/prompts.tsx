/**
 * Approval / Clarify / Secret prompts — modal overlays consuming user input
 * via numeric choice or freetext, then responding via the gateway RPCs.
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import type { GatewayClient } from '../gatewayClient.js'
import { $approval, $clarify, $secret, $sudo } from '../app/overlayStore.js'
import { theme } from '../theme.js'

import { TextInput } from './textInput.js'

interface Props {
  gw: GatewayClient
}

export function PromptsOverlay({ gw }: Props) {
  const approval = useStore($approval)
  const clarify = useStore($clarify)
  const secret = useStore($secret)
  const sudo = useStore($sudo)

  // Only one overlay shows at a time — render the highest-priority active one.
  if (approval) return <ApprovalOverlay gw={gw} payload={approval} />
  if (clarify) return <ClarifyOverlay gw={gw} payload={clarify} />
  if (secret) return <SecretOverlay gw={gw} payload={secret} />
  if (sudo) return <SudoOverlay gw={gw} payload={sudo} />
  return null
}

function ApprovalOverlay({
  gw, payload,
}: { gw: GatewayClient; payload: NonNullable<ReturnType<typeof $approval.get>> }) {
  const choices = payload.choices.length > 0 ? payload.choices : ['approve', 'deny']

  useInput((input, _key) => {
    const idx = parseInt(input, 10)
    if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
      const choice = choices[idx - 1]
      $approval.set(null)
      gw.request('approval.respond', {
        request_id: payload.request_id,
        choice,
      }).catch(() => {})
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.approvalBorder} paddingX={1} marginTop={1}>
      <Text color={theme.approvalBorder} bold>⚠  Approval required</Text>
      {payload.description && <Text color={theme.text}>{payload.description}</Text>}
      <Box marginTop={1}>
        <Text color={theme.muted}>Command: </Text>
        <Text color={theme.text}>{truncate(payload.command, 200)}</Text>
      </Box>
      <Box marginTop={1}>
        {choices.map((c, i) => (
          <Text key={c} color={theme.accent}>{`  [${i + 1}] ${c}  `}</Text>
        ))}
      </Box>
      <Text color={theme.muted} dimColor>press a number to choose</Text>
    </Box>
  )
}

function ClarifyOverlay({
  gw, payload,
}: { gw: GatewayClient; payload: NonNullable<ReturnType<typeof $clarify.get>> }) {
  const [text, setText] = useState('')
  const choices = payload.choices ?? []

  useInput((input, _key) => {
    if (payload.is_freetext || choices.length === 0) return
    const idx = parseInt(input, 10)
    if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
      const answer = choices[idx - 1]
      $clarify.set(null)
      gw.request('clarify.respond', {
        request_id: payload.request_id,
        answer,
      }).catch(() => {})
    }
  })

  if (!payload.is_freetext && choices.length > 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1} marginTop={1}>
        <Text color={theme.warn} bold>?  Clarify</Text>
        <Text color={theme.text}>{payload.question}</Text>
        <Box marginTop={1} flexDirection="column">
          {choices.map((c, i) => (
            <Text key={c} color={theme.accent}>{`  [${i + 1}] ${c}`}</Text>
          ))}
        </Box>
      </Box>
    )
  }

  // Freetext clarify
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1} marginTop={1}>
      <Text color={theme.warn} bold>?  Clarify</Text>
      <Text color={theme.text}>{payload.question}</Text>
      <TextInput
        prompt=" › "
        placeholder="type your answer + Enter"
        onSubmit={answer => {
          $clarify.set(null)
          setText('')
          gw.request('clarify.respond', {
            request_id: payload.request_id,
            answer,
          }).catch(() => {})
        }}
      />
      {/* unused but kept to satisfy controlled-component pattern if we add it later */}
      {text === '' && null}
    </Box>
  )
}

function SecretOverlay({
  gw, payload,
}: { gw: GatewayClient; payload: NonNullable<ReturnType<typeof $secret.get>> }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1} marginTop={1}>
      <Text color={theme.warn} bold>🔑  Secret needed: {payload.env_var}</Text>
      <Text color={theme.text}>{payload.prompt || `Enter value for ${payload.env_var}:`}</Text>
      <TextInput
        prompt=" › "
        placeholder="(input shown — terminal does not mask in this build)"
        onSubmit={value => {
          $secret.set(null)
          gw.request('secret.respond', {
            request_id: payload.request_id,
            value,
          }).catch(() => {})
        }}
      />
    </Box>
  )
}

function SudoOverlay({
  gw, payload,
}: { gw: GatewayClient; payload: NonNullable<ReturnType<typeof $sudo.get>> }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.error} paddingX={1} marginTop={1}>
      <Text color={theme.error} bold>🔐  sudo password</Text>
      <TextInput
        prompt=" › "
        placeholder="(input shown — terminal does not mask in this build)"
        onSubmit={password => {
          $sudo.set(null)
          gw.request('sudo.respond', {
            request_id: payload.request_id,
            password,
          }).catch(() => {})
        }}
      />
    </Box>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
