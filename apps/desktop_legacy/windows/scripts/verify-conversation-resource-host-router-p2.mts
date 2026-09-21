import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../../../../cores/protocol/oaep/conversation-resources-p2.fixture.json" with { type: "json" };
import { ConversationResourceHostRouter } from "../../shared/main/conversationResourceHostRouter";
import { canonicalConversationResourceRevealPath, conversationResourceIdentity } from "../../shared/main/conversationResourceActions";

assert.deepEqual(conversationResourceIdentity({
  workspacePath: "remote://workspace", sessionId: "session-one", associationId: "association-one",
}), { kind: "p2", sessionId: "session-one", associationId: "association-one" });
assert.throws(() => conversationResourceIdentity({
  workspacePath: "remote://workspace", sessionId: "session-one",
}), /conversation_resource_request_invalid/);
assert.throws(() => conversationResourceIdentity({
  workspacePath: "remote://workspace", sessionId: "session-one", associationId: "association-one",
  resourceRef: fixture.snapshot.items[0]!.associations![0]!.resource as never,
}), /conversation_resource_request_ambiguous/);

const calls: Array<Record<string, unknown>> = [];
const router = new ConversationResourceHostRouter({
  async getOaepSnapshot(sessionId) {
    assert.equal(sessionId, fixture.snapshot.session.id);
    return fixture.snapshot as never;
  },
  async executeOWOP(workspaceId, operation, params, context) {
    calls.push({ workspaceId, operation, params, context });
    const observation = (params.observations as Array<Record<string, unknown>>)[0]!;
    return { results: [{ association_id: observation.association_id, resource: observation.resource, descriptor: {
      resource: observation.resource,
      resolution_id: "resolution-one",
      state: "changed",
      display_name: "plan.md",
      logical_path: "docs/plan.md",
      kind: "file",
      current_version: {
        version_id: "version-current", digest: `sha256:${"a".repeat(64)}`, size: 42,
        mime_type: "text/markdown", modified_at: "2026-08-16T00:00:00Z",
      },
      observed_version: {
        version_id: "version-plan-7", digest: `sha256:${"b".repeat(64)}`, size: 40,
        mime_type: "text/markdown", modified_at: "2026-08-15T00:00:00Z",
      },
      capabilities: {
        read_current: true, read_snapshot: true, preview: true, download: true,
        reveal: false, open_external: false, copy_logical_path: true,
      },
    } }] };
  },
} as never);

const associationId = fixture.snapshot.items[0]!.associations![0]!.association_id;
const resolved = await router.resolve(fixture.snapshot.session.id, associationId);
assert.equal(resolved.name, "plan.md");
assert.equal(resolved.capabilities.preview, true);
assert.equal(resolved.logicalPath, "docs/plan.md");
assert.equal(resolved.observedVersionAvailable, true);
assert.equal("path" in resolved, false, "P2 router must not return a host path");
assert.deepEqual(calls[0]!.context, { sessionId: fixture.snapshot.session.id });
assert.equal(((calls[0]!.params as Record<string, unknown>).observations as Array<Record<string, unknown>>)[0]!.association_id, associationId);

await assert.rejects(router.resolve(fixture.snapshot.session.id, "association-missing"), /association_not_found/);
assert.equal(calls.length, 1, "unknown Association must fail before OWOP");

const malformed = new ConversationResourceHostRouter({
  async getOaepSnapshot() { return fixture.snapshot as never; },
  async executeOWOP() { return { results: [{ descriptor: { state: "future-state", capabilities: {} } }] }; },
} as never);
const safe = await malformed.resolve(fixture.snapshot.session.id, associationId);
assert.equal(safe.state, "unsupported");
assert.deepEqual(safe.capabilities, { read: false, preview: false, download: false, reveal: false, openExternal: false, copyLogicalPath: false });

const bytes = Buffer.from("P2 router download bytes", "utf8");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let cancelled = 0;
const actionRouter = new ConversationResourceHostRouter({
  async getOaepSnapshot() { return fixture.snapshot as never; },
  async executeOWOP(_workspaceId, operation, params, context) {
    assert.deepEqual(context, { sessionId: fixture.snapshot.session.id });
    if (operation === "resources.resolve_batch") {
      const observation = (params.observations as Array<Record<string, unknown>>)[0]!;
      return { results: [{ resource: observation.resource, descriptor: {
        resource: observation.resource, resolution_id: "resolve-action", state: "available",
        display_name: "Plan.md", kind: "file",
        current_version: { version_id: "current-action", digest, size: bytes.length, mime_type: "text/markdown", modified_at: "2026-08-16T00:00:00Z" },
        capabilities: { read_current: true, read_snapshot: false, preview: true, download: true, reveal: false, open_external: false, copy_logical_path: true },
      } }] };
    }
    if (operation === "resources.preview") return {
      kind: "markdown", version_id: "current-action", mime_type: "text/markdown",
      content_base64: bytes.toString("base64"), digest,
    };
    if (operation === "resources.download.prepare") return {
      download_id: "download-action", version_id: "current-action", size: bytes.length,
      digest, transport: "owop_chunks", expires_at: "2026-08-16T00:05:00Z",
    };
    if (operation === "resources.download.chunk") return {
      download_id: "download-action", content_base64: bytes.toString("base64"), offset: 0,
      length: bytes.length, eof: true, chunk_digest: digest,
    };
    if (operation === "resources.download.cancel") { cancelled += 1; return { cancelled: true }; }
    throw new Error(`unexpected operation ${operation}`);
  },
} as never);
const preview = await actionRouter.preview(fixture.snapshot.session.id, associationId, "remote://workspace");
assert.equal(preview.content, bytes.toString("utf8"));
assert.match(preview.path, /^resource:\/\//);

const root = await mkdtemp(join(tmpdir(), "opendrsai-router-p2-"));
try {
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "Plan.md"), bytes);
  assert.equal(await canonicalConversationResourceRevealPath(root, {
    ...resolved, logicalPath: "docs/Plan.md", capabilities: { ...resolved.capabilities, reveal: true },
  }), join(root, "docs", "Plan.md"));
  await assert.rejects(canonicalConversationResourceRevealPath(root, {
    ...resolved, logicalPath: "..", capabilities: { ...resolved.capabilities, reveal: true },
  }), /conversation_resource_reveal/);
  await assert.rejects(canonicalConversationResourceRevealPath(root, {
    ...resolved, logicalPath: "docs/Plan.md", capabilities: { ...resolved.capabilities, reveal: false },
  }), /conversation_resource_reveal_unavailable/);
  const destination = join(root, "Plan.md");
  await writeFile(destination, "old");
  const saved = await actionRouter.save(fixture.snapshot.session.id, associationId, destination);
  assert.equal(saved.digest, digest);
  assert.deepEqual(await readFile(destination), bytes);

  await writeFile(destination, "keep-on-cancel");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    actionRouter.save(fixture.snapshot.session.id, associationId, destination, controller.signal),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(await readFile(destination, "utf8"), "keep-on-cancel");
  assert.equal(cancelled, 1);

  const multiChunkBytes = Buffer.alloc(2 * 1_048_576 + 100, 0x5a);
  const multiChunkDigest = `sha256:${createHash("sha256").update(multiChunkBytes).digest("hex")}`;
  const corruptThirdChunk = new ConversationResourceHostRouter({
    async getOaepSnapshot() { return fixture.snapshot as never; },
    async executeOWOP(_workspaceId, operation, params) {
      if (operation === "resources.resolve_batch") {
        const observation = (params.observations as Array<Record<string, unknown>>)[0]!;
        return { results: [{ resource: observation.resource, descriptor: {
          resource: observation.resource, resolution_id: "resolve-corrupt", state: "available",
          display_name: "large.bin", kind: "artifact",
          current_version: { version_id: "version-corrupt", digest: multiChunkDigest, size: multiChunkBytes.length, mime_type: "application/octet-stream", modified_at: "2026-08-16T00:00:00Z" },
          capabilities: { read_current: true, read_snapshot: false, preview: false, download: true, reveal: false, open_external: false, copy_logical_path: false },
        } }] };
      }
      if (operation === "resources.download.prepare") return {
        download_id: "download-corrupt", version_id: "version-corrupt", size: multiChunkBytes.length,
        digest: multiChunkDigest, transport: "owop_chunks", expires_at: "2026-08-16T00:05:00Z",
      };
      if (operation === "resources.download.chunk") {
        const offset = Number(params.offset);
        const requested = Number(params.length);
        const content = multiChunkBytes.subarray(offset, Math.min(offset + requested, multiChunkBytes.length));
        const third = offset >= 2 * 1_048_576;
        return {
          download_id: "download-corrupt", content_base64: content.toString("base64"), offset,
          length: content.length, eof: offset + content.length === multiChunkBytes.length,
          chunk_digest: third ? `sha256:${"0".repeat(64)}` : `sha256:${createHash("sha256").update(content).digest("hex")}`,
        };
      }
      if (operation === "resources.download.cancel") return { cancelled: true };
      throw new Error(`unexpected operation ${operation}`);
    },
  } as never);
  await writeFile(destination, "keep-on-integrity-failure");
  await assert.rejects(
    corruptThirdChunk.save(fixture.snapshot.session.id, associationId, destination),
    /conversation_resource_download_chunk_integrity_mismatch/,
  );
  assert.equal(await readFile(destination, "utf8"), "keep-on-integrity-failure");

  const resumableSize = 101 * 1024 * 1024;
  const firstChunk = Buffer.alloc(1_048_576, 0x31);
  const resumableDigest = `sha256:${"c".repeat(64)}`;
  let prepareAttempt = 0;
  let recoveredOffset = 0;
  const resumableClient = {
    async getOaepSnapshot() { return fixture.snapshot as never; },
    async executeOWOP(_workspaceId: string, operation: string, params: Record<string, unknown>) {
      if (operation === "resources.resolve_batch") {
        const observation = (params.observations as Array<Record<string, unknown>>)[0]!;
        return { results: [{ resource: observation.resource, descriptor: {
          resource: observation.resource, resolution_id: "resolve-resume", state: "available",
          display_name: "large-resumable.bin", kind: "artifact",
          current_version: { version_id: "version-resume", digest: resumableDigest, size: resumableSize, mime_type: "application/octet-stream", modified_at: "2026-08-16T00:00:00Z" },
          capabilities: { read_current: true, read_snapshot: false, preview: false, download: true, reveal: false, open_external: false, copy_logical_path: false },
        } }] };
      }
      if (operation === "resources.download.prepare") {
        prepareAttempt += 1;
        recoveredOffset = Number(params.resume_offset || 0);
        if (prepareAttempt === 2) throw new Error("resource_version_conflict");
        return { download_id: "download-resume", version_id: "version-resume", size: resumableSize, digest: resumableDigest };
      }
      if (operation === "resources.download.chunk") {
        if (Number(params.offset) === 0) return {
          download_id: "download-resume", content_base64: firstChunk.toString("base64"), offset: 0,
          length: firstChunk.length, eof: false,
          chunk_digest: `sha256:${createHash("sha256").update(firstChunk).digest("hex")}`,
        };
        throw new Error("relay_disconnected");
      }
      if (operation === "resources.download.cancel") return { cancelled: true };
      throw new Error(`unexpected operation ${operation}`);
    },
  };
  const resumableDestination = join(root, "large-resumable.bin");
  await assert.rejects(
    new ConversationResourceHostRouter(resumableClient as never).save(fixture.snapshot.session.id, associationId, resumableDestination),
    /relay_disconnected/,
  );
  assert.equal((await readdir(root)).filter((name) => name.endsWith(".partial")).length, 1,
    "A transient interruption of a >100 MiB transfer must retain one private resumable partial.");
  await assert.rejects(
    new ConversationResourceHostRouter(resumableClient as never).save(fixture.snapshot.session.id, associationId, resumableDestination),
    /resource_version_conflict/,
  );
  assert.equal(recoveredOffset, firstChunk.length, "A recreated Desktop router must resume from the persisted byte offset.");
  assert.equal((await readdir(root)).filter((name) => name.endsWith(".partial")).length, 0,
    "A terminal version conflict must clean the retained partial.");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Conversation Resource Host Router P2 verification passed.");
