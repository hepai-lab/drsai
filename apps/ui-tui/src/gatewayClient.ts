/**
 * GatewayClient — JSON-RPC bridge to the Python tui_gateway subprocess.
 *
 * Phase 0-3 features:
 *   - Spawns ``python -m drsai.backend.tui_gateway`` (stdio mode)
 *   - OR connects to existing gateway via WebSocket (attach mode)
 *   - Reads newline-delimited JSON frames from stdout or WebSocket
 *   - Routes responses to pending request promises (by id)
 *   - Emits events via EventEmitter
 *
 * Attach mode (Phase 3): set DRSAI_TUI_ATTACH_URL=ws://127.0.0.1:port/attach
 * to connect to an existing gateway instead of spawning a new one.
 *
 * Forked from hermes-agent/ui-tui/src/gatewayClient.ts.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { delimiter, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import WebSocket from 'ws'

import type { GatewayEvent, JsonRpcResponse } from './gatewayTypes.js'

const STARTUP_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.DRSAI_TUI_STARTUP_TIMEOUT_MS ?? '15000', 10) || 15000,
)
const REQUEST_TIMEOUT_MS = Math.max(
  10000,
  parseInt(process.env.DRSAI_TUI_RPC_TIMEOUT_MS ?? '120000', 10) || 120000,
)

interface PendingRequest {
  id: string
  method: string
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const resolvePython = (): string => {
  const explicit = process.env.DRSAI_PYTHON?.trim() || process.env.PYTHON?.trim()
  if (explicit) return explicit
  const venv = process.env.VIRTUAL_ENV?.trim()
  if (venv) {
    const candidate = process.platform === 'win32'
      ? resolve(venv, 'Scripts/python.exe')
      : resolve(venv, 'bin/python')
    return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

const resolvePythonSrcRoot = (): string => {
  // DRSAI_PYTHON_SRC_ROOT lets advanced users / dev shells override the
  // PYTHONPATH; default points at the in-tree drsai package src/.
  const explicit = process.env.DRSAI_PYTHON_SRC_ROOT?.trim()
  if (explicit) return explicit
  // Default: ../../cores/python/packages/drsai/src/ relative to this file (apps/ui-tui/src/)
  return resolve(import.meta.dirname, '../../cores/python/packages/drsai/src')
}

export class GatewayClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private ws: WebSocket | null = null
  private mode: 'stdio' | 'websocket' = 'stdio'
  private reqId = 0
  private pending = new Map<string, PendingRequest>()
  private ready = false
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (err: Error) => void
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private logs: string[] = []

  constructor() {
    super()
    this.setMaxListeners(0)
    this.readyPromise = new Promise<void>((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
  }

  /** Type-safe event subscription. ``on('message.delta', fn)`` infers payload type. */
  onEvent<T extends GatewayEvent['type']>(
    type: T,
    handler: (ev: Extract<GatewayEvent, { type: T }>) => void,
  ): () => void {
    const wrapper = (ev: GatewayEvent) => handler(ev as Extract<GatewayEvent, { type: T }>)
    this.on(type, wrapper)
    return () => this.off(type, wrapper)
  }

  /** Subscribe to *all* events (debugging / global routers). */
  onAny(handler: (ev: GatewayEvent) => void): () => void {
    this.on('event', handler)
    return () => this.off('event', handler)
  }

  /** Start the gateway (subprocess or WebSocket). Returns immediately; await ``ready()`` to block. */
  start(): void {
    // Detect attach mode via environment variable
    const attachUrl = process.env.DRSAI_TUI_ATTACH_URL?.trim()
    if (attachUrl) {
      this.mode = 'websocket'
      this.startWebSocket(attachUrl)
    } else {
      this.mode = 'stdio'
      this.startSubprocess()
    }
  }

  private startSubprocess(): void {
    if (this.proc) return

    const python = resolvePython()
    const root = resolvePythonSrcRoot()
    const env = { ...process.env }
    const existingPath = env.PYTHONPATH?.trim()
    env.PYTHONPATH = existingPath ? `${root}${delimiter}${existingPath}` : root
    // Force UTF-8 on the Python subprocess regardless of OS / locale.
    // On Windows (cp936 / cp1252) the gateway's stdout would otherwise be
    // encoded with the system code page and mangle Chinese in JSON frames.
    // PYTHONIOENCODING covers Python 3 stdio; PYTHONUTF8=1 enables the
    // "UTF-8 mode" introduced in 3.7 which also affects file-path handling.
    env.PYTHONIOENCODING = 'utf-8'
    env.PYTHONUTF8 = '1'

    this.readyTimer = setTimeout(() => {
      if (!this.ready) {
        const msg = `gateway startup timed out after ${STARTUP_TIMEOUT_MS}ms`
        this.publish({ type: 'gateway.protocol_error', payload: { preview: msg } })
        this.rejectReady(new Error(msg))
      }
    }, STARTUP_TIMEOUT_MS)
    this.readyTimer.unref?.()

    // The user's "real" working directory comes from DRSAI_USER_CWD if the
    // ``drsai`` launcher set it (the launcher chdirs us into apps/ui-tui/ so node
    // can resolve modules; the gateway must NOT see apps/ui-tui/ as cwd).
    // Fall back to process.cwd() for ``pnpm dev`` invocations.
    const gatewayCwd = process.env.DRSAI_USER_CWD?.trim() || process.cwd()

    this.proc = spawn(python, ['-m', 'drsai.backend.tui_gateway'], {
      cwd: gatewayCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Force UTF-8 decoding on the subprocess's stdout/stderr so multi-byte
    // characters (CJK in JSON frames, etc.) survive intact regardless of OS.
    this.proc.stdout!.setEncoding('utf8')
    this.proc.stderr!.setEncoding('utf8')

    const stdoutRl = createInterface({ input: this.proc.stdout! })
    stdoutRl.on('line', raw => {
      try {
        this.dispatch(JSON.parse(raw))
      } catch {
        const preview = raw.trim().slice(0, 240) || '(empty line)'
        this.pushLog(`[protocol] malformed stdout: ${preview}`)
        this.publish({ type: 'gateway.protocol_error', payload: { preview } })
      }
    })

    const stderrRl = createInterface({ input: this.proc.stderr! })
    stderrRl.on('line', raw => {
      const line = raw.trim()
      if (!line) return
      this.pushLog(line)
      this.publish({ type: 'gateway.stderr', payload: { line } })
    })

    this.proc.on('error', err => {
      this.pushLog(`[spawn] ${err.message}`)
      this.publish({ type: 'gateway.stderr', payload: { line: `[spawn] ${err.message}` } })
      this.handleExit(1, `gateway spawn error: ${err.message}`)
    })

    this.proc.on('exit', code => {
      this.handleExit(code)
    })
  }

  private startWebSocket(url: string): void {
    if (this.ws) return

    this.readyTimer = setTimeout(() => {
      if (!this.ready) {
        const msg = `WebSocket connection timed out after ${STARTUP_TIMEOUT_MS}ms`
        this.publish({ type: 'gateway.protocol_error', payload: { preview: msg } })
        this.rejectReady(new Error(msg))
      }
    }, STARTUP_TIMEOUT_MS)
    this.readyTimer.unref?.()

    this.pushLog(`[ws] connecting to ${url}`)
    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      this.pushLog('[ws] connected')
    })

    this.ws.on('message', data => {
      const raw = data.toString().trim()
      if (!raw) return
      try {
        this.dispatch(JSON.parse(raw))
      } catch {
        const preview = raw.slice(0, 240) || '(empty line)'
        this.pushLog(`[ws] malformed frame: ${preview}`)
        this.publish({ type: 'gateway.protocol_error', payload: { preview } })
      }
    })

    this.ws.on('error', err => {
      this.pushLog(`[ws] error: ${err.message}`)
      this.publish({ type: 'gateway.stderr', payload: { line: `[ws] ${err.message}` } })
    })

    this.ws.on('close', () => {
      this.pushLog('[ws] connection closed')
      this.handleExit(0, 'WebSocket closed')
    })
  }

  /** Promise that resolves once ``gateway.ready`` arrives. */
  ready_(): Promise<void> {
    return this.readyPromise
  }

  /** Send a JSON-RPC request. Returns a promise that resolves with ``result``. */
  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    // Check if gateway is available
    if (this.mode === 'stdio') {
      if (!this.proc?.stdin || this.proc.killed || this.proc.exitCode !== null) {
        return Promise.reject(new Error('gateway not running'))
      }
    } else if (this.mode === 'websocket') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('WebSocket not connected'))
      }
    }

    const id = `r${++this.reqId}`
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          reject(new Error(`RPC ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`))
        }
      }, REQUEST_TIMEOUT_MS)
      timeout.unref?.()

      this.pending.set(id, {
        id,
        method,
        resolve: v => resolve(v as T),
        reject,
        timeout,
      })

      try {
        const frame = JSON.stringify({ id, jsonrpc: '2.0', method, params }) + '\n'
        if (this.mode === 'stdio') {
          this.proc!.stdin!.write(frame)
        } else {
          this.ws!.send(frame)
        }
      } catch (e) {
        const pending = this.pending.get(id)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pending.delete(id)
        }
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Get recent stderr lines (debugging). */
  getLogs(): string[] {
    return [...this.logs]
  }

  /** Kill the gateway subprocess or close WebSocket connection. */
  kill(): void {
    if (this.mode === 'stdio') {
      if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
        this.proc.kill('SIGTERM')
      }
    } else if (this.mode === 'websocket') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private dispatch(frame: unknown): void {
    if (!frame || typeof frame !== 'object') return
    const f = frame as Record<string, unknown>

    // Event push (no id, method === 'event')
    if (f.method === 'event') {
      const params = f.params as { type?: string; session_id?: string; payload?: unknown }
      if (params?.type) {
        const ev = {
          type: params.type,
          payload: params.payload,
          session_id: params.session_id,
        } as GatewayEvent
        this.publish(ev)
      }
      return
    }

    // RPC response (has id)
    if (typeof f.id === 'string' && this.pending.has(f.id)) {
      const pending = this.pending.get(f.id)!
      this.pending.delete(f.id)
      clearTimeout(pending.timeout)
      const resp = frame as JsonRpcResponse
      if ('error' in resp && resp.error) {
        pending.reject(new Error(`RPC ${pending.method}: [${resp.error.code}] ${resp.error.message}`))
      } else if ('result' in resp) {
        pending.resolve(resp.result)
      } else {
        pending.reject(new Error(`RPC ${pending.method}: malformed response`))
      }
    }
  }

  private publish(ev: GatewayEvent): void {
    if (ev.type === 'gateway.ready' && !this.ready) {
      this.ready = true
      if (this.readyTimer) {
        clearTimeout(this.readyTimer)
        this.readyTimer = null
      }
      this.resolveReady()
    }
    this.emit('event', ev)
    this.emit(ev.type, ev)
  }

  private pushLog(line: string): void {
    this.logs.push(line)
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200)
  }

  private handleExit(code: number | null, reason?: string): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    if (!this.ready) {
      this.rejectReady(new Error(reason || `gateway exited (code=${code}) before ready`))
    }
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason || `gateway exited (code=${code})`))
      this.pending.delete(id)
    }
    this.proc = null
    this.publish({ type: 'gateway.exit', payload: { code, reason } })
  }
}
