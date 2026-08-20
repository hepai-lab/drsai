import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  executeOaepResourceCommand,
  type OaepResourceCommandHost,
} from '../oaepResourceCommands.js'

const content = Buffer.from('P2 TUI resource preview\n', 'utf8')
const sha = (data: Uint8Array) => `sha256:${createHash('sha256').update(data).digest('hex')}`
const key = {
  protocol: 'owop/1', authority_id: 'runtime-1', workspace_id: 'workspace-1',
  resource_type: 'file', resource_id: 'file-1', generation: 1,
}
const snapshot = {
  session: { id: 'session-1' },
  items: [{ id: 'item-1', associations: [{
    association_id: 'assoc-1', resource: key, relation: 'input_reference',
    label_snapshot: 'safe.txt', presentation: 'inline',
    version_snapshot: { version_id: 'version-1', digest: sha(content), size: content.length },
  }], content: { parts: [{ part_id: 'part-1', type: 'resource', association_id: 'assoc-1' }] } }],
}

function host(overrides: { state?: string; preview?: boolean; binary?: boolean; error?: string; corrupt?: boolean; displayName?: string } = {}) {
  const calls: Array<{ sessionId: string; workspaceId: string; operation: string; params: Record<string, unknown> }> = []
  const value: OaepResourceCommandHost = {
    async loadSnapshot(sessionId) {
      if (sessionId !== 'session-1') throw new Error('wrong session')
      return snapshot
    },
    async executeOwop(sessionId, workspaceId, operation, params) {
      calls.push({ sessionId, workspaceId, operation, params })
      if (overrides.error && operation === 'resources.resolve_batch') {
        return { ok: true, result: { results: [{ resource: key, error: { code: overrides.error, retryable: false } }] } }
      }
      if (operation === 'resources.resolve_batch') return { ok: true, result: { results: [{ resource: key, descriptor: {
        resource: key, state: overrides.state || 'available', display_name: overrides.displayName || 'safe.txt',
        logical_path: 'docs/safe.txt',
        current_version: { version_id: 'version-1', size: content.length, digest: sha(content), mime_type: overrides.binary ? 'application/octet-stream' : 'text/plain' },
        capabilities: {
          read_current: true, read_snapshot: true, preview: overrides.preview !== false,
          download: true, reveal: false, open_external: false, copy_logical_path: true,
        },
      } }] } }
      if (operation === 'resources.preview') return overrides.binary
        ? { ok: false, error: { code: 'preview_unsupported', retryable: false } }
        : { ok: true, result: { kind: 'text', version_id: 'version-1', content_base64: content.toString('base64') } }
      if (operation === 'resources.download.prepare') return { ok: true, result: {
        download_id: 'download-1', version_id: 'version-1', size: content.length, digest: sha(content),
        transport: 'owop_chunks', expires_at: '2030-01-01T00:00:00Z',
      } }
      if (operation === 'resources.download.chunk') {
        const bytes = overrides.corrupt ? Buffer.from('corrupt') : content
        return { ok: true, result: {
          download_id: 'download-1', content_base64: bytes.toString('base64'), offset: 0,
          length: bytes.length, eof: !overrides.corrupt, chunk_digest: sha(bytes),
        } }
      }
      if (operation === 'resources.download.cancel') return { ok: true, result: { cancelled: true } }
      throw new Error(`unexpected operation ${operation}`)
    },
  }
  return { value, calls }
}

const infoHost = host()
const info = await executeOaepResourceCommand(infoHost.value, 'session-1', 'info assoc-1')
if (!info.output.includes('safe.txt') || !info.output.includes('State: available')) throw new Error('info metadata missing')
if (info.output.includes('docs/safe.txt') || /server|host_handle/i.test(info.output)) throw new Error('info leaked a path')
if (infoHost.calls.some(call => call.sessionId !== 'session-1' || call.workspaceId !== 'workspace-1')) {
  throw new Error('resource command escaped its Session or Workspace binding')
}
const hostileLabel = await executeOaepResourceCommand(host({ displayName: '\u001b[31mreport\u202Ecod.exe' }).value, 'session-1', 'info assoc-1')
if (hostileLabel.output.includes('\u001b') || !hostileLabel.output.includes('\u2068') || !hostileLabel.output.includes('\u2069')) {
  throw new Error('TUI label was not control-sanitized and bidi-isolated')
}
if (/\u001b\[[0-9;]*m/.test(hostileLabel.output)) throw new Error('TUI emitted ANSI color from an untrusted label')

const opened = await executeOaepResourceCommand(host().value, 'session-1', 'open assoc-1')
if (opened.output !== content.toString('utf8')) throw new Error('safe text preview did not open')
const binary = await executeOaepResourceCommand(host({ binary: true }).value, 'session-1', 'open assoc-1')
if (!binary.output.includes('/resource download assoc-1 <destination>')) throw new Error('binary recovery command missing')
const offline = await executeOaepResourceCommand(host({ state: 'offline' }).value, 'session-1', 'open assoc-1')
if (!offline.output.includes('Reconnect or switch Runtime')) throw new Error('offline recovery missing')
const denied = await executeOaepResourceCommand(host({ error: 'resource_not_found' }).value, 'session-1', 'info assoc-1')
if (!denied.output.includes('switch Workspace') || denied.output.includes('safe.txt')) throw new Error('denied response leaked metadata')
const missing = await executeOaepResourceCommand(host().value, 'session-1', 'info assoc-other')
if (!missing.output.includes('not present in this Session')) throw new Error('cross-session association was not rejected')
const copied = await executeOaepResourceCommand(host().value, 'session-1', 'copy-path assoc-1')
if (copied.output !== 'docs/safe.txt') throw new Error('logical path command failed')
const legacy = await executeOaepResourceCommand(host().value, 'session-1', 'file-1', 'file')
if (!legacy.output.includes('Legacy ID resolved within the current Session') || !legacy.output.includes('/resource info assoc-1')) {
  throw new Error('session-bound legacy resource migration failed')
}

const directory = await mkdtemp(join(tmpdir(), 'opendrsai-tui-resource-'))
try {
  const target = join(directory, 'safe.txt')
  const successfulHost = host()
  const downloaded = await executeOaepResourceCommand(successfulHost.value, 'session-1', `download assoc-1 ${target}`)
  if (!downloaded.output.startsWith('Downloaded safe.txt') || !readFileSync(target).equals(content)) {
    throw new Error('verified download was not published')
  }
  if (successfulHost.calls.some(call => call.operation === 'resources.download.cancel')) {
    throw new Error('completed download was incorrectly cancelled')
  }
  await writeFile(target, 'existing', 'utf8')
  const existing = await executeOaepResourceCommand(host().value, 'session-1', `download assoc-1 ${target}`)
  if (!existing.output.includes('already exists') || (await readFile(target, 'utf8')) !== 'existing') {
    throw new Error('existing destination was modified')
  }
  const corruptTarget = join(directory, 'corrupt.txt')
  const corrupt = await executeOaepResourceCommand(host({ corrupt: true }).value, 'session-1', `download assoc-1 ${corruptTarget}`)
  if (!corrupt.output.includes('changed during') || existsSync(corruptTarget)) throw new Error('corrupt download became visible')
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log('TUI P2 association info/open/download/copy-path commands passed.')
