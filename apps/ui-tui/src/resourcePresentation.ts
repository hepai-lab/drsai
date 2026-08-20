import type { OaepResourceRef } from './gatewayTypes.js'
import {
  projectOaepConversationResources,
  type ConversationResourceAssociation,
} from '../../../cores/protocol/oaep/conversationResourceProjection.js'

export function resourceCommand(ref: OaepResourceRef, artifactId?: string): string {
  return ref.resource_type === 'file'
    ? `/resource ${ref.resource_id}`
    : `/artifact ${artifactId || ref.resource_id}`
}

export interface TuiConversationResource {
  itemId: string
  associationId?: string
  label: string
  relation?: OaepResourceRef['relation']
  command: string
  ref: OaepResourceRef
  association?: ConversationResourceAssociation
}

/** Project standard OAEP references without Desktop/Electron path assumptions. */
export function projectConversationResources(snapshot: unknown): TuiConversationResource[] {
  const p2 = projectOaepConversationResources(snapshot)
  if (p2.associations.length > 0) return p2.associations.map((association) => ({
    itemId: p2.itemByAssociation[association.association_id] || '',
    associationId: association.association_id,
    label: association.label_snapshot,
    relation: association.relation,
    command: `/resource info ${association.association_id}`,
    association,
    ref: {
      protocol: 'owop/1',
      workspace_id: association.resource.workspace_id,
      resource_type: association.resource.resource_type,
      resource_id: association.resource.resource_id,
      label: association.label_snapshot,
      relation: association.relation,
      presentation: association.presentation,
      ...(association.operation_id ? { operation_id: association.operation_id } : {}),
    },
  }))
  const items = (snapshot as { items?: unknown[] })?.items
  if (!Array.isArray(items)) throw new Error('oaep_snapshot_items_invalid')
  const projected: TuiConversationResource[] = []
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as { id?: unknown; content?: Record<string, unknown> }
    const refs: Array<{ raw: unknown; label?: unknown; artifactId?: string }> = []
    const parts = item.content?.parts
    if (Array.isArray(parts)) parts.forEach((part) => {
      if (part && typeof part === 'object') refs.push({
        raw: (part as Record<string, unknown>).resource_ref,
        label: (part as Record<string, unknown>).name,
      })
    })
    const changes = item.content?.changes
    if (Array.isArray(changes)) changes.forEach((change) => {
      if (change && typeof change === 'object') refs.push({ raw: (change as Record<string, unknown>).resource_ref })
    })
    const contentRefs = item.content?.resource_refs
    if (Array.isArray(contentRefs)) contentRefs.forEach((ref) => refs.push({
      raw: ref,
      artifactId: typeof item.content?.artifact_id === 'string' ? item.content.artifact_id : undefined,
    }))
    for (const candidate of refs) {
      if (!candidate.raw || typeof candidate.raw !== 'object') continue
      const ref = candidate.raw as OaepResourceRef
      if (ref.protocol !== 'owop/1' || !ref.workspace_id || !ref.resource_id) continue
      projected.push({
        itemId: String(item.id || ''),
        label: String(candidate.label || ref.label || ref.resource_id),
        relation: ref.relation,
        command: resourceCommand(ref, candidate.artifactId),
        ref,
      })
    }
  }
  return projected
}
