/**
 * ComposerPane — composer area with TextInput, hooked to TurnController.
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useApp, useInput } from 'ink'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, isAbsolute, resolve, win32 } from 'node:path'
import { homedir } from 'node:os'
import { useEffect, useRef, useState, useCallback } from 'react'

import { loadPromptHistory, savePromptHistory } from '../app/promptHistory.js'
import { isTerminalFocusEvent } from '../app/focusEvents.js'
import { $isStreaming, $transcript, $current } from '../app/turnStore.js'
import type { ImageAttachment, TurnController } from '../app/turnController.js'
import { $activeOverlay, $showReasoning, $userId, $sessionMeta, $memoryPreview, $lastUsage, $remoteHost, $composerInputHeight } from '../app/uiStore.js'
import type { SessionInfo, SessionListResult, SessionResumeResult, SessionCreateResult } from '../gatewayTypes.js'
import { theme } from '../theme.js'
import { useTerminalSize } from '../hooks/terminalSizeStore.js'

import { ModelEditor, type ModelEditorValues, type ModelProviderPreset } from './modelEditor.js'
import { ModelPicker, type ModelEntry } from './modelPicker.js'
import { SessionPicker } from './sessionPicker.js'
import { SmartSearchPane } from './smartSearchPane.js'
import { QuickSwitchPanel } from './quickSwitchPanel.js'
import { SkillsPane } from './skillsPane.js'
import { DaemonPanel } from './daemonPanel.js'
import { AgentPicker } from './agentPicker.js'
import { SchedulerPanel } from './schedulerPanel.js'
import { WeChatPanel } from './wechatPanel.js'
import { GfsPanel } from './gfsPanel.js'
import { SshRemotePanel } from './sshRemotePanel.js'
import { SetupScreen } from './setupScreen.js'
import { SlashOutputOverlay } from './slashOutputOverlay.js'
import { TextInput } from './textInput.js'
import { parseHistory } from '../app/historyParser.js'

function sessionSortTimestamp(session: SessionInfo): number {
  const raw = session.last_interaction_ts ?? session.updated_at ?? session.created_at ?? 0
  if (typeof raw === 'number') return raw
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface ComposerPaneProps {
  sessionId: string
  controller: TurnController
  switchSession: (sid: string) => Promise<void>
}

// ── Image helpers ─────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/** Maximum single image size (bytes) — 20 MB. */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
/** Maximum total images per message — 10. */
const MAX_IMAGES_PER_MSG = 10

/**
 * Resolve a user-supplied file path to an absolute path.
 *
 * - `~/...`  → expand home directory
 * - `/...`   → already absolute, keep as-is
 * - `./...` or `photos/img.png` → resolve against the user's real working
 *   directory (``DRSAI_USER_CWD``), NOT against ``process.cwd()`` which
 *   may point to the ui-tui package directory.
 */
function resolveFilePath(filePath: string): string {
  // Expand ~ to home directory
  if (filePath.startsWith('~')) {
    return filePath.replace('~', homedir())
  }

  // Already absolute for the platform that is running the TUI.
  if (isAbsolute(filePath)) {
    return filePath
  }

  // A Windows absolute path such as ``D:\\foo\\bar.png`` is NOT considered
  // absolute by Node when the TUI process is running on POSIX/Linux. Without
  // this guard, ``path.resolve(linuxCwd, 'D:\\foo.png')`` produces a bogus path
  // like ``/home/user/D:\\foo.png``. Treat it as absolute so the error message
  // points at the real user input instead of a cwd-prefixed fake path.
  if (win32.isAbsolute(filePath)) {
    return filePath
  }

  // Relative path — resolve against the user's real cwd
  const userCwd = process.env.DRSAI_USER_CWD?.trim() || process.cwd()
  return resolve(userCwd, filePath)
}

/**
 * Read a local image file and return an `ImageAttachment` object.
 * Returns an error dict if the file does not exist, is not an image, or
 * exceeds size limits.
 */
function readImageFile(filePath: string): ImageAttachment | { error: string } {
  const expanded = resolveFilePath(filePath)

  if (!existsSync(expanded)) {
    return { error: `File not found: ${filePath} (resolved: ${expanded})` }
  }

  const ext = extname(expanded).toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) {
    return { error: `Unsupported image format: ${ext} (${filePath})` }
  }

  const buffer = readFileSync(expanded)
  if (buffer.length > MAX_IMAGE_SIZE) {
    return { error: `Image too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB > 20 MB limit (${filePath})` }
  }

  return {
    path: filePath,
    base64: buffer.toString('base64'),
    mime_type: mime,
  }
}

/**
 * Detect `@/path`, `@~/path`, `@./path` image references in the text,
 * read the files, and return the cleaned text plus the image attachments.
 *
 * Examples:
 *   "Look at @/tmp/photo.png please"
 *   → { cleanText: "Look at [image: photo.png] please", images: [...] }
 *
 *   "Compare @./a.png and @./b.png"
 *   → { cleanText: "Compare [image: a.png] and [image: b.png]", images: [...] }
 */
function extractInlineImages(text: string): {
  cleanText: string
  images: ImageAttachment[]
  errors: string[]
} {
  const images: ImageAttachment[] = []
  const errors: string[] = []

  // Match @/abs/path.ext  @~/path.ext  @./relative/path.ext  @relative/path.ext
  // Negative lookbehind to avoid matching inside a URL (http://...)
  const inlineRe = /(?<![:\w])@(~?[./]?[^\s@]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi

  const cleanText = text.replace(inlineRe, (_match, rawPath: string) => {
    if (images.length + errors.length >= MAX_IMAGES_PER_MSG) {
      errors.push(`Too many images (max ${MAX_IMAGES_PER_MSG})`)
      return `@${rawPath}`
    }

    const result = readImageFile(rawPath)
    if ('error' in result) {
      errors.push(result.error)
      return `@${rawPath}`
    }

    images.push(result)
    return `[image: ${basename(rawPath)}]`
  })

  return { cleanText, images, errors }
}

/**
 * Parse the `/image` (or `/img`) command.
 *
 * Supports multiple image paths:
 *   /image /path/a.png ./b.png ~/c.jpg description text
 *   /img /tmp/photo.png
 *
 * Returns `{ paths, description }` or `null` if the input doesn't match.
 * All tokens that look like file paths (contain a dot + image extension)
 * are collected as image paths; the remaining tokens become the description.
 */
function _looksLikePath(token: string): boolean {
  // POSIX
  if (token.startsWith('/') || token.startsWith('~') || token.startsWith('./')) return true
  // Windows: .\relative  D:\absolute  \\UNC
  if (token.startsWith('.\\') || token.startsWith('\\\\')) return true
  if (/^[A-Za-z]:[\\\/]/.test(token)) return true
  return false
}

function parseImageCommand(text: string): { paths: string[]; description: string } | null {
  const m = text.match(/^\/(?:image|img)\s+(.+)$/s)
  if (!m) return null

  const tokens = m[1].trim().split(/\s+/)
  const paths: string[] = []
  const descTokens: string[] = []

  for (const token of tokens) {
    const ext = extname(token).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext) || _looksLikePath(token)) {
      // Heuristic: if it has an image extension OR looks like a path,
      // treat it as an image path.
      if (IMAGE_EXTENSIONS.has(ext)) {
        paths.push(token)
      } else {
        // Path prefix but no image extension — might be a description word
        // like "/help" or "./something". Only treat as path if it has an
        // image extension.
        descTokens.push(token)
      }
    } else {
      descTokens.push(token)
    }
  }

  if (paths.length === 0) return null
  return { paths, description: descTokens.join(' ') }
}

export function ComposerPane({ sessionId, controller, switchSession }: ComposerPaneProps) {
  const { exit } = useApp()
  const isStreaming = useStore($isStreaming)
  const activeOverlay = useStore($activeOverlay)
  const { cols, rows } = useTerminalSize()
  // Dynamic divider width: terminal width minus AppLayout paddingX=1×2.
  const dividerWidth = Math.max(20, cols - 2)
  // Input box upper bound: 40% of terminal rows, floor 5, cap 15.
  // This gives the input box enough room to grow before scroll mode
  // kicks in, preventing premature ↑/↓ arrow markers that annoy users.
  // (Previous 25% was too aggressive — only 6 rows on a 24-line term.)
  const inputMaxRows = Math.max(5, Math.min(Math.floor(rows * 0.4), 15))
  // Stable callback to report input height changes to the global atom.
  // StreamingAssistant subscribes to $composerInputHeight and adjusts
  // its RESERVED_ROWS dynamically — when input grows, streaming budget
  // shrinks, keeping the total dynamic frame < stdout.rows.
  const handleInputHeightChange = useCallback((h: number) => {
    $composerInputHeight.set(h)
  }, [])
  const [slashOutput, setSlashOutput] = useState<string | null>(null)
  const slashOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sessionPicker, setSessionPicker] = useState<SessionInfo[] | null>(null)
  const [smartSearch, setSmartSearch] = useState<{
    query: string
    results: Array<{ session_id: string; name: string; preview: string; relevance_score: number; match_snippet?: string }>
  } | null>(null)
  const [quickSwitch, setQuickSwitch] = useState<SessionInfo[] | null>(null)
  const [showSkillsPane, setShowSkillsPane] = useState(false)
  const [daemonPanelOpen, setDaemonPanelOpen] = useState(false)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [schedulerPanelOpen, setSchedulerPanelOpen] = useState(false)
  const [wechatPanelOpen, setWechatPanelOpen] = useState(false)
  const [gfsPanelOpen, setGfsPanelOpen] = useState(false)
  const [remotePanelOpen, setRemotePanelOpen] = useState(false)
  const [setupScreenOpen, setSetupScreenOpen] = useState(false)
  const [modelPicker, setModelPicker] = useState<
    { models: ModelEntry[]; currentAlias?: string } | null
  >(null)
  const [modelEditor, setModelEditor] = useState<
    | {
        isNew: boolean
        originalAlias?: string
        initial?: Partial<ModelEditorValues>
        revision?: string
      }
    | null
  >(null)
  const [modelProviderPresets, setModelProviderPresets] = useState<ModelProviderPreset[]>([])
  const [completions, setCompletions] = useState<string[]>([])
  const [initialHistory] = useState(() => loadPromptHistory())
  const historyRef = useRef<string[]>(initialHistory)

  // Fix 4.4: Concurrent request lock
  const isProcessingRef = useRef<boolean>(false)

  // Long-paste collapsing: when a paste exceeds the threshold we insert a
  // ``[[ Pasted #N: ... → /path/to/paste.txt ]]`` token into the visible input
  // and remember the real text in ``pasteSnipsRef``. On submit we substitute
  // the token back to the real text for the agent, while the transcript keeps
  // the compact token so huge logs/code files do not flood the TUI.
  const pasteSnipsRef = useRef<Array<{ inputLabel: string; displayLabel: string; text: string; path?: string }>>([])
  const pasteCounterRef = useRef(0)

  function clearSlashOutputTimer() {
    if (slashOutputTimerRef.current) {
      clearTimeout(slashOutputTimerRef.current)
      slashOutputTimerRef.current = null
    }
  }

  function showSlashOutput(output: string, timeoutMs?: number) {
    clearSlashOutputTimer()
    setSlashOutput(output)
    if (timeoutMs && timeoutMs > 0) {
      slashOutputTimerRef.current = setTimeout(() => {
        setSlashOutput(null)
        slashOutputTimerRef.current = null
      }, timeoutMs)
    }
  }

  function dismissSlashOutput() {
    clearSlashOutputTimer()
    setSlashOutput(null)
  }

  useEffect(() => clearSlashOutputTimer, [])

  // Load slash command catalog once for Tab completion
  useEffect(() => {
    let cancelled = false
    controller.gw
      .request<{ pairs: [string, string][] }>('commands.catalog', {})
      .then(result => {
        if (cancelled) return
        const cmds = (result.pairs || []).map(([name]) => '/' + name)
        setCompletions(cmds)
      })
      .catch(() => {/* ignore */})
    return () => {
      cancelled = true
    }
  }, [controller])

  useEffect(() => {
    let cancelled = false
    controller.gw.request<{ presets: ModelProviderPreset[] }>('model.config.presets', {})
      .then(result => { if (!cancelled) setModelProviderPresets(result.presets || []) })
      .catch(() => { if (!cancelled) setModelProviderPresets([]) })
    return () => { cancelled = true }
  }, [controller])

  // While streaming, capture Ctrl+C to cancel without exiting the app.
  useInput((_input, key) => {
    if (isTerminalFocusEvent(_input)) return
    if (isStreaming && key.ctrl && _input === 'c') {
      controller.cancel(sessionId)
    }
    // Ctrl+W: quick switch panel for current workdir sessions
    if (key.ctrl && _input === 'w') {
      controller.gw.request<{ sessions: SessionInfo[]; current_workdir_count: number }>(
        'session.quick_access',
        { limit: 10 },
      ).then(result => {
        setQuickSwitch(result.sessions || [])
      }).catch(err => {
        showSlashOutput(`Error loading quick access: ${err instanceof Error ? err.message : String(err)}`, 5000)
      })
      return
    }
  })

  async function openSessionPicker(workdirFilter?: string | null) {
    try {
      const result = await controller.gw.request<SessionListResult>('session.list', { limit: 50 })
      let sessions = result.sessions || []
      
      // Filter by workdir if specified:
      //   undefined (default) → filter to current workdir (same as /list default)
      //   null → show all sessions (--all flag)
      //   string → filter to that specific workdir
      if (workdirFilter === undefined) {
        const currentWorkdir = process.env.DRSAI_USER_CWD?.trim() || process.cwd()
        sessions = sessions.filter(s => s.workdir === currentWorkdir)
      } else if (workdirFilter !== null) {
        sessions = sessions.filter(s => s.workdir === workdirFilter)
      }
      
      // ADDED: Sort by last_interaction_ts descending (Issue #4 fix)
      // Most recently used sessions appear first
      sessions.sort((a, b) => {
        return sessionSortTimestamp(b) - sessionSortTimestamp(a)
      })
      
      setSessionPicker(sessions)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Error loading sessions: ${msg}`, 5000)
    }
  }

  async function openModelPicker() {
    try {
      const result = await controller.gw.request<{ models: ModelEntry[]; current?: string }>(
        'model.options',
        {},
      )
      const models = result.models || []
      setModelPicker({ models, currentAlias: result.current })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Error loading models: ${msg}`, 5000)
    }
  }

  async function openModelEditor(alias?: string) {
    if (!alias) {
      // No alias supplied → open an empty "add" form.
      setModelEditor({ isNew: true })
      return
    }
    // The compact editor always edits the active Provider/model. The picker
    // alias is only used as a suggested model when it differs from current.
    try {
      const result = await controller.gw.request<{
        model: string
        model_provider: string
        provider: {
          name: string
          base_url: string
          wire_api: 'openai' | 'anthropic'
          requires_api_key: boolean
        }
        revision?: string
        token_limit?: number
        max_tokens?: number
        vision?: boolean
        client_type?: string
        yaml_base_url?: string
        yaml_api_key_env?: string
        yaml_requires_api_key?: boolean
        yaml_use_responses_api?: boolean | null
      }>('model.config.get', {})
      setModelEditor({
        isNew: false,
        originalAlias: alias,
        initial: {
          provider: result.model_provider,
          model: alias || result.model,
          base_url: result.yaml_base_url || result.provider.base_url,
          wire_api: (result.client_type as 'openai' | 'anthropic') || result.provider.wire_api,
          requires_api_key: result.yaml_requires_api_key ?? result.provider.requires_api_key,
          api_key_env: result.yaml_api_key_env,
          token_limit: result.token_limit,
          max_tokens: result.max_tokens,
          vision: result.vision,
          use_responses_api: result.yaml_use_responses_api ?? null,
        },
        revision: result.revision,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Cannot edit ${alias}: ${msg}`, 5000)
    }
  }

  async function pickModelToEdit() {
    // Reuse the picker but route Enter to "edit this one" instead of switch.
    try {
      const result = await controller.gw.request<{ models: ModelEntry[]; current?: string }>(
        'model.options',
        {},
      )
      const list = result.models || []
      if (list.length === 0) {
        showSlashOutput('No models configured — try /model add', 4000)
        return
      }
      // Show picker; the user presses `e` (or Enter) to choose what to edit.
      // To keep this simple we just pop the picker; pressing `e` on the cursor
      // line opens the editor for that alias.
      setModelPicker({ models: list, currentAlias: result.current })
      showSlashOutput('Press e to edit the highlighted alias, a to add', 4000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Error loading models: ${msg}`, 5000)
    }
  }

  async function deleteModelWithConfirm(alias: string) {
    try {
      const active = await controller.gw.request<{ model_provider: string; revision?: string }>('model.config.get', {})
      const result = await controller.gw.request<{ ok: boolean; active: string }>(
        'model.config.delete',
        { provider: active.model_provider, session_id: sessionId, expected_revision: active.revision },
      )
      if (result.ok) {
        showSlashOutput(`Deleted provider ${active.model_provider}; active provider is ${result.active}`, 4000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showSlashOutput(`Delete failed: ${msg}`, 5000)
    }
  }

  // Threshold above which a paste collapses to a placeholder token.
  const LARGE_PASTE_CHARS = 1000
  const LARGE_PASTE_LINES = 20

  function maybeCollapsePaste(pasted: string): string | undefined {
    const lineCount = pasted.split('\n').length
    if (pasted.length < LARGE_PASTE_CHARS && lineCount < LARGE_PASTE_LINES) {
      return undefined // small enough, fall back to literal insertion
    }

    pasteCounterRef.current += 1
    const localId = pasteCounterRef.current
    const head = pasted.slice(0, 24).replace(/\s+/g, ' ').trim() || 'text'
    const fallbackLabel = `[[ Pasted #${localId}: ${head}… ${pasted.length} chars, ${lineCount} lines ]]`
    pasteSnipsRef.current.push({ inputLabel: fallbackLabel, displayLabel: fallbackLabel, text: pasted })

    // Best effort: ask backend to save a .txt copy and return a path-backed
    // label. The callback must be synchronous, so the first render may show the
    // fallback label; the final submitted transcript will use the path label if
    // the RPC finishes before submit.
    controller.gw
      .request<{ placeholder?: string; path?: string }>('paste.collapse', { text: pasted })
      .then(result => {
        if (!result.placeholder && !result.path) return
        const pathLabel = result.placeholder || `[[ Pasted #${localId}: ${pasted.length} chars, ${lineCount} lines → ${result.path} ]]`
        pasteSnipsRef.current = pasteSnipsRef.current.map(s =>
          s.inputLabel === fallbackLabel ? { ...s, displayLabel: pathLabel, path: result.path } : s,
        )
      })
      .catch(() => {})

    return fallbackLabel
  }

  function expandSnips(text: string): string {
    if (pasteSnipsRef.current.length === 0) return text
    let out = text
    for (const snip of pasteSnipsRef.current) {
      // Replace ONLY occurrences that survived editing — if the user deleted
      // the token before submitting, the real text stays out too.
      out = out.split(snip.inputLabel).join(snip.text)
    }
    return out
  }

  function displaySnips(text: string): string {
    if (pasteSnipsRef.current.length === 0) return text
    let out = text
    for (const snip of pasteSnipsRef.current) {
      out = out.split(snip.inputLabel).join(snip.displayLabel)
    }
    return out
  }

  function resetPasteSnips() {
    pasteSnipsRef.current = []
    pasteCounterRef.current = 0
  }

  /**
   * Path completion callback for the TextInput @-mode.
   *
   * Splits the user's prefix into a directory part and a name part,
   * resolves the directory to an absolute path (using DRSAI_USER_CWD
   * so relative paths map to the user's real cwd, not the ui-tui
   * package dir), and calls the ``complete.path`` RPC.
   *
   * Returns items whose ``text`` is relative to the resolved directory,
   * so the TextInput can build the full path as ``dirPart + candidate.text``.
   */
  async function completePath(prefix: string): Promise<Array<{
    text: string; display: string; meta: string
  }>> {
    const baseCwd = process.env.DRSAI_USER_CWD?.trim() || process.cwd()

    // Split "src/app" → dir="src/", name="app"
    // Split "src/"   → dir="src/", name=""
    // Split "app"    → dir="",     name="app"
    let dir = ''
    let name = prefix
    const lastSlash = prefix.lastIndexOf('/')
    if (lastSlash >= 0) {
      dir = prefix.substring(0, lastSlash + 1)
      name = prefix.substring(lastSlash + 1)
    }

    // Resolve the directory part to an absolute path
    const absCwd = dir ? resolveFilePath(dir) : baseCwd

    try {
      const result = await controller.gw.request<{
        items: Array<{ text: string; display: string; meta: string }>
      }>('complete.path', { prefix: name, cwd: absCwd })
      return result.items || []
    } catch {
      return []
    }
  }

  async function handleSubmit(text: string) {
    // Fix 4.4: Prevent concurrent requests
    if (isProcessingRef.current) {
      showSlashOutput('Please wait for current request to complete', 2000)
      return
    }
    
    const expanded = expandSnips(text)
    const displayText = displaySnips(text)
    resetPasteSnips()
    const trimmed = expanded.trim()

    // ── Input validation (Health Check fixes) ────────────────────────
    // Fix 4.1: Empty input validation
    if (!trimmed) {
      showSlashOutput('Please enter a message', 2000)
      return
    }
    
    // Fix 4.3: Input length limit (prevent API errors and performance issues)
    const MAX_INPUT_LENGTH = 100000 // ~100KB
    if (trimmed.length > MAX_INPUT_LENGTH) {
      showSlashOutput(
        `Input too long (${trimmed.length.toLocaleString()} chars). Max: ${MAX_INPUT_LENGTH.toLocaleString()}`,
        4000
      )
      return
    }

    // ── Detect /image command ────────────────────────────────────────
    const imageCmd = parseImageCommand(trimmed)
    if (imageCmd) {
      const images: ImageAttachment[] = []
      const imgErrors: string[] = []
      for (const p of imageCmd.paths) {
        if (images.length + imgErrors.length >= MAX_IMAGES_PER_MSG) {
          imgErrors.push(`Too many images (max ${MAX_IMAGES_PER_MSG})`)
          break
        }
        const result = readImageFile(p)
        if ('error' in result) {
          imgErrors.push(result.error)
        } else {
          images.push(result)
        }
      }
      if (imgErrors.length > 0) {
        showSlashOutput(`⚠ Image errors:\n  ${imgErrors.join('\n  ')}`, 5000)
      }
      if (images.length === 0) return
      const desc = imageCmd.description || images.map(i => basename(i.path)).join(', ')
      await controller.submit({
        sessionId,
        text: desc,
        images,
      })
      return
    }

    // ── /help — show available commands and shortcuts ──────────────────
    // Fix 5.3: Improve feature discoverability
    if (/^\/help(?:\s|$)/i.test(trimmed)) {
      const helpText = `
╔══════════════════════════════════════════════════════════════════╗
║                    DrSai TUI - Quick Help                        ║
╚══════════════════════════════════════════════════════════════════╝

📋 Slash Commands:
  /help           - Show this help
  /list [--all]   - List sessions (current workdir or all)
  /new [name]     - Create new session
  /switch         - Switch to another session
  /model          - Change AI model
  /skills         - Open skills manager
  /image <path>   - Attach image(s)
  /search <query> - Search sessions by content
  /export         - Export current session
  /gfs            - Open GFS config panel (edit credentials, toggle on/off)

⌨️  Keyboard Shortcuts:
  Ctrl+P / Ctrl+N - Previous / next command history
  ↑/↓             - Move cursor between lines (multi-line input)
  Ctrl+T          - Toggle tool details (compact/expanded)
  Ctrl+Y          - Toggle copy mode (mouse selection)
  Ctrl+C (2x)     - Exit TUI
  Ctrl+D          - Exit TUI
  Tab             - Autocomplete slash commands
  @ <path>        - Insert file/directory path (Tab/↑↓ navigate)

🖱️  Mouse:
  Scroll wheel    - Native terminal scrollback
  Drag select     - In copy mode (Ctrl+Y) to copy text

💡 Tips:
  • Type @ to browse files — images (@/path/to.png) are sent as multimodal
  • Completed turns flow into terminal scrollback (scroll natively)
  • Token usage shown in status bar
  • History loads automatically on restart
  • Use /export to save full conversation

For more info: https://note.ihep.ac.cn/s/Sc5E2Bw1b
`
      showSlashOutput(helpText) // No timer — full-screen takeover until user dismisses
      return
    }

    // ── /skills — open the skills manager pane ────────────────────────
    if (/^\/skills?(?:\s|$)/i.test(trimmed)) {
      setShowSkillsPane(true)
      return
    }

    // ── /daemons or /dm (no args) — open daemon panel ────────────────
    if (/^\/(?:daemons|dm)$/i.test(trimmed)) {
      setDaemonPanelOpen(true)
      return
    }

    // ── /agent (no args) — open agent picker ─────────────────────────
    if (/^\/agent$/i.test(trimmed)) {
      setAgentPickerOpen(true)
      return
    }

    // ── /schedule (no args) — open scheduler panel ──────────────────
    if (/^\/schedule$/i.test(trimmed)) {
      setSchedulerPanelOpen(true)
      return
    }

    // ── /wechat (no args) — open wechat panel ───────────────────────
    if (/^\/wechat$/i.test(trimmed)) {
      setWechatPanelOpen(true)
      return
    }

    // ── /gfs — open GFS config panel ───────────────────────────────
    if (/^\/gfs(?:\s|$)/i.test(trimmed)) {
      setGfsPanelOpen(true)
      return
    }

    // ── /remote — open SSH remote connection panel ──────────────────
    if (/^\/remote$/i.test(trimmed)) {
      setRemotePanelOpen(true)
      return
    }

    // ── /image or /img without valid paths ──────────────────────────
    // parseImageCommand() returns null when the regex matches but no image
    // paths were found, OR when the input is just "/image" with no args.
    // Intercept here so we show a friendly message instead of falling
    // through to slash.exec (which would return a 4040 error).
    if (/^\/(?:image|img)(?:\s|$)/i.test(trimmed)) {
      showSlashOutput(
        '⚠  Usage: /image <path1> [path2...] [description]\n' +
        '       /img  <path1> [path2...] [description]\n\n' +
        'Each path must have a supported image extension\n' +
        '(.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg).\n\n' +
        'Examples:\n' +
        '  /image /tmp/photo.png\n' +
        '  /image ./a.png ./b.jpg describe these\n' +
        '  /img ~/photo.png what is this?',
        6000,
      )
      return
    }

    // Detect slash command
    // Only treat input as a slash command if the first token matches a
    // known command from the catalog. This prevents pasted paths like
    // /tmp/file.txt from being misinterpreted as slash commands.
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const command = parts[0]
      const args = parts.slice(1).join(' ')

      // Check if this is a known command. If completions are loaded and
      // the command is not in the catalog, treat the input as plain text.
      if (completions.length > 0 && !completions.includes('/' + command.toLowerCase())) {
        // Not a known slash command — fall through to normal message submission
      } else {
        // Special case: /quit should exit
        if (command === 'quit' || command === 'exit' || command === 'q') {
          controller.gw.kill()
          exit()
          return
        }

        // /find without args: open empty smart search
        if (command === 'find' && !args) {
          setSmartSearch({ query: '', results: [] })
          return
        }

        // Interactive pickers (when called with no args)
        if ((command === 'list' || command === 'ls' || command === 'switch') && !args) {
          await openSessionPicker()
          return
        }
        if ((command === 'model' || command === 'm') && !args) {
          await openModelPicker()
          return
        }

        // Execute via slash.exec RPC
        try {
          const result = await controller.gw.request('slash.exec', {
            session_id: sessionId,
            command,
            args,
          }) as { output?: string; ui_action?: string; name?: string; target?: string; n?: number }
          const output = result.output || '(no output)'

          // Handle UI actions returned by handlers
          switch (result.ui_action) {
          case 'session.new': {
            try {
              const created = await controller.gw.request<{
                session_id: string
                session: SessionInfo
                user_id: string
              }>('session.create', {
                name: result.name || undefined,
              })
              showSlashOutput(`New session created: ${created.session.name} — switching…`, 3000)
              // Switch UI to the freshly created session.
              await switchSession(created.session_id)
            } catch (err) {
              showSlashOutput(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`, 5000)
            }
            return
          }
          case 'session.list':
          case 'session.switch': {
            // If user provided a target prefix, try direct resume
            if (result.target) {
              try {
                await switchSession(result.target)
                showSlashOutput(`Switched to: ${result.target}`, 3000)
              } catch (err) {
                showSlashOutput(`Switch failed: ${err instanceof Error ? err.message : String(err)}`, 5000)
              }
              return
            }
            // Otherwise pop the picker with optional workdir filter
            const workdirFilter = (result as any).workdir_filter !== undefined 
              ? (result as any).workdir_filter 
              : undefined
            await openSessionPicker(workdirFilter)
            return
          }
          case 'session.smart_search': {
            const searchResult = result as { results?: Array<{ session_id: string; name: string; preview: string; relevance_score: number; match_snippet?: string }>; query?: string }
            if (searchResult.results && searchResult.results.length > 0) {
              setSmartSearch({
                query: searchResult.query || '',
                results: searchResult.results,
              })
            } else {
              // No results — show the readable output from the handler
              showSlashOutput(output || `No sessions match '${searchResult.query || ''}'`)
            }
            return
          }
          case 'clear': {
            // Clear is handled by terminal scrollback; just hide message
            setSlashOutput(null)
            return
          }
          case 'reasoning.show':
            $showReasoning.set(true)
            break
          case 'reasoning.hide':
          case 'reasoning.off':
            $showReasoning.set(false)
            break
          case 'model.add': {
            const presetAlias = (result as { alias?: string }).alias
            setModelEditor({
              isNew: true,
              initial: presetAlias ? { model: presetAlias } : undefined,
            })
            return
          }
          case 'model.edit': {
            const presetAlias = (result as { alias?: string }).alias
            if (presetAlias) {
              await openModelEditor(presetAlias)
            } else {
              await pickModelToEdit()
            }
            return
          }
          case 'model.rm': {
            const presetAlias = (result as { alias?: string }).alias
            if (presetAlias) {
              await deleteModelWithConfirm(presetAlias)
            }
            return
          }
          case 'daemon.panel': {
            setDaemonPanelOpen(true)
            return
          }
          case 'remote.panel': {
            setRemotePanelOpen(true)
            return
          }
          case 'agent.picker': {
            setAgentPickerOpen(true)
            return
          }
          case 'wechat.panel': {
            setWechatPanelOpen(true)
            return
          }
          case 'wechat.login': {
            setWechatPanelOpen(true)
            return
          }
          case 'setup.wizard': {
            // Show config text (if any) before opening the wizard overlay.
            // The wizard will render on top; when dismissed, the slash
            // output overlay still holds the config text for reference.
            if (output) showSlashOutput(output, 0)
            setSetupScreenOpen(true)
            return
          }
        }

        // Keep informational slash-command output visible until the user dismisses it.
        showSlashOutput(output)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          showSlashOutput(`Error: ${msg}`, 5000)
        }
        return
      }
    }

    // Regular prompt
    // Regular prompt — detect @/path inline image references
    const { cleanText, images, errors: imgErrors } = extractInlineImages(trimmed)
    if (imgErrors.length > 0) {
      showSlashOutput(`⚠ Image errors:\n  ${imgErrors.join('\n  ')}`, 5000)
    }
    
    // Fix 4.4: Set processing lock
    isProcessingRef.current = true
    try {
      await controller.submit({
        sessionId,
        text: cleanText.trim(),
        displayText: displayText.trim(),
        images: images.length > 0 ? images : undefined,
      })
    } finally {
      // Always release lock, even if submit fails
      isProcessingRef.current = false
    }
  }

  // Skills manager overlay
  if (showSkillsPane) {
    return (
      <SkillsPane
        gw={controller.gw}
        sessionId={sessionId}
        onDismiss={() => setShowSkillsPane(false)}
      />
    )
  }

  // Daemon panel overlay
  if (daemonPanelOpen) {
    return (
      <DaemonPanel
        gw={controller.gw}
        onDismiss={() => setDaemonPanelOpen(false)}
      />
    )
  }

  // Agent picker overlay
  if (agentPickerOpen) {
    return (
      <AgentPicker
        gw={controller.gw}
        onSelect={async (agentType) => {
          try {
            if (agentType) {
              await controller.gw.request('slash.exec', { session_id: sessionId, command: 'agent', args: agentType })
              showSlashOutput(`Default subagent set to: ${agentType}`, 3000)
            } else {
              await controller.gw.request('slash.exec', { session_id: sessionId, command: 'agent', args: 'clear' })
              showSlashOutput('Default subagent cleared', 3000)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`Error: ${msg}`, 5000)
          }
          setAgentPickerOpen(false)
        }}
        onDismiss={() => setAgentPickerOpen(false)}
      />
    )
  }

  // Scheduler panel overlay
  if (schedulerPanelOpen) {
    return (
      <SchedulerPanel
        gw={controller.gw}
        sessionId={sessionId}
        onDismiss={() => setSchedulerPanelOpen(false)}
      />
    )
  }

  // WeChat panel overlay
  if (wechatPanelOpen) {
    return (
      <WeChatPanel
        gw={controller.gw}
        onDismiss={() => setWechatPanelOpen(false)}
      />
    )
  }

  // GFS config panel overlay
  if (gfsPanelOpen) {
    return (
      <GfsPanel
        gw={controller.gw}
        onDismiss={() => setGfsPanelOpen(false)}
      />
    )
  }

  // Setup wizard overlay (mid-session reconfiguration via /setup wizard)
  if (setupScreenOpen) {
    return (
      <SetupScreen
        gw={controller.gw}
        configExists={true}
        onComplete={() => setSetupScreenOpen(false)}
        onDismiss={() => setSetupScreenOpen(false)}
      />
    )
  }

  // SSH remote panel overlay
  if (remotePanelOpen) {
    return (
      <SshRemotePanel
        gw={controller.gw}
        onDismiss={() => setRemotePanelOpen(false)}
        onRemoteConnect={async (result) => {
          // Switch gateway client to WebSocket attach mode, then resolve
          // a session from the REMOTE gateway so the UI reflects the remote
          // workspace — not stale local state.
          try {
            await controller.gw.switchToWebSocket(result.ws_attach_url)
            $remoteHost.set(result.remote_hostname || '')

            // Clear local session state — the remote gateway has its own
            // session database; we must not show local chat history.
            $transcript.set([])
            $current.set(null)
            $sessionMeta.set(null)
            $memoryPreview.set('')
            $lastUsage.set(null)

            // Resolve session: most_recent for remote cwd → create new
            const recent = await controller.gw.request<{
              session: SessionInfo | null
              user_id?: string
            }>('session.most_recent', {})
            if (recent.user_id) $userId.set(recent.user_id)

            let sid: string | null = recent.session?.session_id ?? null
            if (!sid) {
              const created = await controller.gw.request<SessionCreateResult>('session.create', {})
              sid = created.session?.session_id ?? null
              if (created.user_id) $userId.set(created.user_id)
            }

            if (sid) {
              await switchSession(sid)
            }

            showSlashOutput(
              `✅ Connected to ${result.remote_hostname} via SSH tunnel` +
              (result.remote_cwd ? `\n   Remote workdir: ${result.remote_cwd}` : ''),
              4000,
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`❌ Failed to attach to remote gateway: ${msg}`, 5000)
          }
        }}
        onRemoteDisconnect={async () => {
          // Switch back to local subprocess mode and resolve a local session.
          try {
            await controller.gw.switchToSubprocess()
            $remoteHost.set('')

            // Clear remote session state
            $transcript.set([])
            $current.set(null)
            $sessionMeta.set(null)
            $memoryPreview.set('')
            $lastUsage.set(null)

            // Resolve local session (same flow as startup)
            const recent = await controller.gw.request<{
              session: SessionInfo | null
              user_id?: string
            }>('session.most_recent', {})
            if (recent.user_id) $userId.set(recent.user_id)

            let sid: string | null = recent.session?.session_id ?? null
            if (!sid) {
              const created = await controller.gw.request<SessionCreateResult>('session.create', {})
              sid = created.session?.session_id ?? null
              if (created.user_id) $userId.set(created.user_id)
            }

            if (sid) {
              await switchSession(sid)
            }

            showSlashOutput('✅ Switched back to local gateway', 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`⚠ Local gateway restart: ${msg}`, 5000)
          }
        }}
      />
    )
  }

  // Session picker overlay
  if (sessionPicker) {
    return (
      <SessionPicker
        sessions={sessionPicker}
        currentId={sessionId}
        enableFilter={true}
        groupByWorkdir={true}
        currentWorkdir={process.env.DRSAI_USER_CWD}
        gw={controller.gw}
        onSessionsChanged={async () => {
          // Refresh the session list in-place
          try {
            const result = await controller.gw.request<SessionListResult>('session.list', { limit: 50 })
            let sessions = result.sessions || []
            const currentWorkdir = process.env.DRSAI_USER_CWD?.trim() || process.cwd()
            sessions = sessions.filter(s => s.workdir === currentWorkdir)
            sessions.sort((a, b) => {
              return sessionSortTimestamp(b) - sessionSortTimestamp(a)
            })
            setSessionPicker(sessions)
          } catch { /* ignore refresh errors */ }
        }}
        onSelect={async sid => {
          setSessionPicker(null)
          try {
            await switchSession(sid)
            showSlashOutput(`Switched to session ${sid.slice(0, 8)}`, 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`Switch failed: ${msg}`, 5000)
          }
        }}
        onCancel={() => setSessionPicker(null)}
      />
    )
  }

  // Smart search overlay
  if (smartSearch) {
    return (
      <SmartSearchPane
        query={smartSearch.query}
        results={smartSearch.results}
        onSelect={async (sid) => {
          setSmartSearch(null)
          await switchSession(sid)
        }}
        onCancel={() => setSmartSearch(null)}
        onSearch={async (query) => {
          try {
            const result = await controller.gw.request<{
              sessions: SessionInfo[]
              total: number
            }>('session.smart_search', { query, limit: 10 })
            const results = (result.sessions || []).map(s => ({
              session_id: s.session_id,
              name: s.name,
              preview: s.preview,
              relevance_score: s.relevance_score || 0,
              match_snippet: s.match_snippet || '',
            }))
            setSmartSearch({ query, results })
          } catch (err) {
            // Show error as a result entry so the user knows what happened
            const errMsg = err instanceof Error ? err.message : String(err)
            setSmartSearch({ query, results: [] })
            showSlashOutput(`Search error: ${errMsg}`, 5000)
          }
        }}
      />
    )
  }

  // Quick switch overlay
  if (quickSwitch) {
    return (
      <QuickSwitchPanel
        sessions={quickSwitch}
        currentId={sessionId}
        currentWorkdir={process.env.DRSAI_USER_CWD}
        onSelect={async (sid) => {
          setQuickSwitch(null)
          if (sid !== sessionId) {
            await switchSession(sid)
          }
        }}
        onCancel={() => setQuickSwitch(null)}
      />
    )
  }

  // Model editor overlay (must come BEFORE the picker so a-from-picker
  // transition shows the editor immediately without an interim render).
  if (modelEditor) {
    return (
      <ModelEditor
        isNew={modelEditor.isNew}
        originalAlias={modelEditor.originalAlias}
        initial={modelEditor.initial}
        presets={modelProviderPresets}
        onCancel={() => setModelEditor(null)}
        onTest={async values => {
          try {
            const result = await controller.gw.request<{ ok: boolean; error?: string; guidance?: { title?: string; actions?: string[] } }>(
              'model.config.test_draft',
              { ...values },
            )
            return result.ok ? { ok: true } : { ok: false, error: result.guidance ? `${result.guidance.title}: ${(result.guidance.actions || []).join(' / ')}` : result.error }
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }}
        onSubmit={async values => {
          try {
            const result = await controller.gw.request<{
              ok: boolean
              model: string
              model_provider: string
              runtime_applied?: boolean
              warning?: string
            }>('model.config.save', { ...values, session_id: sessionId, expected_revision: modelEditor.revision })
            setModelEditor(null)
            showSlashOutput(
              result.runtime_applied === false
                ? (result.warning || `Saved ${result.model}, but the current session kept its previous model`)
                : `Saved ${result.model} via ${result.model_provider}`,
              5000,
            )
            return { ok: true }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { ok: false, error: msg }
          }
        }}
      />
    )
  }

  // Model picker overlay
  if (modelPicker) {
    return (
      <ModelPicker
        models={modelPicker.models}
        currentAlias={modelPicker.currentAlias}
        onSelect={async alias => {
          setModelPicker(null)
          try {
            await controller.gw.request('slash.exec', {
              session_id: sessionId,
              command: 'model',
              args: alias,
            })
            showSlashOutput(`Switched to model: ${alias}`, 3000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            showSlashOutput(`Switch failed: ${msg}`, 5000)
          }
        }}
        onAdd={() => {
          setModelPicker(null)
          setModelEditor({ isNew: true })
        }}
        onEdit={async alias => {
          setModelPicker(null)
          await openModelEditor(alias)
        }}
        onDelete={async alias => {
          setModelPicker(null)
          await deleteModelWithConfirm(alias)
        }}
        onCancel={() => setModelPicker(null)}
      />
    )
  }

  if (slashOutput && !slashOutputTimerRef.current) {
    return <SlashOutputOverlay output={slashOutput} onDismiss={dismissSlashOutput} />
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border}>{'─'.repeat(dividerWidth)}</Text>
      </Box>
      {slashOutput && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.muted}>{slashOutput}</Text>
        </Box>
      )}
      {/*
        Always mount the TextInput, even while streaming. This:
          1. Keeps useInput continuously consuming stdin so terminals
             cannot echo "ghost" characters that the user typed at the
             tail end of the previous turn (P1-02).
          2. Avoids unmount/remount churn that adds an extra Ink frame
             flush right after message.complete.
        While streaming we set disabled=true: keypresses are dropped,
        the cursor renders as a steady dim block (so users see *where*
        they will type next), and the placeholder switches to a status
        message. Ctrl+C is handled by the higher-level useInput above.

        Dynamic input box (P0 input crash fix):
          maxRows  — caps the visible input height at 40% of terminal
                     rows (max 15, min 5). When exceeded, a scroll
                     window centred on the cursor is shown instead.
          cols     — terminal column count, used for soft-wrapping long
                     lines so they don't overflow horizontally. Wrapping
                     is display-width-aware (CJK = 2 cells, emoji = 2
                     cells) via the stringWidth module.
          onHeightChange — reports the rendered input height to the
                     $composerInputHeight atom so StreamingAssistant
                     can shrink its content budget dynamically.
      */}
      <TextInput
        prompt=" › "
        disabled={isStreaming}
        // When a modal overlay (approval / clarify / secret / sudo) is
        // showing, unhook this TextInput from stdin so the user's "1" /
        // "2" / Enter goes to the overlay only — not also into the
        // composer's value buffer. See $activeOverlay in uiStore.ts for
        // the rationale (Ink useInput is a broadcast, P1-05).
        isActive={activeOverlay === null}
        placeholder={isStreaming
          ? '⏳ streaming… (Ctrl+C to cancel)'
          : 'Send a message · @ files · / commands · Tab complete · Ctrl+O newline'}
        onSubmit={handleSubmit}
        completions={completions}
        history={historyRef.current}
        onHistoryChange={savePromptHistory}
        onPaste={maybeCollapsePaste}
        onCompletePath={completePath}
        maxRows={inputMaxRows}
        cols={cols}
        onHeightChange={handleInputHeightChange}
      />
      {/* Bottom divider — closes the input box visually so it reads
          as a bounded area rather than an open-ended strip. */}
      <Box>
        <Text color={theme.border}>{'─'.repeat(dividerWidth)}</Text>
      </Box>
    </Box>
  )
}
