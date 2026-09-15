/**
 * OpenDrSai OAEP extension for the audited DeepSeek Harness 0.1.0-rc.5 tree.
 *
 * This is a Cordis edge plugin: it uses public DSH services and events without
 * changing the agent loop.  Keep it version-pinned; a new DSH release gets a
 * new sibling directory and compatibility profile.
 */
import { resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'

export const name = 'opendrsai-sdk-jsonrpc-server'
export const inject = ['agents']
export const Config = Schema.object({})

const METHODS = [
  'initialize', 'session/prompt', 'session/cancel', 'session/history',
  'session/resume', 'runtime/attestation', 'shutdown',
]
const NOTIFICATIONS = [
  'session.event', 'session.status', 'subagent.started', 'subagent.finished',
]
const CAPABILITIES = [
  'approval.respond', 'run.cancel', 'run.terminal', 'run.turn-binding',
  'session.history', 'session.resume', 'tool.side-effect-ledger',
  'workspace.containment',
]

function requireString(params, name) {
  const value = params?.[name]
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  return value
}

export function apply(ctx, config = {}) {
  const input = config.input ?? process.stdin
  const output = config.output ?? process.stdout
  const exit = config.exit ?? (code => process.exit(code))
  const transport = new JsonRpcLineTransport(input, output)
  const rootFiber = ctx.root.fiber
  const sessions = new Map()
  const creating = new Map()
  const claimed = new Map()
  const pendingTurnEvents = new Map()
  const approvalClaims = new Set()
  const disposers = []
  let cwd = process.cwd()
  let provider = 'deepseek-official'
  let model = 'deepseek-v4-flash'
  let maxTokens
  let llmFiber
  let closing = false
  let exitTask

  const recordForAgent = agent => {
    const record = sessions.get(String(agent.session.id))
    return record?.handle.agent === agent ? record : undefined
  }

  const getOrCreate = async sessionId => {
    const existing = sessions.get(sessionId)
    if (existing) return existing
    const pending = creating.get(sessionId)
    if (pending) return pending
    if (closing) throw new Error('SDK server is shutting down')
    const task = ctx.agents.create({
      sessionId: SessionId(sessionId), meta: { cwd },
      agentOptions: { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) },
    }).then(handle => {
      const record = { handle }
      sessions.set(sessionId, record)
      return record
    }).finally(() => creating.delete(sessionId))
    creating.set(sessionId, task)
    return task
  }

  const requireRecord = sessionId => {
    const record = sessions.get(sessionId)
    if (!record) throw new Error(`unknown session: ${sessionId}`)
    if (ctx.agents.get(record.handle.agent.id) !== record.handle.agent) throw new Error(`session agent is not live: ${sessionId}`)
    return record
  }

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    if (!recordForAgent(agent)) return
    const sessionId = String(agent.session.id)
    const key = `${sessionId}:${turn}`
    const messageId = String(message.id)
    claimed.set(key, messageId)
    const pending = pendingTurnEvents.get(sessionId)
    if (pending?.turn === turn) {
      pendingTurnEvents.delete(sessionId)
      for (const event of pending.events) {
        const projected = event.type === 'turn/start'
          ? { ...event, data: { ...event.data, messageId } }
          : event
        transport.notify('session.event', { sessionId, event: projected })
      }
    }
  }))
  disposers.push(ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    if (!sessions.has(sessionId)) return
    if (event.type === 'turn/start') {
      pendingTurnEvents.set(sessionId, { turn: event.data.turn, events: [event] })
      return
    }
    const pending = pendingTurnEvents.get(sessionId)
    if (pending) {
      pending.events.push(event)
      return
    }
    if (event.type === 'turn/end') claimed.delete(`${sessionId}:${event.data.turn}`)
    transport.notify('session.event', { sessionId, event })
  }))
  disposers.push(ctx.on('agent/status', ({ agent, status }) => {
    if (recordForAgent(agent)) transport.notify('session.status', { sessionId: String(agent.session.id), status })
  }))
  disposers.push(ctx.on('session/created', session => {
    if (session.header.parentSession !== undefined) transport.notify('subagent.started', {
      parentSessionId: String(session.header.parentSession), childSessionId: String(session.id),
    })
  }))

  // The approval service appends approval/asked before entering this waterfall.
  // Pair by call id exactly, mirroring DSH's own API proxy implementation.
  disposers.push(ctx.on('approval/request', (request, next) => {
    const record = recordForAgent(request.agent)
    if (!record || request.signal?.aborted) return request.signal?.aborted ? Promise.resolve('cancelled') : next()
    const decided = new Set()
    let approvalId
    for (let index = request.agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = request.agent.session.events[index]
      if (event.type === 'approval/decided') decided.add(String(event.data.id))
      if (event.type !== 'approval/asked') continue
      const id = String(event.data.id)
      if (decided.has(id) || approvalClaims.has(id)) continue
      if ((request.callId ?? null) !== (event.data.callId ?? null)) continue
      approvalId = id
      break
    }
    if (!approvalId) return next()
    approvalClaims.add(approvalId)
    const activeTurn = request.agent.session.events.findLast(event => event.type === 'turn/start')?.data.turn
    if (!Number.isSafeInteger(activeTurn) || activeTurn < 0) return next()
    return transport.request('approval/request', {
      sessionId: String(request.agent.session.id), approvalId,
      toolName: request.toolName,
      turn: activeTurn,
      ...(request.callId === undefined ? {} : { callId: request.callId }),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    }).then(result => {
      const outcome = result?.outcome
      if (!['allowed-once', 'allowed-session', 'rejected', 'cancelled'].includes(outcome)) {
        throw new Error('invalid approval response outcome')
      }
      return outcome
    }).finally(() => approvalClaims.delete(approvalId))
  }))

  const shutdown = async () => {
    if (closing) return {}
    closing = true
    await Promise.allSettled([...creating.values()])
    creating.clear()
    while (disposers.length) disposers.pop()?.()
    const handles = [...sessions.values()].map(record => record.handle)
    sessions.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
    if (llmFiber) await llmFiber.dispose()
    llmFiber = undefined
    return {}
  }

  transport.onRequest(async (method, params = {}) => {
    switch (method) {
      case 'initialize': {
        cwd = resolve(requireString(params, 'cwd'))
        provider = requireString(params, 'provider')
        model = requireString(params, 'model')
        if (params.maxTokens !== undefined && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens < 1)) {
          throw new TypeError('maxTokens must be a positive safe integer')
        }
        maxTokens = params.maxTokens
        if (!(ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false)) {
          if (provider !== 'deepseek-official') throw new Error(`no adapter registered for provider "${provider}"`)
          llmFiber = await ctx.plugin(LlmDeepSeek, {})
        }
        return {
          serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0-opendrsai.1' },
          protocol: { methods: METHODS, notifications: NOTIFICATIONS, capabilities: CAPABILITIES },
        }
      }
      case 'session/prompt': {
        const sessionId = requireString(params, 'sessionId')
        const record = await getOrCreate(sessionId)
        const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
        record.handle.agent.followup(message)
        return { messageId: String(message.id) }
      }
      case 'session/cancel': {
        const sessionId = requireString(params, 'sessionId')
        const messageId = requireString(params, 'messageId')
        const agent = requireRecord(sessionId).handle.agent
        if (agent.inbox.remove(messageId)) return { disposition: 'queued-cancelled' }
        const active = [...claimed.entries()].some(([key, id]) => key.startsWith(`${sessionId}:`) && id === messageId)
        if (!active) throw new Error(`message is neither active nor queued: ${messageId}`)
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        return { disposition: 'active-cancelling' }
      }
      case 'session/history': {
        const sessionId = requireString(params, 'sessionId')
        const fromSequence = params.fromSequence ?? 0
        if (!Number.isSafeInteger(fromSequence) || fromSequence < 0) throw new TypeError('fromSequence must be a non-negative safe integer')
        const live = sessions.get(sessionId)?.handle.agent.session
        if (live) return { meta: live.header, events: live.events.filter(event => event.seq >= fromSequence) }
        const persistence = ctx.get('sessionPersistence')
        if (!persistence) throw new Error('session persistence is not configured')
        return persistence.readFrom(SessionId(sessionId), fromSequence)
      }
      case 'session/resume': {
        const sessionId = requireString(params, 'sessionId')
        if (sessions.has(sessionId)) return { sessionId, disposition: 'already-live' }
        const handle = await ctx.agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions: { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) },
        })
        sessions.set(sessionId, { handle })
        return { sessionId, disposition: 'resumed' }
      }
      case 'runtime/attestation': {
        const sessionId = requireString(params, 'sessionId')
        const session = requireRecord(sessionId).handle.agent.session
        const policyService = ctx.get('sandboxPolicy')
        const sandbox = ctx.get('sandbox')
        if (!policyService || !sandbox) throw new Error('sandbox services are not configured')
        const policy = policyService.resolve({ session })
        if (policy.mode === 'danger-full-access') return { policy, enforcement: 'none', contained: false }
        const confined = sandbox.confine([process.execPath, '-e', 'process.exit(0)'], policy)
        return { policy, enforcement: confined.enforcement, contained: confined.enforcement === 'full' }
      }
      case 'shutdown': {
        const result = await shutdown()
        exitTask ??= new Promise(resolveTask => setImmediate(resolveTask)).then(async () => {
          await transport.flush(); await rootFiber.dispose(); exit(0)
        })
        return result
      }
      default: throw new Error(`unknown OpenDrSai DSH extension method: ${method}`)
    }
  })

  ctx.effect(() => {
    transport.start()
    return async () => { await shutdown(); transport.close() }
  }, 'opendrsai-jsonrpc.serve')
}
