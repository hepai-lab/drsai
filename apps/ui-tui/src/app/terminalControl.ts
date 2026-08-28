/**
 * terminalControl — runtime control of terminal modes (alt-screen, mouse
 * tracking, focus reporting) initialized in ``entry.tsx``.
 *
 * Why this lives in its own module:
 *   ``entry.tsx`` boots the TUI and writes the enable sequences once at
 *   startup. We later need to toggle some of them at runtime (for the
 *   "copy / select" mode triggered by Ctrl+Y) — but the App component
 *   has no reasonable way to import functions from ``entry.tsx`` without
 *   creating a circular dependency. This module owns the mutable terminal
 *   state and exposes idempotent enable/disable helpers that both the
 *   bootstrapper and the runtime toggle can call.
 *
 *   The functions are no-ops when stdout is not a TTY, and they swallow
 *   write errors (best-effort terminal control).
 *
 * Modes managed here:
 *   - Mouse tracking (\x1b[?1000h \x1b[?1006h)
 *       Disabling lets the user select / copy with the mouse natively,
 *       which is the main reason we expose a runtime toggle.
 *   - Alternate screen buffer (\x1b[?1049h)
 *       Wrapping the TUI in its own terminal page (vim/less style).
 *       Not toggled at runtime by the copy mode — leaving alt-screen
 *       mid-session would discard everything Ink has rendered so far.
 *   - Focus reporting (\x1b[?1004h)
 *       Lets the app know when the terminal window loses focus so we
 *       can pause cursor blink. Only restored on shutdown.
 *   - Bracketed paste (\x1b[?2004h)
 *       Makes the terminal wrap paste content with \x1b[200~ … \x1b[201~
 *       so the app can unambiguously detect pasted text (including over
 *       SSH). Without this, Ctrl+V / Ctrl+Shift+V / middle-click paste
 *       arrive as raw characters that the input handler cannot distinguish
 *       from typed text, and single-line pastes are silently dropped.
 *       The existing looksLikePastedText() / normalisePastedText() logic
 *       in textInput.tsx already handles the bracket markers — we just
 *       need to turn the mode on.
 */

const MOUSE_TRACKING_ENABLE = '\x1b[?1000h\x1b[?1006h'
const MOUSE_TRACKING_DISABLE = '\x1b[?1006l\x1b[?1000l'

const ALT_SCREEN_ENABLE = '\x1b[?1049h'
const ALT_SCREEN_DISABLE = '\x1b[?1049l'

const FOCUS_REPORTING_ENABLE = '\x1b[?1004h'
const FOCUS_REPORTING_DISABLE = '\x1b[?1004l'

const BRACKETED_PASTE_ENABLE = '\x1b[?2004h'
const BRACKETED_PASTE_DISABLE = '\x1b[?2004l'

let mouseTrackingEnabled = false
let altScreenEnabled = false
let focusReportingEnabled = false
let bracketedPasteEnabled = false

function safeWrite(seq: string): void {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(seq)
    }
  } catch {
    // best-effort
  }
}

// ── Mouse tracking ─────────────────────────────────────────────────

export function enableMouseTracking(): void {
  if (mouseTrackingEnabled) return
  if (!process.stdout.isTTY) return
  safeWrite(MOUSE_TRACKING_ENABLE)
  mouseTrackingEnabled = true
}

export function disableMouseTracking(): void {
  if (!mouseTrackingEnabled) return
  safeWrite(MOUSE_TRACKING_DISABLE)
  mouseTrackingEnabled = false
}

export function isMouseTrackingEnabled(): boolean {
  return mouseTrackingEnabled
}

// ── Alternate screen ───────────────────────────────────────────────

export function enableAltScreen(): void {
  if (altScreenEnabled) return
  if (!process.stdout.isTTY) return
  safeWrite(ALT_SCREEN_ENABLE)
  // Cursor home + clear so the viewport starts at the top of the
  // alternate buffer (otherwise Ink can paint partway down a stale
  // buffer that the terminal cached).
  safeWrite('\x1b[H\x1b[2J')
  altScreenEnabled = true
}

export function disableAltScreen(): void {
  if (!altScreenEnabled) return
  safeWrite(ALT_SCREEN_DISABLE)
  altScreenEnabled = false
}

export function isAltScreenEnabled(): boolean {
  return altScreenEnabled
}

// ── Focus reporting ────────────────────────────────────────────────

export function enableFocusReporting(): void {
  if (focusReportingEnabled) return
  if (!process.stdout.isTTY) return
  safeWrite(FOCUS_REPORTING_ENABLE)
  focusReportingEnabled = true
}

export function disableFocusReporting(): void {
  if (!focusReportingEnabled) return
  safeWrite(FOCUS_REPORTING_DISABLE)
  focusReportingEnabled = false
}

export function isFocusReportingEnabled(): boolean {
  return focusReportingEnabled
}

// ── Bracketed paste ────────────────────────────────────────────────

export function enableBracketedPaste(): void {
  if (bracketedPasteEnabled) return
  if (!process.stdout.isTTY) return
  safeWrite(BRACKETED_PASTE_ENABLE)
  bracketedPasteEnabled = true
}

export function disableBracketedPaste(): void {
  if (!bracketedPasteEnabled) return
  safeWrite(BRACKETED_PASTE_DISABLE)
  bracketedPasteEnabled = false
}

export function isBracketedPasteEnabled(): boolean {
  return bracketedPasteEnabled
}
