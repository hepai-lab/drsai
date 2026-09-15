import { OaepRuntimeGatewayClient } from '../oaepRuntimeGatewayClient.js'
import type { GatewayEvent } from '../gatewayTypes.js'

const client = new OaepRuntimeGatewayClient('unused-in-translation-test.json')
const observed: GatewayEvent[] = []
const unsubscribe = client.onAny(event => observed.push(event))
const translate = (client as unknown as { translate(event: Record<string, unknown>): void }).translate.bind(client)
const base = {
  event_id: 'event-1', session_id: 'session-1', run_id: 'run-1', sequence: 1,
}

translate({
  ...base, type: 'event.item.delta', item_id: 'message-1',
  data: { delta: { kind: 'message.text.append', text: 'hello' } },
})
translate({
  ...base, sequence: 2, type: 'event.item.created', item_id: 'tool-1',
  data: { item: { id: 'tool-1', run_id: 'run-1', type: 'tool_call', status: 'pending', content: {
    tool_name: 'read', arguments: { path: 'README.md' },
  } } },
})
translate({
  ...base, sequence: 3, type: 'event.item.created', item_id: 'approval-item',
  data: { item: { id: 'approval-item', run_id: 'run-1', type: 'interaction', status: 'waiting', content: {
    interaction_type: 'approval', approval_id: 'approval-1', operation: 'bash', prompt: 'Allow command?',
  } } },
})
translate({ ...base, sequence: 4, type: 'event.run.completed', data: {} })

const messageEvent = observed[0]
if (!messageEvent || !('payload' in messageEvent) || (messageEvent.payload as { text?: string }).text !== 'hello') {
  throw new Error('message delta was not translated')
}
if (observed[1].type !== 'tool.start') throw new Error('tool start was not translated')
const approvalEvent = observed[2]
if (!approvalEvent || !('payload' in approvalEvent) || (approvalEvent.payload as { request_id?: string }).request_id !== 'approval-1') {
  throw new Error('approval identity was not translated')
}
if (observed[3].type !== 'message.complete') throw new Error('authoritative Run terminal was not translated')
unsubscribe()
client.kill()

// Production request routing: the P2 slash command must load the current
// Session snapshot and bind every OWOP action to that exact Session.
const routed = new OaepRuntimeGatewayClient('unused-routing-test.json')
Object.assign(routed as unknown as Record<string, unknown>, { baseUrl: 'http://127.0.0.1:9999', token: 'x'.repeat(32) })
const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(input), init })
  if (String(input).includes('/oaep-snapshot')) return new Response(JSON.stringify({
    session: { id: 'session:1' }, items: [{ id: 'item-1', associations: [{
      association_id: 'assoc-1',
      resource: { protocol: 'owop/1', authority_id: 'runtime-1', workspace_id: 'workspace-1', resource_type: 'file', resource_id: 'file-1', generation: 1 },
      relation: 'input_reference', label_snapshot: 'safe.txt', presentation: 'inline',
    }], content: { parts: [{ part_id: 'part-1', type: 'resource', association_id: 'assoc-1' }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return new Response(JSON.stringify({ ok: true, result: { results: [{ descriptor: {
    state: 'available', display_name: 'safe.txt',
    current_version: { version_id: 'version-1', size: 1, digest: `sha256:${'a'.repeat(64)}`, mime_type: 'text/plain' },
    capabilities: { read_current: true, read_snapshot: false, preview: true, download: true, reveal: false, open_external: false, copy_logical_path: false },
  } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  const result = await routed.request<{ output: string }>('slash.exec', {
    session_id: 'session:1', command: 'resource', args: 'info assoc-1',
  })
  if (!result.output.includes('safe.txt')) throw new Error('P2 slash command was not routed')
  const owop = requests.find(request => request.url.endsWith('/v1/owop'))
  if (!owop || new Headers(owop.init?.headers).get('X-OpenDrSai-Session-ID') !== 'session:1') {
    throw new Error('OWOP action lost its exact Session binding')
  }
} finally {
  globalThis.fetch = originalFetch
  routed.kill()
}

console.log('TUI OAEP Runtime event translation passed.')
