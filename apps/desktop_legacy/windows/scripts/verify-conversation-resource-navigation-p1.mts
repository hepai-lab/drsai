import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DesktopThread } from "../../shared/api/desktopApi";
import type { OaepItem, OaepResourceRef, OaepRun } from "../../shared/api/oaep.generated";
import {
  oaepResourceResolveRequest,
  commitValidatedDownload,
  previewOaepResource,
  resolveOaepResource,
  saveOaepResourceToFile,
} from "../../shared/main/oaepOwopResources";
import { projectOaepThreadSnapshot } from "../../shared/main/threadRuntimeProjection";
import { buildStructuredProcessPresentation } from "../../shared/renderer/src/structuredProcessPresentation";
import { buildComposerDraftParts } from "../../shared/renderer/src/composerDraftParts";

const workspaceId = "workspace-one";
const sessionId = "session-one";
const runId = "run-one";
const timestamp = "2026-08-16T00:00:00.000Z";
const source = { backend: "opendrsai", adapter: "native", mapping_version: "oaep-native/1" };
const fileRef: OaepResourceRef = {
  protocol: "owop/1",
  workspace_id: workspaceId,
  resource_type: "file",
  resource_id: "opaque-file-one",
  label: "方案.md",
  digest: `sha256:${"a".repeat(64)}`,
  relation: "input_attachment",
  presentation: "inline",
};

assert.deepEqual(buildComposerDraftParts(
  "Read @file:\"docs/plan.md\" then summarize it.",
  [
    { kind: "selection", path: "", name: "Current selection" },
    { kind: "file", path: "C:\\workspace\\docs\\plan.md", name: "plan.md" },
  ],
  [{ kind: "file", path: "C:\\workspace\\docs\\plan.md", name: "plan.md" }],
  "C:\\workspace",
), [
  { type: "attachment", attachmentIndex: 0 },
  { type: "text", text: "Read " },
  { type: "attachment", attachmentIndex: 1 },
  { type: "text", text: " then summarize it." },
]);

assert.deepEqual(oaepResourceResolveRequest(fileRef), {
  workspaceId,
  operation: "files.resolve",
  params: { file_id: "opaque-file-one", expected_digest: fileRef.digest },
});
assert.deepEqual(oaepResourceResolveRequest({
  ...fileRef,
  resource_type: "artifact",
  resource_id: "artifact-one",
}), {
  workspaceId,
  operation: "artifact.metadata",
  params: { artifact_id: "artifact-one" },
});
assert.throws(() => oaepResourceResolveRequest({ ...fileRef, resource_type: "pty" }), /not_navigable/);

const calls: Array<{ workspaceId: string; operation: string; params: Record<string, unknown> }> = [];
const resolved = await resolveOaepResource({
  async executeOWOP(requestWorkspaceId, operation, params) {
    calls.push({ workspaceId: requestWorkspaceId, operation, params });
    return {
      resource: {
        file_id: "opaque-file-one",
        path: "docs/已移动方案.md",
        name: "已移动方案.md",
        kind: "file",
        mime_type: "text/markdown",
        size: 42,
        modified_ns: 1,
        digest: fileRef.digest,
        state: "moved",
        capabilities: { read: true, preview: true, download: true, reveal: true, open_external: false },
      },
    };
  },
} as never, fileRef);
assert.equal(calls[0]?.operation, "files.resolve");
assert.equal(resolved.path, "docs/已移动方案.md");
assert.equal(resolved.state, "moved");
assert.equal(resolved.capabilities.preview, true);

const artifactRef: OaepResourceRef = {
  ...fileRef,
  resource_type: "artifact",
  resource_id: "runtime-artifact-one",
  label: "结果.md",
  relation: "output_artifact",
  presentation: "card",
};
const artifactCalls: string[] = [];
const artifactBytes = Buffer.from("# Runtime\n\nOK", "utf8");
const artifactDigest = createHash("sha256").update(artifactBytes).digest("hex");
const runtimePreview = await previewOaepResource({
  async executeOWOP(_workspaceId, operation) {
    artifactCalls.push(operation);
    if (operation === "artifact.metadata") return {
      artifact_id: artifactRef.resource_id,
      display_name: "结果.md",
      mime_type: "text/markdown",
      size: 12,
      sha256: artifactDigest,
      storage_kind: "runtime",
      previewable: true,
      downloadable: true,
      created_at: timestamp,
      state: "available",
      capabilities: { read: true, preview: true, download: true, reveal: false, open_external: false },
    };
    return {
      artifact_id: artifactRef.resource_id,
      offset: 0,
      length: 12,
      content_base64: artifactBytes.toString("base64"),
      eof: true,
      sha256: artifactDigest,
    };
  },
} as never, artifactRef, "remote://workspace-one");
assert.deepEqual(artifactCalls, ["artifact.metadata", "artifact.chunk"]);
assert.equal(runtimePreview.path, "artifact://workspace-one/runtime-artifact-one");
assert.equal(runtimePreview.kind, "markdown");
assert.equal(runtimePreview.content, "# Runtime\n\nOK");
assert.equal(runtimePreview.metadata?.runtimeOwned, true);

const downloadRoot = await mkdtemp(join(tmpdir(), "opendrsai-p1-download-"));
try {
  const destination = join(downloadRoot, "result.md");
  const saved = await saveOaepResourceToFile({
    async executeOWOP(_workspaceId, operation) {
      if (operation === "artifact.metadata") return {
        artifact_id: artifactRef.resource_id, display_name: "result.md", mime_type: "text/markdown",
        size: artifactBytes.length, sha256: artifactDigest, storage_kind: "runtime", downloadable: true,
        state: "available", capabilities: { read: true, preview: true, download: true, reveal: false, open_external: false },
      };
      return { content_base64: artifactBytes.toString("base64"), eof: true };
    },
  } as never, artifactRef, destination);
  assert.equal(saved.digest, `sha256:${artifactDigest}`);
  assert.deepEqual(await readFile(destination), artifactBytes);
  await assert.rejects(saveOaepResourceToFile({
    async executeOWOP(_workspaceId, operation) {
      if (operation === "artifact.metadata") return {
        display_name: "bad.md", size: artifactBytes.length, sha256: "c".repeat(64), downloadable: true,
        state: "available", capabilities: { read: true, preview: true, download: true, reveal: false, open_external: false },
      };
      return { content_base64: artifactBytes.toString("base64"), eof: true };
    },
  } as never, artifactRef, join(downloadRoot, "bad.md")), /digest_mismatch/);

  const failClosed = await resolveOaepResource({
    async executeOWOP() { return { display_name: "legacy.md", previewable: true, downloadable: true }; },
  } as never, artifactRef);
  assert.equal(failClosed.state, "unsupported");
  assert.deepEqual(failClosed.capabilities, {
    read: false, preview: false, download: false, reveal: false, openExternal: false, copyLogicalPath: false,
  });

  const oldDestination = join(downloadRoot, "existing.md");
  const newPartial = join(downloadRoot, "existing.md.partial");
  await writeFile(oldDestination, "old-content");
  await writeFile(newPartial, "new-content");
  let renameCount = 0;
  await assert.rejects(commitValidatedDownload(newPartial, oldDestination, {
    async lstat() { return {}; },
    async rename(source, destination) {
      renameCount += 1;
      if (renameCount === 2) throw Object.assign(new Error("injected rename failure"), { code: "EACCES" });
      const { rename: realRename } = await import("node:fs/promises");
      await realRename(source, destination);
    },
    async rm(path, options) { const { rm: realRm } = await import("node:fs/promises"); await realRm(path, options); },
  }), /injected rename failure/);
  assert.equal(await readFile(oldDestination, "utf8"), "old-content");
} finally {
  await rm(downloadRoot, { recursive: true, force: true });
}

const run: OaepRun = {
  id: runId, session_id: sessionId, sequence: 1, source, status: "completed",
  created_at: timestamp, updated_at: timestamp, completed_at: timestamp,
};
const base = { session_id: sessionId, run_id: runId, source, created_at: timestamp, updated_at: timestamp };
const items: OaepItem[] = [
  {
    ...base, id: "user-one", type: "message", status: "completed", sequence: 1,
    content: {
      role: "user", phase: "final", text: "请读取方案", citations: [],
      parts: [
        { type: "text", text: "请读取方案" },
        { type: "resource_ref", name: "方案.md", mime_type: "text/markdown", resource_ref: fileRef },
      ],
    },
  },
  {
    ...base, id: "change-one", type: "file_change", status: "completed", sequence: 2,
    content: {
      summary: "更新方案",
      changes: [{ path: "docs/方案.md", operation: "modify", resource_ref: { ...fileRef, relation: "file_change_target", presentation: "activity" } }],
    },
  },
  {
    ...base, id: "artifact-one", type: "artifact", status: "completed", sequence: 3,
    content: {
      artifact_id: "artifact-one", artifact_type: "file", name: "结果.docx", summary: "生成的文档",
      path: "结果.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 128, previewable: true, downloadable: true,
      resource_refs: [{ ...fileRef, resource_type: "artifact", resource_id: "artifact-one", relation: "output_artifact", presentation: "card" }],
    },
  },
];
const thread = {
  id: "thread-one", kind: "chat", title: "Resource navigation", workspacePath: "C:\\workspace",
  createdAt: timestamp, updatedAt: timestamp, status: "idle", messageCount: 0,
} as DesktopThread;
const sharedFixture = JSON.parse(readFileSync(
  resolve("../../../cores/protocol/oaep/conversation-resources-p1.fixture.json"), "utf8",
)) as { runs: OaepRun[]; items: OaepItem[] };
const sharedProjection = projectOaepThreadSnapshot(thread, sharedFixture.items, sharedFixture.runs);
assert.deepEqual(
  sharedProjection.messages.find((message) => message.role === "user")?.draftParts?.map((part) => part.type),
  ["text", "attachment", "text"],
);
const snapshot = projectOaepThreadSnapshot(thread, items, [run]);
const user = snapshot.messages.find((message) => message.role === "user");
assert.equal(user?.attachments?.[0]?.resourceRef?.resource_id, "opaque-file-one");
assert.equal(user?.attachments?.[0]?.path, "", "physical paths are resolved only at click time");
assert.deepEqual(user?.draftParts?.map((part) => part.type), ["text", "attachment"]);
assert.equal(user?.draftParts?.[1]?.type === "attachment" ? user.draftParts[1].attachmentIndex : -1, 0);
const assistant = snapshot.messages.find((message) => message.role === "assistant");
const artifact = assistant?.structuredTurn?.parts.find((part) => part.kind === "artifact");
assert.equal(artifact?.resourceRef?.resource_id, "artifact-one");
const change = assistant?.structuredTurn?.activities.find((activity) => activity.kind === "file_change");
assert.equal(change?.resourceRef?.relation, "file_change_target");
const process = buildStructuredProcessPresentation(assistant!.structuredTurn!, "zh");
assert.equal(process.activityGroups[0]?.fileResources[0]?.resourceRef.resource_id, "opaque-file-one");

const chatWorkspaceSource = readFileSync(resolve("../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const structuredPartsSource = readFileSync(resolve("../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
assert.match(chatWorkspaceSource, /conversationResourceNotice/);
assert.match(chatWorkspaceSource, /resolved\.state === "deleted"/);
assert.match(chatWorkspaceSource, /resolved\.state === "moved"/);
assert.match(chatWorkspaceSource, /resolved\.state === "changed"/);
assert.match(chatWorkspaceSource, /previewConversationResource/);
assert.match(chatWorkspaceSource, /downloadConversationResource/);
assert.match(chatWorkspaceSource, /buildComposerDraftParts/);
assert.match(chatWorkspaceSource, /saveWorkspaceFileAs\(\{ workspacePath, path/);
assert.match(structuredPartsSource, /Boolean\(part\.resourceRef\)/, "Workspace citations must be openable through ResourceRef");
assert.match(structuredPartsSource, /data-resource-state=\{resourceState\}/, "resolved state must remain visible on cards");
assert.match(structuredPartsSource, /onOpenResource\(resourceRef\)/, "File Change resources must use the shared resolver open action");

console.log("Conversation resource navigation P1 verification passed.");
