/**
 * uiStore — top-level UI state: session metadata, gateway connection status,
 * status-line text. Persists across many turns.
 */

import { atom } from 'nanostores'

import type { GatewaySkin, SessionMetadata } from '../gatewayTypes.js'

export type ConnectionStatus = 'connecting' | 'ready' | 'error' | 'exited'

export const $connectionStatus = atom<ConnectionStatus>('connecting')
export const $connectionError = atom<string>('')
export const $skin = atom<GatewaySkin | null>(null)
export const $sessionMeta = atom<SessionMetadata | null>(null)
export const $statusLine = atom<string>('')
export const $userId = atom<string>('')
export const $showReasoning = atom<boolean>(false)
