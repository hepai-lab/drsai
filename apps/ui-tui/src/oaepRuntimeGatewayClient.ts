/** OAEP Agent Runtime adapter for the existing TUI event model. */

import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { GatewayClient } from './gatewayClient.js'
import type { GatewayEvent, SessionInfo } from './gatewayTypes.js'
import { executeOaepResourceCommand } from './oaepResourceCommands.js'

interface Registration {
  schema_version: number
  runtime_id: string
  endpoint: { base_url: string; bearer_token_file: string }
  protocols: { control: { version: string }; oaep: { version: string; profiles: string[]; schema_sha256: string } }
}

interface OaepItem {
  id: string
  run_id: string
  type: string
  status: string
  content: Record<string, unknown>
}

interface OaepEvent {
  event_id: string
  session_id: string
  run_id?: string
  item_id?: string
  sequence: number
  type: string
  data: { item?: OaepItem; delta?: { kind?: string; text?: string }; error?: { message?: string } }
}

interface OaepSnapshot {
  session: { id: string; title?: string; created_at: string; updated_at: string }
  items: OaepItem[]
  snapshot_sequence: number
}

const OAEP_PROFILE = 'oaep.session-stream/1'

export class OaepRuntimeGatewayClient extends GatewayClient {
  private baseUrl = ''
  private token = ''
  private runtimeId = ''
  private adapterReadyPromise: Promise<void>
  private resolveAdapterReady!: () => void
  private rejectAdapterReady!: (reason: Error) => void
  private stopped = false
  private session: SessionInfo | null = null
  private runBySession = new Map<string, string>()
  private approvalRun = new Map<string, string>()
  private streamAbort = new Map<string, AbortController>()
  private adapterLogs: string[] = []

  constructor(private readonly registrationPath: string) {
    super()
    this.adapterReadyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.resolveAdapterReady = resolveReady
      this.rejectAdapterReady = rejectReady
    })
  }

  override start(): void {
    void this.initialize().catch(error => {
      const value = error instanceof Error ? error : new Error(String(error))
      this.rejectAdapterReady(value)
      this.adapterPublish({ type: 'gateway.protocol_error', payload: { preview: value.message } })
    })
  }

  override ready_(): Promise<void> {
    return this.adapterReadyPromise
  }

  override getLogs(): string[] {
    return [...this.adapterLogs]
  }

  override kill(): void {
    if (this.stopped) return
    this.stopped = true
    for (const controller of this.streamAbort.values()) controller.abort()
    this.streamAbort.clear()
    this.adapterPublish({ type: 'gateway.exit', payload: { code: 0, reason: 'OAEP Runtime client stopped' } })
  }

  override async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.baseUrl) throw new Error('OAEP Runtime adapter is not ready')
    switch (method) {
      case 'session.most_recent':
        return { session: this.session, user_id: 'oaep-runtime' } as T
      case 'session.list':
        return { sessions: this.session ? [this.session] : [], user_id: 'oaep-runtime' } as T
      case 'session.create': {
        const value = await this.json<{ session: { id: string; created_at: string; updated_at: string; title?: string } }>(
          '/v1/sessions', 'POST', { idempotency_key: `tui-session-${randomUUID()}` },
        )
        this.session = this.sessionInfo(value.session)
        return { session_id: this.session.session_id, session: this.session, user_id: 'oaep-runtime' } as T
      }
      case 'session.resume': {
        const sessionId = this.id(String(params.session_id || ''))
        const value = await this.json<{ snapshot: OaepSnapshot }>(`/v1/sessions/${sessionId}/resume`, 'POST', {})
        this.session = this.sessionInfo(value.snapshot.session)
        this.adapterPublish({ type: 'session.info', session_id: sessionId, payload: this.sessionMetadata(sessionId) })
        this.adapterPublish({ type: 'session.restored', session_id: sessionId })
        return {
          session: this.session,
          history: this.history(value.snapshot.items),
          info: this.sessionMetadata(sessionId),
          user_id: 'oaep-runtime',
        } as T
      }
      case 'session.archive': {
        const sessionId = this.id(String(params.session_id || ''))
        await this.json(`/v1/sessions/${sessionId}/archive`, 'POST', {
          idempotency_key: `tui-archive-${sessionId}-${String(params.archived ?? true)}`,
        })
        return { ok: true } as T
      }
      case 'prompt.submit': {
        const sessionId = this.id(String(params.session_id || ''))
        const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: String(params.text || '') }]
        if (Array.isArray(params.images)) {
          for (const image of params.images) blocks.push({ type: 'image', ...(image as Record<string, unknown>) })
        }
        const receipt = await this.json<{ run_id: string }>(`/v1/sessions/${sessionId}/runs`, 'POST', {
          idempotency_key: `tui-run-${randomUUID()}`, content_blocks: blocks,
        })
        this.runBySession.set(sessionId, receipt.run_id)
        this.adapterPublish({ type: 'message.start', session_id: sessionId, payload: { role: 'assistant' } })
        this.follow(sessionId, receipt.run_id, 0)
        return { status: 'streaming', run_id: receipt.run_id } as T
      }
      case 'prompt.cancel': {
        const sessionId = String(params.session_id || '')
        const runId = this.runBySession.get(sessionId)
        if (runId) await this.json(`/v1/runs/${this.id(runId)}/cancel`, 'POST', {})
        return { accepted: Boolean(runId) } as T
      }
      case 'approval.respond': {
        const approvalId = String(params.request_id || params.approval_id || '')
        const runId = this.approvalRun.get(approvalId)
        if (!runId) throw new Error('OAEP approval has no active Run binding')
        const raw = String(params.choice || params.outcome || '')
        const outcome = raw === 'approve' || raw === 'allow' ? 'allowed-once' : raw === 'deny' ? 'rejected' : raw
        return await this.json(`/v1/runs/${this.id(runId)}/approvals/${this.id(approvalId)}/decision`, 'POST', { outcome }) as T
      }
      case 'slash.exec': {
        const sessionId = String(params.session_id || '')
        const encodedSessionId = this.id(sessionId)
        const command = String(params.command || '').toLowerCase()
        if (command !== 'resource' && command !== 'artifact') throw new Error(`OAEP Runtime mode does not provide /${command}`)
        return await executeOaepResourceCommand({
          loadSnapshot: async () => this.json(`/v1/sessions/${encodedSessionId}/oaep-snapshot?limit=500`, 'GET'),
          executeOwop: async (boundSessionId, workspaceId, operation, operationParams) => this.json(
            '/v1/owop', 'POST', {
              version: '1.0', request_id: randomUUID(), correlation_id: randomUUID(),
              workspace_id: workspaceId, operation, params: operationParams,
              binding: { kind: 'local_ipc' },
            }, boundSessionId,
          ),
        }, sessionId, String(params.args || ''), command === 'artifact' ? 'artifact' : 'file') as T
      }
      case 'gateway.shutdown':
        this.kill()
        return { status: 'stopped' } as T
      default:
        throw new Error(`OAEP Runtime mode does not provide TUI method ${method}`)
    }
  }

  private async initialize(): Promise<void> {
    const manifestReal = await realpath(resolve(this.registrationPath))
    const root = dirname(manifestReal)
    const registration = JSON.parse(await readFile(manifestReal, 'utf8')) as Registration
    if (registration.schema_version !== 1 || registration.protocols.control.version !== '1'
      || registration.protocols.oaep.version !== '1.0'
      || !registration.protocols.oaep.profiles.includes(OAEP_PROFILE)) {
      throw new Error('OAEP Runtime registration protocol is incompatible')
    }
    const endpoint = new URL(registration.endpoint.base_url)
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(endpoint.hostname)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('OAEP Runtime endpoint must be loopback HTTP')
    }
    const tokenReal = await realpath(resolve(registration.endpoint.bearer_token_file))
    const tokenRelative = relative(root, tokenReal)
    if (tokenRelative.startsWith('..') || tokenRelative === '' || tokenRelative.startsWith('/') || tokenRelative.startsWith('\\')) {
      throw new Error('OAEP Runtime token must be a separate file inside the registration directory')
    }
    this.token = (await readFile(tokenReal, 'utf8')).trim()
    if (this.token.length < 32 || /\s/.test(this.token)) throw new Error('OAEP Runtime token is invalid')
    this.baseUrl = endpoint.origin
    this.runtimeId = registration.runtime_id
    const initialized = await this.json<{ availability: string; capabilities: string[] }>(
      '/v1/runtime/initialize', 'POST', { protocols: registration.protocols },
    )
    if (initialized.availability !== 'production' || !initialized.capabilities.includes('run.start')) {
      throw new Error('OAEP Runtime is not production-ready')
    }
    this.resolveAdapterReady()
    this.adapterPublish({
      type: 'gateway.ready',
      payload: { setup: { setup_required: false, config_exists: true }, skin: { branding: { agent: 'DeepSeek Harness' } } },
    })
  }

  private follow(sessionId: string, runId: string, cursor: number): void {
    this.streamAbort.get(sessionId)?.abort()
    const controller = new AbortController()
    this.streamAbort.set(sessionId, controller)
    void (async () => {
      let after = cursor
      try {
        while (!controller.signal.aborted) {
          const response = await this.fetch(
            `/v1/sessions/${sessionId}/oaep-events/stream?after_sequence=${after}&limit=200&wait_seconds=25`,
            'GET', undefined, controller.signal,
          )
          const text = await response.text()
          for (const frame of text.replace(/\r\n/g, '\n').split('\n\n')) {
            const data = frame.split('\n').filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            const event = JSON.parse(data) as OaepEvent
            if (event.sequence <= after) continue
            after = event.sequence
            if (event.run_id === runId) this.translate(event)
            if (event.run_id === runId && ['event.run.completed', 'event.run.failed', 'event.run.cancelled'].includes(event.type)) {
              this.streamAbort.delete(sessionId)
              return
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error)
          this.adapterLogs.push(message)
          this.adapterPublish({ type: 'error', session_id: sessionId, payload: { message } })
        }
      }
    })()
  }

  private translate(event: OaepEvent): void {
    const item = event.data.item
    if (event.type === 'event.item.delta' && event.data.delta?.kind === 'message.text.append') {
      this.adapterPublish({ type: 'message.delta', session_id: event.session_id, payload: { text: event.data.delta.text || '' } })
    } else if (event.type === 'event.item.created' && item?.type === 'tool_call') {
      this.adapterPublish({ type: 'tool.start', session_id: event.session_id, payload: {
        tool_id: item.id, name: String(item.content.tool_name || 'tool'),
        args: this.object(item.content.arguments), preview: String(item.content.tool_name || 'tool'),
      } })
    } else if (event.type === 'event.item.completed' && item?.type === 'tool_call') {
      this.adapterPublish({ type: 'tool.complete', session_id: event.session_id, payload: {
        tool_id: item.id, name: String(item.content.tool_name || 'tool'),
        args: this.object(item.content.arguments), result: String(item.content.result || ''), duration_ms: 0,
      } })
    } else if (event.type === 'event.item.created' && item?.type === 'interaction'
      && item.content.interaction_type === 'approval') {
      const approvalId = String(item.content.approval_id || '')
      if (approvalId && event.run_id) this.approvalRun.set(approvalId, event.run_id)
      this.adapterPublish({ type: 'approval.request', session_id: event.session_id, payload: {
        request_id: approvalId,
        command: String(item.content.operation || 'DeepSeek Harness tool'),
        description: String(item.content.prompt || 'Approval required'),
        choices: ['allowed-once', 'rejected', 'cancelled'],
      } })
    } else if (event.type === 'event.run.completed') {
      this.adapterPublish({ type: 'message.complete', session_id: event.session_id, payload: {
        text: '', status: 'complete', usage: this.emptyUsage('complete'),
      } })
    } else if (event.type === 'event.run.cancelled') {
      this.adapterPublish({ type: 'message.complete', session_id: event.session_id, payload: {
        text: '', status: 'interrupted', usage: this.emptyUsage('interrupted'),
      } })
    } else if (event.type === 'event.run.failed') {
      this.adapterPublish({ type: 'error', session_id: event.session_id, payload: {
        message: event.data.error?.message || 'DeepSeek Harness Run failed',
      } })
    }
  }

  private async json<T>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>, sessionId?: string): Promise<T> {
    const response = await this.fetch(path, method, body, undefined, sessionId)
    return response.json() as Promise<T>
  }

  private async fetch(
    path: string, method: 'GET' | 'POST', body?: Record<string, unknown>, signal?: AbortSignal, sessionId?: string,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method, headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionId ? { 'X-OpenDrSai-Session-ID': sessionId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}), signal,
    })
    if (response.ok) return response
    let message = `OAEP Runtime HTTP ${response.status}`
    try {
      const value = await response.json() as { error?: { message?: string } }
      message = value.error?.message || message
    } catch { /* bounded generic error */ }
    throw new Error(message)
  }

  private adapterPublish(event: GatewayEvent): void {
    this.emit('event', event)
    this.emit(event.type, event)
  }

  private sessionInfo(value: { id: string; title?: string; created_at: string; updated_at: string }): SessionInfo {
    return {
      session_id: value.id, name: value.title || 'DeepSeek Harness', created_at: value.created_at,
      updated_at: value.updated_at, message_count: 0, preview: '', workdir: process.cwd(),
    }
  }

  private sessionMetadata(sessionId: string) {
    return {
      session_id: sessionId, user_id: 'oaep-runtime', workdir: process.cwd(), model: 'deepseek-harness',
      plan_mode: false, workspace_enabled: true, tools: [], default_subagent: '',
    }
  }

  private history(items: OaepItem[]): Array<Record<string, unknown>> {
    return items.filter(item => item.type === 'message' && item.status === 'completed').map(item => ({
      role: item.content.role, content: item.content.text || '', timestamp: Date.now(),
    }))
  }

  private emptyUsage(status: string) {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, model: 'deepseek-harness', status }
  }

  private object(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    if (typeof value === 'string') {
      try {
        const decoded = JSON.parse(value) as unknown
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return decoded as Record<string, unknown>
      } catch { /* keep opaque */ }
    }
    return { value }
  }

  private id(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new Error('OAEP Runtime resource id is invalid')
    return encodeURIComponent(value)
  }
}

export function createTuiGatewayClient(): GatewayClient {
  const registration = process.env.OPENDRSAI_TUI_AGENT_RUNTIME_REGISTRATION?.trim()
  return registration ? new OaepRuntimeGatewayClient(registration) : new GatewayClient()
}
