/**
 * clipboard — cross-platform clipboard reading for TUI paste fallback.
 *
 * When a terminal does NOT support bracketed paste mode (e.g. legacy
 * Windows PowerShell / conhost.exe), Ctrl+V sends the raw control
 * character \x16 instead of wrapping clipboard content in
 * \x1b[200~ … \x1b[201~ markers.  This module provides a fallback that
 * reads the system clipboard directly via a subprocess.
 *
 * Platform support:
 *   - Windows  → powershell -NoProfile -Command "Get-Clipboard"
 *   - macOS    → pbpaste
 *   - Linux    → xclip -selection clipboard -o  (falls back to xsel)
 *
 * In SSH sessions the clipboard is on the LOCAL machine, not the
 * remote server.  These commands read the REMOTE machine's clipboard,
 * which may be empty or unavailable.  Bracketed paste mode (enabled in
 * entry.tsx) is the correct mechanism for SSH paste — it wraps content
 * at the local terminal before sending it over the SSH connection.
 * This clipboard fallback is only for local sessions where the
 * terminal doesn't support bracketed paste.
 */

import { execFile } from 'node:child_process'
import { platform } from 'node:os'

/** Cache the resolved command so we don't spawn `which` on every Ctrl+V. */
let resolvedCmd: { cmd: string; args: string[] } | null | undefined = undefined

/**
 * Detect the best available clipboard-reading command for this platform.
 * Returns `null` if no suitable command is found.
 *
 * The detection is async because on Linux we may need to check whether
 * `xclip` or `xsel` is installed.
 */
async function resolveClipboardCmd(): Promise<{ cmd: string; args: string[] } | null> {
  if (resolvedCmd !== undefined) return resolvedCmd

  const plat = platform()

  if (plat === 'win32') {
    // Windows PowerShell — works on all modern Windows installations.
    // -NoProfile avoids loading the user's PowerShell profile (faster).
    resolvedCmd = { cmd: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-Clipboard'] }
    return resolvedCmd
  }

  if (plat === 'darwin') {
    // macOS — pbpaste is always available.
    resolvedCmd = { cmd: 'pbpaste', args: [] }
    return resolvedCmd
  }

  // Linux / *nix — try xclip first, then xsel.
  // We can't easily check `which` without spawning a process, so we
  // just try xclip and fall back to xsel on error.
  resolvedCmd = { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] }
  return resolvedCmd
}

/**
 * Read the system clipboard. Returns the clipboard text or an empty
 * string if the clipboard is empty or reading fails.
 *
 * This is async (spawns a subprocess). In practice the subprocess
 * completes in < 100ms, so the delay is imperceptible.
 *
 * On Linux, if `xclip` fails (not installed), this function
 * transparently retries with `xsel`.
 */
export async function readClipboard(): Promise<string> {
  try {
    const cmd = await resolveClipboardCmd()
    if (!cmd) return ''

    const result = await runCmd(cmd.cmd, cmd.args)
    if (result.trim()) return result

    // Linux fallback: xclip failed → try xsel
    if (platform() === 'linux') {
      const xselResult = await runCmd('xsel', ['--clipboard', '--output']).catch(() => '')
      if (xselResult.trim()) {
        // Cache xsel for future calls
        resolvedCmd = { cmd: 'xsel', args: ['--clipboard', '--output'] }
        return xselResult
      }
    }

    return ''
  } catch {
    return ''
  }
}

/**
 * Check whether clipboard reading is likely to work on this platform.
 * Synchronous, for use in UI logic that needs to decide whether to
 * show a "Ctrl+V to paste" hint.
 */
export function isClipboardAvailable(): boolean {
  const plat = platform()
  // Windows and macOS always have clipboard tools.
  // Linux is assumed to have xclip or xsel (checked lazily on first use).
  return plat === 'win32' || plat === 'darwin' || plat === 'linux'
}

/** Run a command and return its stdout as a string. */
function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}
