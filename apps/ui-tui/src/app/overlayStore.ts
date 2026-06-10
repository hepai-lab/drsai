/**
 * overlayStore — interactive prompt overlays (approval / clarify / secret).
 *
 * Each store holds at most one pending request at a time. The TUI renders a
 * floating panel over the composer when any of these is set; pressing the
 * binding submits a `*.respond` RPC and clears the store.
 */

import { atom } from 'nanostores'

import type {
  ApprovalRequestPayload,
  ClarifyRequestPayload,
  SecretRequestPayload,
  SudoRequestPayload,
} from '../gatewayTypes.js'

export const $approval = atom<ApprovalRequestPayload | null>(null)
export const $clarify = atom<ClarifyRequestPayload | null>(null)
export const $secret = atom<SecretRequestPayload | null>(null)
export const $sudo = atom<SudoRequestPayload | null>(null)
