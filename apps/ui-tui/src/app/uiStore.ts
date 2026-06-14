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

/**
 * Whether the terminal currently has window focus.
 *
 * Driven by XTerm focus reporting (entry.tsx enables it; <App> sniffs
 * the `\x1b[I` / `\x1b[O` events from stdin and updates this atom).
 *
 * Defaults to ``true``: terminals that don't support focus reporting
 * (macOS Terminal.app, ancient Linux consoles) simply never send the
 * events, so focused stays true forever — the cursor blinks like
 * before, which is the correct fallback.
 *
 * Used by ``useCursorBlink`` to pause the blink when the user moves
 * away from the terminal — a real terminal cursor stops blinking when
 * the window loses focus, and our fake cursor should match that.
 */
export const $terminalFocused = atom<boolean>(true)

/**
 * The name of the highest-priority overlay currently capturing keyboard
 * input, or ``null`` when no such overlay is active.
 *
 * Why we need this:
 *   Ink's ``useInput`` is a broadcast — every mounted listener sees
 *   every keystroke, with no event-propagation control. When an
 *   approval / clarify prompt is showing AND the composer's TextInput
 *   is also mounted (which happens whenever streaming is not in
 *   progress), pressing ``1`` to accept the approval ALSO inserts a
 *   ``1`` into the input box. That is the conflict P1-05 fixes.
 *
 * Semantics:
 *   The lifecycle of the overlay component (mount / unmount) sets this
 *   atom via useEffect cleanup. Other ``useInput`` callsites in the
 *   composer tree pass ``{ isActive: $activeOverlay === null }`` to
 *   Ink's hook so that Ink itself skips installing the listener when
 *   an overlay owns the keyboard.
 *
 * Why only one slot (vs. a stack):
 *   In practice only one overlay shows at a time — PromptsOverlay
 *   already enforces a single-modal priority chain (approval >
 *   clarify > secret > sudo), and the picker / editor overlays
 *   replace the composer body entirely so they cannot collide with
 *   the TextInput. A single nullable slot is enough.
 *
 * Values currently in use:
 *   - ``'approval'`` / ``'clarify'`` / ``'secret'`` / ``'sudo'`` —
 *     the four PromptsOverlay sub-overlays.
 *
 * Future expansion: if a new overlay does mount on top of the
 * TextInput (rather than replacing it), add a constant string for it
 * here and make sure the overlay maintains the atom via useEffect.
 */
export type ActiveOverlay =
  | 'approval'
  | 'clarify'
  | 'secret'
  | 'sudo'

export const $activeOverlay = atom<ActiveOverlay | null>(null)

/**
 * Tool-call detail mode. ``compact`` keeps the original 60/80-char
 * truncation; ``expanded`` shows full args and a multi-line result
 * preview. Toggled by Ctrl+T (see <App>).
 *
 * Reason for adding this:
 *   When debugging a long agent run users very often need to see the
 *   exact bash command, grep pattern, or file path the agent picked.
 *   The default compact line cuts the value at 60 chars which is fine
 *   for normal flow but hides everything interesting when something
 *   goes wrong. Rather than always-expanded (loud) or always-compact
 *   (frustrating), we let the user flip a switch.
 *
 * Default ``compact`` so the visual remains identical to before for
 * users who never press Ctrl+T.
 */
export type ToolDetailMode = 'compact' | 'expanded'
export const $toolDetail = atom<ToolDetailMode>('compact')
