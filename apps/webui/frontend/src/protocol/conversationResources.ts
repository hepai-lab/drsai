import {
  projectOaepConversationResources,
  type ConversationResourceProjection,
} from "../../../../../cores/protocol/oaep/conversationResourceProjection";

export interface WebConversationResource {
  associationId: string;
  label: string;
  relation: string;
  state: "unresolved";
}

/**
 * Web/DocMaster consumes the shared OAEP projector and only adds Host UI
 * presentation. It does not traverse raw Resource maps or infer authority.
 */
export function projectWebConversationResources(snapshot: unknown): {
  canonical: ConversationResourceProjection;
  resources: WebConversationResource[];
} {
  const canonical = projectOaepConversationResources(snapshot);
  return {
    canonical,
    resources: canonical.associations.map((association) => ({
      associationId: association.association_id,
      label: association.label_snapshot,
      relation: association.relation,
      state: "unresolved",
    })),
  };
}
