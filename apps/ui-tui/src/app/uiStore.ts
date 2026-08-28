/**
 * uiStore — top-level UI state: session metadata, gateway connection status,
 * status-line text. Persists across many turns.
 */

import { atom } from 'nanostores'

import type { GatewaySkin, SessionMetadata } from '../gatewayTypes.js'

export type ConnectionStatus = 'connecting' | 'ready' | 'error' | 'exited' | 'remote_lost'

export const $connectionStatus = atom<ConnectionStatus>('connecting')
export const $connectionError = atom<string>('')
/** Remote SSH host name when connected via /remote panel; empty in local mode. */
export const $remoteHost = atom<string>('')
export const $skin = atom<GatewaySkin | null>(null)
export const $sessionMeta = atom<SessionMetadata | null>(null)
export const $statusLine = atom<string>('')
export const $userId = atom<string>('')
export const $showReasoning = atom<boolean>(false)

/**
 * Memory preview content (MEMORY.md) displayed on TUI startup.
 *
 * Populated when the backend emits a ``status.update`` event with
 * ``kind: "memory.preview"``. When non-empty, the TUI renders a
 * collapsible "📋 Memory" banner above the transcript so the user
 * can see what was done before and what to continue.
 */
export const $memoryPreview = atom<string>('')

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
  | 'smartSearch'
  | 'quickSwitch'

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

/**
 * Latest token usage from the most recent assistant turn (Issue #8 fix).
 *
 * Updated by createGatewayEventHandler when message.complete arrives.
 * Displayed in StatusBar so users can always see token consumption even
 * when the turn's usage line scrolls out of view.
 */
export interface UsageInfo {
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_total?: number
  completion_tokens_total?: number
  total_tokens_accumulated?: number
}

export const $lastUsage = atom<UsageInfo | null>(null)

/**
 * Streaming token estimate — a rough character-based estimate of
 * completion tokens during streaming, before real usage data arrives.
 * Updated on each `message.delta` and reset when `usage.update` or
 * `message.complete` arrives.
 */
export const $streamingTokenEstimate = atom<number>(0)

/**
 * "Copy mode" — when true the TUI temporarily disables mouse tracking so
 * the user can select / copy text in the terminal with the mouse.
 *
 * Toggled via Ctrl+Y from <App>'s useInput. We do NOT exit the alternate
 * screen buffer when entering copy mode: leaving alt-screen mid-session
 * would discard everything Ink has rendered. Disabling mouse tracking is
 * sufficient for selection on every modern terminal (iTerm2, kitty,
 * Alacritty, Windows Terminal, GNOME Terminal, Konsole, VSCode, ...);
 * users on terminals with native scrollback want
 * ``DRSAI_TUI_DISABLE_ALT_SCREEN=1`` at startup, which is a separate knob.
 *
 * Visual indicator lives in StatusBar so the user always knows which
 * mode they are in.
 */
export const $copyMode = atom<boolean>(false)

/**
 * Current visual height (in terminal rows) of the composer's TextInput
 * area, as reported by ``<TextInput>`` via ``onHeightChange``.
 *
 * ``<StreamingAssistant>`` reads this atom to dynamically adjust
 * ``RESERVED_ROWS``: when the user types more lines, the input box
 * grows, so the streaming content budget shrinks to keep the total
 * dynamic frame strictly below ``stdout.rows`` (preventing Ink's
 * fullscreen branch — the P0 crash fix).
 *
 * Lifecycle:
 *   - Default ``1`` (placeholder-only, single line).
 *   - Grows as the user types multi-line input, up to ``maxRows + 1``
 *     (1 line of overflow is allowed before scroll mode engages).
 *   - Once ``maxRows + 1`` is exceeded, TextInput enters scroll mode,
 *     showing ``maxRows`` visible lines + ↑/↓ markers as needed.
 *   - Resets to ``1`` when the input is cleared (submit) or when
 *     streaming begins (disabled → placeholder).
 *
 * Formula in StreamingAssistant:
 *   RESERVED_ROWS = composerInputHeight + 6
 *   (6 = marginTop(1) + divider(1) + StatusBar(2) + Banner(1) + safety(1))
 */
export const $composerInputHeight = atom<number>(1)
