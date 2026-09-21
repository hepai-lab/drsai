import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConversationResourceHostRouter } from "../../shared/main/conversationResourceHostRouter";
import { canonicalConversationResourceRevealPath } from "../../shared/main/conversationResourceActions";
import { registerConversationResourceReadIpc } from "../../shared/main/conversationResourceIpc";

const sessionId = "session-ipc-p2";
const bytes = Buffer.from("shared real IPC resource preview", "utf8");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const quadrants = [
  { id: "local-file", authority: "runtime-local", workspace: "workspace-local", type: "file", local: true },
  { id: "local-artifact", authority: "runtime-local", workspace: "workspace-local", type: "artifact", local: true },
  { id: "remote-file", authority: "runtime-remote", workspace: "workspace-remote", type: "file", local: false },
  { id: "remote-artifact", authority: "runtime-remote", workspace: "workspace-remote", type: "artifact", local: false },
] as const;
const associations = quadrants.map((item, index) => ({
  association_id: `assoc-${item.id}`,
  resource: { protocol: "owop/1", authority_id: item.authority, workspace_id: item.workspace, resource_type: item.type, resource_id: `resource-${item.id}`, generation: 1 },
  relation: item.type === "artifact" ? "output_artifact" : "input_reference",
  label_snapshot: `${item.id}.txt`, presentation: item.type === "artifact" ? "card" : "inline",
  version_snapshot: { version_id: `version-${item.id}`, digest, size: bytes.length, mime_type: "text/plain" },
}));
const snapshot = {
  version: "1.0", session: { id: sessionId, workspace_id: "workspace-local" }, runs: [],
  items: [{ id: "item-ipc", type: "message", status: "completed", associations, content: {
    role: "assistant", parts: associations.map((association, index) => ({ part_id: `part-${index}`, type: "resource", association_id: association.association_id })),
  } }], snapshot_sequence: 1,
};
const requestedActions: string[] = [];

const router = new ConversationResourceHostRouter({
  async getOaepSnapshot(requestedSessionId) { assert.equal(requestedSessionId, sessionId); return snapshot as never; },
  async executeOWOP(workspaceId, operation, params, context) {
    assert.deepEqual(context, { sessionId });
    if (operation === "resources.resolve_batch") {
      const observation = (params.observations as Array<Record<string, unknown>>)[0]!;
      requestedActions.push(String(observation.requested_action));
      const association = associations.find(item => item.association_id === observation.association_id)!;
      const quadrant = quadrants.find(item => `assoc-${item.id}` === association.association_id)!;
      return { results: [{ association_id: association.association_id, resource: association.resource, descriptor: {
        resource: association.resource, resolution_id: `resolve-${quadrant.id}`, state: "available",
        display_name: `${quadrant.id}.txt`, kind: quadrant.type,
        logical_path: quadrant.local && quadrant.type === "file" ? "docs/local-file.txt" : quadrant.local ? undefined : "server/private.txt",
        current_version: { version_id: `version-${quadrant.id}`, digest, size: bytes.length, mime_type: "text/plain" },
        capabilities: { read_current: true, read_snapshot: true, preview: true, download: true,
          reveal: quadrant.local && quadrant.type === "file", open_external: false,
          copy_logical_path: quadrant.type === "file" },
      } }] };
    }
    if (operation === "resources.preview") return {
      kind: "text", version_id: String(params.version_id), mime_type: "text/plain",
      content_base64: bytes.toString("base64"), digest,
    };
    throw new Error(`unexpected ${workspaceId} ${operation}`);
  },
} as never);

const root = await mkdtemp(join(tmpdir(), "opendrsai-ipc-p2-"));
try {
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "local-file.txt"), bytes);
  const handlers = new Map<string, (event: unknown, request: never) => Promise<unknown>>();
  const revealed: string[] = [];
  registerConversationResourceReadIpc(
    (channel, handler) => handlers.set(channel, handler as never),
    path => { revealed.push(path); },
    {
      resolve: request => router.resolve(request.sessionId!, request.associationId!),
      preview: request => router.preview(request.sessionId!, request.associationId!, request.workspacePath, request.maxBytes, request.version),
      revealPath: async request => canonicalConversationResourceRevealPath(request.workspacePath, await router.resolve(request.sessionId!, request.associationId!, "reveal")),
      logicalPath: async request => {
        const resolved = await router.resolve(request.sessionId!, request.associationId!, "copy_logical_path");
        if (!resolved.capabilities.copyLogicalPath || !resolved.logicalPath) throw new Error("copy_path_unavailable");
        return resolved.logicalPath;
      },
    },
  );
  assert.deepEqual([...handlers.keys()].sort(), [
    "desktop:conversation-resource-copy-logical-path", "desktop:conversation-resource-preview",
    "desktop:conversation-resource-resolve", "desktop:conversation-resource-reveal",
  ]);
  for (const quadrant of quadrants) {
    const request = { workspacePath: quadrant.local ? root : "remote://workspace", sessionId, associationId: `assoc-${quadrant.id}` };
    const resolved = await handlers.get("desktop:conversation-resource-resolve")!(null, request as never) as Record<string, unknown>;
    assert.equal(resolved.resourceType, quadrant.type);
    const preview = await handlers.get("desktop:conversation-resource-preview")!(null, request as never) as Record<string, unknown>;
    assert.equal(preview.content, bytes.toString("utf8"));
    assert.match(String(preview.path), /^resource:\/\//);
    assert.doesNotMatch(JSON.stringify(preview), /server[\\/]private/);
    if (!quadrant.local) assert.doesNotMatch(JSON.stringify(preview), /[A-Za-z]:\\\\/);
  }
  assert.equal(await handlers.get("desktop:conversation-resource-reveal")!(null, {
    workspacePath: root, sessionId, associationId: "assoc-local-file",
  } as never), true);
  assert.equal(revealed[0], join(root, "docs", "local-file.txt"));
  assert.equal(await handlers.get("desktop:conversation-resource-copy-logical-path")!(null, {
    workspacePath: root, sessionId, associationId: "assoc-local-file",
  } as never), "docs/local-file.txt");
  await assert.rejects(handlers.get("desktop:conversation-resource-reveal")!(null, {
    workspacePath: "remote://workspace", sessionId, associationId: "assoc-remote-file",
  } as never), /reveal_unavailable/);
  assert.equal(revealed.length, 1, "remote logical path reached the local system reveal callback");
  assert(requestedActions.includes("reveal") && requestedActions.includes("copy_logical_path"));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Desktop shared P2 conversation resource IPC passed (local/remote file/artifact).")
