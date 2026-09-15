import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PACKAGED_RESOURCE_SESSION_ID = "session-packaged-resource-p2";
export const PACKAGED_RESOURCE_WORKSPACE_ID = "e2e-agent-run-workspace";
export const PACKAGED_RESOURCE_STATES = ["available", "moved", "changed", "deleted", "offline"];
export const PACKAGED_RESOURCE_REQUIRED_CHECKS = [
  "bridge", "workspaceRegistered", "semanticResourceButtonsClicked", "stateMatrix",
  "deletedFailClosed", "offlineDistinct", "previewThroughIpc", "revealThroughIpc",
  "copyLogicalPathThroughIpc", "observedVersionThroughIpc", "downloadThroughIpc",
  "progressThroughPreload",
];

export function writePackagedConversationResourceFixtures(targetWorkspace) {
  mkdirSync(join(targetWorkspace, "docs"), { recursive: true });
  writeFileSync(join(targetWorkspace, "docs", "available.md"), "# Packaged P2 resource\n", "utf8");
  writeFileSync(join(targetWorkspace, "docs", "moved.md"), "# Moved P2 resource\n", "utf8");
  writeFileSync(join(targetWorkspace, "docs", "changed.md"), "# Current P2 resource\n", "utf8");
}

export function packagedConversationResourceSnapshot() {
  const associations = PACKAGED_RESOURCE_STATES.map((state) => {
    const versionId = state === "changed" ? "version-observed-changed" : `version-current-${state}`;
    const bytes = resourceBytes(versionId);
    return {
      association_id: `assoc-${state}`, resource: resourceKey(state),
      relation: state === "available" ? "input_reference" : "citation_source",
      label_snapshot: `${state}.md`,
      version_snapshot: { version_id: versionId, digest: digest(bytes), size: bytes.length, mime_type: "text/markdown", captured_at: "2026-08-16T00:00:00Z" },
      presentation: "inline",
    };
  });
  return {
    version: "1.0",
    session: { id: PACKAGED_RESOURCE_SESSION_ID, workspace_id: PACKAGED_RESOURCE_WORKSPACE_ID, title: "Packaged P2 resource", status: "active", backend: "opendrsai", created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:02Z" },
    runs: [{ id: "run-packaged-resource-p2", session_id: PACKAGED_RESOURCE_SESSION_ID, sequence: 1, source: { backend: "opendrsai", mapping_version: "oaep-resource-association-p2/1" }, status: "completed", created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:02Z", completed_at: "2026-08-16T00:00:02Z" }],
    items: [{
      id: "message-packaged-resource-p2", session_id: PACKAGED_RESOURCE_SESSION_ID, run_id: "run-packaged-resource-p2",
      type: "message", status: "completed", sequence: 1, created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:00Z",
      source: { backend: "opendrsai", mapping_version: "oaep-resource-association-p2/1" }, associations,
      content: { role: "user", phase: "final", text: "Packaged P2 resources", citations: [], parts: associations.map((association, index) => ({ part_id: `part-${index + 1}`, type: "resource", association_id: association.association_id })) },
    }],
    mapping_version: "oaep-resource-association-p2/1", snapshot_sequence: 1,
  };
}

export function packagedConversationResourceOwopResult(body) {
  const operation = body?.operation;
  const params = body?.params || {};
  if (operation === "resources.resolve_batch") {
    const observation = params.observations?.[0] || {};
    const associationId = String(observation.association_id || "");
    const state = associationId.replace(/^assoc-/, "");
    if (!PACKAGED_RESOURCE_STATES.includes(state)) throw new Error(`Unexpected P2 association: ${associationId}`);
    const currentVersionId = `version-current-${state}`;
    const currentBytes = resourceBytes(currentVersionId);
    const unavailable = state === "deleted" || state === "offline";
    const logicalPath = state === "moved" ? "docs/moved.md" : state === "changed" ? "docs/changed.md" : `docs/${state}.md`;
    const descriptor = {
      resource: observation.resource, resolution_id: `resolution-${state}`, state,
      display_name: `${state}.md`, logical_path: logicalPath, kind: "file",
      current_version: { version_id: currentVersionId, digest: digest(currentBytes), size: currentBytes.length, mime_type: "text/markdown", modified_at: "2026-08-16T00:00:02Z" },
      capabilities: { read_current: !unavailable, read_snapshot: state === "changed", preview: !unavailable, download: !unavailable, reveal: !unavailable, open_external: false, copy_logical_path: !unavailable },
    };
    if (state === "changed") {
      const observed = resourceBytes("version-observed-changed");
      descriptor.observed_version = { version_id: "version-observed-changed", digest: digest(observed), size: observed.length, mime_type: "text/markdown", modified_at: "2026-08-16T00:00:00Z" };
    }
    return { results: [{ association_id: associationId, resource: observation.resource, descriptor }] };
  }
  if (operation === "resources.preview") {
    const bytes = resourceBytes(params.version_id);
    return { kind: "markdown", version_id: params.version_id, mime_type: "text/markdown", content_base64: bytes.toString("base64"), digest: digest(bytes) };
  }
  if (operation === "resources.download.prepare") {
    const bytes = resourceBytes(params.version_id);
    return { download_id: "download-packaged-resource-p2", version_id: params.version_id, size: bytes.length, digest: digest(bytes), transport: "owop_chunks", expires_at: "2026-08-16T00:05:00Z" };
  }
  if (operation === "resources.download.chunk") {
    const bytes = resourceBytes("version-current-available");
    const offset = Number(params.offset || 0);
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + Number(params.length || bytes.length)));
    return { download_id: params.download_id, content_base64: chunk.toString("base64"), offset, length: chunk.length, eof: offset + chunk.length === bytes.length, chunk_digest: digest(chunk) };
  }
  if (operation === "resources.download.cancel") return { cancelled: true };
  if (operation === "resources.subscribe") return { cursor: Number(params.after_sequence || 0), events: [] };
  throw new Error(`Unexpected P2 OWOP operation: ${String(operation)}`);
}

export function assertPackagedConversationResourceChecks(checks) {
  for (const check of PACKAGED_RESOURCE_REQUIRED_CHECKS) {
    if (!checks?.[check]) throw new Error(`Packaged conversation resource P2 check failed: ${check}`);
  }
}

function resourceBytes(versionId) {
  if (versionId === "version-observed-changed") return Buffer.from("# Cited P2 resource\n", "utf8");
  if (versionId === "version-current-moved") return Buffer.from("# Moved P2 resource\n", "utf8");
  if (versionId === "version-current-changed") return Buffer.from("# Current P2 resource\n", "utf8");
  return Buffer.from("# Packaged P2 resource\n", "utf8");
}

function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function resourceKey(state) {
  return { protocol: "owop/1", authority_id: "runtime-local-packaged-p2", workspace_id: PACKAGED_RESOURCE_WORKSPACE_ID, resource_type: "file", resource_id: `file-${state}`, generation: 1 };
}
