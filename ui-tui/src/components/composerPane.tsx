/**
 * ComposerPane — composer area with TextInput, hooked to TurnController.
 */

import { useStore } from '@nanostores/react'
import { Box, Text, useApp, useInput } from 'ink'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, isAbsolute, resolve, win32 } from 'node:path'
import { homedir } from 'node:os'
import { useEffect, useRef, useState } from 'react'

import { loadPromptHistory, savePromptHistory } from '../app/promptHistory.js'
import { $isStreaming } from '../app/turnStore.js'
import type { ImageAttachment, TurnController } from '../app/turnController.js'
import { $showReasoning } from '../app/uiStore.js'
import type { SessionInfo, SessionListResult } from '../gatewayTypes.js'
import { theme } from '../theme.js'

import { ModelEditor, type ModelEditorValues } from './modelEditor.js'
import { ModelPicker, type ModelEntry } from './modelPicker.js'
import { SessionPicker } from './sessionPicker.js'
import { SlashOutputOverlay } from './slashOutputOverlay.js'
import { TextInput } from './textInput.js'

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
  const [slashOutput, setSlashOutput] = useState<string | null>(null)
  const slashOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sessionPicker, setSessionPicker] = useState<SessionInfo[] | null>(null)
  const [modelPicker, setModelPicker] = useState<
    { models: ModelEntry[]; currentAlias?: string } | null
  >(null)
  const [modelEditor, setModelEditor] = useState<
    | {
        isNew: boolean
        originalAlias?: string
        initial?: Partial<ModelEditorValues>
      }
    | null
  >(null)
  const [completions, setCompletions] = useState<string[]>([])
  const [initialHistory] = useState(() => loadPromptHistory())
  const historyRef = useRef<string[]>(initialHistory)

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

  // While streaming, capture Ctrl+C to cancel without exiting the app.
  useInput((_input, key) => {
    if (isStreaming && key.ctrl && _input === 'c') {
      controller.cancel(sessionId)
    }
  })

  async function openSessionPicker() {
    try {
      const result = await controller.gw.request<SessionListResult>('session.list', { limit: 50 })
      setSessionPicker(result.sessions || [])
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
      setModelPicker({ models: result.models || [], currentAlias: result.current })
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
    // Fetch the current entry to pre-fill the form.
    try {
      const result = await controller.gw.request<{
        alias: string
        model: string
        token_limit: number
        max_tokens: number
        client_type: 'auto' | 'openai' | 'anthropic'
        reasoning: { supported: boolean; effort_levels: string[]; param_type: string }
      }>('model.get', { alias })
      setModelEditor({
        isNew: false,
        originalAlias: alias,
        initial: {
          alias: result.alias,
          model: result.model,
          token_limit: result.token_limit,
          max_tokens: result.max_tokens,
          client_type: result.client_type,
          reasoning: {
            supported: result.reasoning.supported,
            effort_levels: result.reasoning.effort_levels,
            // Cast: backend has already validated against the enum.
            param_type: result.reasoning.param_type as ModelEditorValues['reasoning']['param_type'],
          },
        },
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
    // Single-step delete with explicit confirm in the toast.
    try {
      const result = await controller.gw.request<{ ok: boolean; fell_back_to: string | null }>(
        'model.delete',
        { alias, session_id: sessionId },
      )
      if (result.ok) {
        const tail = result.fell_back_to ? ` (now on ${result.fell_back_to})` : ''
        showSlashOutput(`Deleted ${alias}${tail}`, 4000)
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

  async function handleSubmit(text: string) {
    const expanded = expandSnips(text)
    const displayText = displaySnips(text)
    resetPasteSnips()
    const trimmed = expanded.trim()

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
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const command = parts[0]
      const args = parts.slice(1).join(' ')

      // Special case: /quit should exit
      if (command === 'quit' || command === 'exit' || command === 'q') {
        controller.gw.kill()
        exit()
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
            // Otherwise pop the picker
            await openSessionPicker()
            return
          }
          case 'copy.reply': {
            // Future: read $transcript, emit OSC 52
            showSlashOutput('Clipboard copy not yet wired (OSC 52 pending).', 5000)
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
              initial: presetAlias ? { alias: presetAlias } : undefined,
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
        }

        // Keep informational slash-command output visible until the user dismisses it.
        showSlashOutput(output)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        showSlashOutput(`Error: ${msg}`, 5000)
      }
      return
    }

    // Regular prompt
    // Regular prompt — detect @/path inline image references
    const { cleanText, images, errors: imgErrors } = extractInlineImages(trimmed)
    if (imgErrors.length > 0) {
      showSlashOutput(`⚠ Image errors:\n  ${imgErrors.join('\n  ')}`, 5000)
    }
    await controller.submit({
      sessionId,
      text: cleanText.trim(),
      displayText: displayText.trim(),
      images: images.length > 0 ? images : undefined,
    })
  }

  // Session picker overlay
  if (sessionPicker) {
    return (
      <SessionPicker
        sessions={sessionPicker}
        currentId={sessionId}
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

  // Model editor overlay (must come BEFORE the picker so a-from-picker
  // transition shows the editor immediately without an interim render).
  if (modelEditor) {
    return (
      <ModelEditor
        isNew={modelEditor.isNew}
        originalAlias={modelEditor.originalAlias}
        initial={modelEditor.initial}
        onCancel={() => setModelEditor(null)}
        onSubmit={async values => {
          try {
            const result = await controller.gw.request<{
              ok: boolean
              alias: string
              is_new: boolean
              switched_to: string | null
            }>('model.save', { ...values, session_id: sessionId })
            setModelEditor(null)
            const switched = result.switched_to ? ` (switched to ${result.switched_to})` : ''
            const verb = result.is_new ? 'Saved' : 'Updated'
            showSlashOutput(`${verb} model ${result.alias}${switched}`, 4000)
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
        <Text color={theme.border}>{'─'.repeat(60)}</Text>
      </Box>
      {slashOutput && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.muted}>{slashOutput}</Text>
        </Box>
      )}
      {isStreaming ? (
        <Box>
          <Text color={theme.warn}>⏳ </Text>
          <Text color={theme.muted}>streaming… (Ctrl+C to cancel)</Text>
        </Box>
      ) : (
        <TextInput
          prompt=" › "
          placeholder="type a message (Alt+Enter/Ctrl+O newline, / commands, Tab complete, ↑/↓ history)"
          onSubmit={handleSubmit}
          completions={completions}
          history={historyRef.current}
          onHistoryChange={savePromptHistory}
          onPaste={maybeCollapsePaste}
        />
      )}
    </Box>
  )
}
