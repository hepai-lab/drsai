import type { OaepItem } from "../api/oaep.generated";
import type { RuntimeClient } from "./runtimeClient";

export interface OaepArtifactMetadataRequest {
  workspaceId: string;
  operation: "artifact.metadata";
  params: { artifact_id: string };
}

/** Resolve an OAEP Artifact only through its authorized OWOP resource reference. */
export function oaepArtifactMetadataRequest(item: OaepItem): OaepArtifactMetadataRequest {
  if (item.type !== "artifact") throw new Error("oaep_artifact_item_required");
  const reference = item.content.resource_refs?.find((candidate) =>
    candidate.protocol === "owop/1"
    && candidate.resource_type === "artifact"
    && candidate.resource_id === item.content.artifact_id,
  );
  if (!reference) throw new Error("oaep_artifact_resource_ref_required");
  return {
    workspaceId: reference.workspace_id,
    operation: "artifact.metadata",
    params: { artifact_id: reference.resource_id },
  };
}

export async function readOaepArtifactMetadata(
  client: Pick<RuntimeClient, "executeOWOP">,
  item: OaepItem,
): Promise<Record<string, unknown>> {
  const request = oaepArtifactMetadataRequest(item);
  return client.executeOWOP(request.workspaceId, request.operation, request.params);
}
