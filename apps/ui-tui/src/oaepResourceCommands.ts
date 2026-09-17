import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import {
  projectOaepConversationResources,
  type ConversationResourceAssociation,
} from '../../../cores/protocol/oaep/conversationResourceProjection.js'

type JsonObject = Record<string, unknown>

interface OwopResult {
  ok: boolean
  result?: JsonObject
  error?: { code?: string; retryable?: boolean }
}

export interface OaepResourceCommandHost {
  loadSnapshot(sessionId: string): Promise<unknown>
  executeOwop(sessionId: string, workspaceId: string, operation: string, params: JsonObject): Promise<OwopResult>
}

interface Descriptor {
  state: string
  display_name: string
  logical_path?: string
  current_version: { version_id: string; size: number; digest: string; mime_type?: string }
  observed_version?: { version_id: string; size: number; digest: string; mime_type?: string }
  capabilities: Record<string, boolean>
}

const MAX_PREVIEW_BYTES = 1024 * 1024
const DOWNLOAD_CHUNK_BYTES = 1024 * 1024

function commandUsage(): string {
  return [
    'Usage:',
    '  /resource info <association_id>',
    '  /resource open <association_id>',
    '  /resource download <association_id> <destination>',
    '  /resource copy-path <association_id>',
  ].join('\n')
}

function safeError(code = 'unsupported', retryable = false): string {
  if (code === 'resource_not_found' || code === 'unauthorized') {
    return 'Resource is unavailable or you do not have access. Retry after reconnecting or switch Workspace.'
  }
  if (code === 'runtime_offline' || code === 'authority_offline') {
    return 'Runtime is offline. Reconnect or switch Runtime, then retry.'
  }
  if (code === 'resource_version_conflict' || code === 'integrity_mismatch') {
    return 'The resource changed during this action. Resolve it again, then retry.'
  }
  if (code === 'action_cancelled') return 'Resource action cancelled. You can retry safely.'
  return retryable
    ? 'Resource action failed temporarily. Retry after reconnecting.'
    : 'This resource action is not supported in the current TUI host.'
}

function decodeBase64Strict(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('integrity_mismatch')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw new Error('integrity_mismatch')
  return decoded
}

function digest(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/** Keep untrusted labels readable without allowing terminal control sequences
 * or mixed-direction text to escape into surrounding command/status text. */
function terminalLabel(value: string): string {
  const visible = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '\uFFFD')
  return `\u2068${visible}\u2069`
}

function findAssociation(snapshot: unknown, associationId: string): ConversationResourceAssociation | undefined {
  return projectOaepConversationResources(snapshot).associations
    .find(association => association.association_id === associationId)
}

async function resolveAssociation(
  host: OaepResourceCommandHost,
  sessionId: string,
  association: ConversationResourceAssociation,
  requestedAction: 'resolve' | 'copy_logical_path' = 'resolve',
): Promise<{ descriptor?: Descriptor; error?: string }> {
  const response = await host.executeOwop(sessionId, association.resource.workspace_id, 'resources.resolve_batch', {
    observations: [{
      association_id: association.association_id,
      resource: association.resource,
      requested_action: requestedAction,
      ...(association.version_snapshot?.version_id
        ? { observed_version_id: association.version_snapshot.version_id }
        : {}),
    }],
  })
  if (!response.ok) return { error: safeError(response.error?.code, response.error?.retryable) }
  const first = (response.result?.results as JsonObject[] | undefined)?.[0]
  if (!first || first.error) {
    const error = first?.error as { code?: string; retryable?: boolean } | undefined
    return { error: safeError(error?.code, error?.retryable) }
  }
  return { descriptor: first.descriptor as unknown as Descriptor }
}

function metadata(association: ConversationResourceAssociation, descriptor: Descriptor): string {
  const capabilities = Object.entries(descriptor.capabilities)
    .filter(([, enabled]) => enabled).map(([name]) => name).join(', ') || 'none'
  return [
    `Name: ${terminalLabel(descriptor.display_name || association.label_snapshot)}`,
    `Relation: ${association.relation}`,
    `State: ${descriptor.state}`,
    `Type: ${association.resource.resource_type}`,
    `MIME: ${descriptor.current_version.mime_type || 'unknown'}`,
    `Size: ${descriptor.current_version.size} bytes`,
    `Capabilities: ${capabilities}`,
  ].join('\n')
}

async function download(
  host: OaepResourceCommandHost,
  sessionId: string,
  association: ConversationResourceAssociation,
  descriptor: Descriptor,
  destination: string,
): Promise<string> {
  if (!descriptor.capabilities.download) return safeError('unsupported')
  const target = resolve(destination)
  await mkdir(dirname(target), { recursive: true })
  const temporary = resolve(dirname(target), `.${basename(target)}.part-${randomUUID()}`)
  let downloadId = ''
  let published = false
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    const prepared = await host.executeOwop(
      sessionId, association.resource.workspace_id, 'resources.download.prepare', {
        resource: association.resource,
        version_id: descriptor.current_version.version_id,
        suggested_name: basename(target),
      },
    )
    if (!prepared.ok) return safeError(prepared.error?.code, prepared.error?.retryable)
    downloadId = String(prepared.result?.download_id || '')
    const size = Number(prepared.result?.size)
    const expectedDigest = String(prepared.result?.digest || '')
    if (!downloadId || !Number.isSafeInteger(size) || size < 0 || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
      throw new Error('integrity_mismatch')
    }
    const whole = createHash('sha256')
    let offset = 0
    while (offset < size) {
      const response = await host.executeOwop(
        sessionId, association.resource.workspace_id, 'resources.download.chunk', {
          download_id: downloadId, offset, length: Math.min(DOWNLOAD_CHUNK_BYTES, size - offset),
        },
      )
      if (!response.ok) return safeError(response.error?.code, response.error?.retryable)
      const chunkOffset = Number(response.result?.offset)
      const chunkLength = Number(response.result?.length)
      const bytes = decodeBase64Strict(response.result?.content_base64)
      if (chunkOffset !== offset || chunkLength !== bytes.length || bytes.length === 0
        || digest(bytes) !== response.result?.chunk_digest
        || Boolean(response.result?.eof) !== (offset + bytes.length === size)) {
        throw new Error('integrity_mismatch')
      }
      let written = 0
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written, offset + written)
        if (result.bytesWritten <= 0) throw new Error('integrity_mismatch')
        written += result.bytesWritten
      }
      whole.update(bytes)
      offset += bytes.length
    }
    if (`sha256:${whole.digest('hex')}` !== expectedDigest) throw new Error('integrity_mismatch')
    await handle.sync()
    await handle.close()
    handle = undefined
    // An exclusive hard link is an atomic, no-overwrite publication in the
    // destination directory. It cannot damage a pre-existing destination.
    await link(temporary, target)
    await unlink(temporary)
    published = true
    return `Downloaded ${descriptor.display_name} to ${target}`
  } catch (error) {
    const code = error instanceof Error && error.message === 'integrity_mismatch'
      ? 'integrity_mismatch'
      : (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'destination_exists' : 'unsupported'
    return code === 'destination_exists'
      ? 'Destination already exists. Choose another path; the existing file was preserved.'
      : safeError(code, code === 'integrity_mismatch')
  } finally {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    if (downloadId && !published) {
      await host.executeOwop(
        sessionId, association.resource.workspace_id, 'resources.download.cancel', { download_id: downloadId },
      ).catch(() => undefined)
    }
  }
}

/** Execute a P2 TUI resource command using only the current Session association. */
export async function executeOaepResourceCommand(
  host: OaepResourceCommandHost,
  sessionId: string,
  rawArgs: string,
  legacyResourceType?: 'file' | 'artifact',
): Promise<{ output: string }> {
  const match = rawArgs.trim().match(/^(info|open|download|copy-path)\s+(\S+)(?:\s+([\s\S]+))?$/)
  const legacyId = legacyResourceType && /^\S+$/.test(rawArgs.trim()) ? rawArgs.trim() : ''
  if ((!match && !legacyId) || !sessionId) return { output: commandUsage() }
  const action = match?.[1] || 'info'
  let associationId = match?.[2] || ''
  const destination = match?.[3]
  if (action === 'download' && !destination?.trim()) return { output: commandUsage() }
  try {
    const snapshot = await host.loadSnapshot(sessionId)
    let association = findAssociation(snapshot, associationId)
    if (legacyId) {
      association = projectOaepConversationResources(snapshot).associations.find(candidate =>
        candidate.resource.resource_type === legacyResourceType && candidate.resource.resource_id === legacyId)
      associationId = association?.association_id || ''
    }
    if (!association) {
      return { output: 'Resource association is not present in this Session. Switch Session or retry after refresh.' }
    }
    const resolved = await resolveAssociation(
      host, sessionId, association,
      action === 'copy-path' ? 'copy_logical_path' : 'resolve',
    )
    if (!resolved.descriptor) return { output: resolved.error || safeError() }
    const descriptor = resolved.descriptor
    if (action === 'info') return { output: `${legacyId ? 'Legacy ID resolved within the current Session. Use /resource info ' + associationId + ' next time.\n' : ''}${metadata(association, descriptor)}` }
    if (action === 'copy-path') {
      return { output: descriptor.capabilities.copy_logical_path && descriptor.logical_path
        ? descriptor.logical_path
        : 'Logical path is unavailable. This host will not expose a server path.' }
    }
    if (action === 'download') return { output: await download(host, sessionId, association, descriptor, destination!.trim()) }
    if (descriptor.state === 'offline') return { output: safeError('runtime_offline', true) }
    if (!descriptor.capabilities.preview) {
      return { output: `${metadata(association, descriptor)}\n\nPreview is unavailable. Use /resource download ${associationId} <destination>.` }
    }
    const preview = await host.executeOwop(sessionId, association.resource.workspace_id, 'resources.preview', {
      resource: association.resource, version_id: descriptor.current_version.version_id,
      accept_kinds: ['text'], max_bytes: MAX_PREVIEW_BYTES,
    })
    if (!preview.ok) {
      return { output: `${metadata(association, descriptor)}\n\n${safeError(preview.error?.code, preview.error?.retryable)}\nUse /resource download ${associationId} <destination>.` }
    }
    if (preview.result?.kind !== 'text') {
      return { output: `${metadata(association, descriptor)}\n\nBinary preview is not printed in the terminal. Use /resource download ${associationId} <destination>.` }
    }
    return { output: decodeBase64Strict(preview.result.content_base64).toString('utf8') }
  } catch {
    return { output: 'Resource action failed safely. Reconnect or switch Workspace, then retry.' }
  }
}
