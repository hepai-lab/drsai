import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATTACHMENT_CACHE_LIMIT_BYTES,
  ATTACHMENT_CACHE_TTL_MS,
  ATTACHMENT_FILE_LIMIT_BYTES,
  cleanupAttachmentCache,
  stageAttachments,
  preflightAttachments,
} from "../../shared/main/chat.ts";

const root = await mkdtemp(join(tmpdir(), "opendrsai-p7-attachments-"));
const workspace = join(root, "workspace");
const external = join(root, "external");
await mkdir(workspace); await mkdir(external);
try {
  const source = join(external, "small.txt");
  await writeFile(source, "attachment content", "utf8");
  await preflightAttachments([{ kind: "file", path: source, name: "small.txt" }], workspace);
  await assert.rejects(
    access(join(workspace, ".opendrsai")),
    undefined,
    "preflight must not create attachment directories or copy files",
  );
  const staged = await stageAttachments([{ kind: "file", path: source, name: "small.txt" }], workspace, "run-small");
  assert.deepEqual(staged.refs, [".opendrsai/attachments/run-small/small.txt"]);
  assert.deepEqual(staged.resources.map((value) => [value.protocol, value.kind, value.status]), [
    ["oaep.input/1", "file", "encoded"],
  ]);
  await access(join(workspace, staged.refs[0]));

  await assert.rejects(
    preflightAttachments([{ kind: "file", path: join(external, "missing.txt"), name: "missing.txt" }], workspace),
    /missing\.txt/,
  );

  const huge = join(external, "huge.bin");
  await writeFile(huge, "x"); await truncate(huge, ATTACHMENT_FILE_LIMIT_BYTES + 1);
  await assert.rejects(
    preflightAttachments([{ kind: "file", path: huge, name: "huge.bin" }], workspace),
    /per-file limit/,
  );

  const folder = join(workspace, "docs");
  await mkdir(folder);
  const selectionAttachment = { kind: "selection" as const, path: "editor:1", name: "selection", visibleText: "selected text" };
  const contexts = await stageAttachments([
    { kind: "folder", path: folder, name: "docs" },
    selectionAttachment,
    { kind: "terminal", path: "terminal:1", name: "terminal", visibleText: "tests passed" },
    { kind: "browser", path: "browser:1", name: "browser", url: "https://example.invalid", visibleText: "page text" },
  ], workspace, "run-context");
  assert.deepEqual(contexts.resources.map((value) => value.kind), ["folder", "selection", "terminal", "browser"]);
  assert.equal(contexts.resources.every((value) => value.protocol === "oaep.input/1" && value.status === "encoded"), true);
  assert.equal(contexts.resources.slice(1).every((value) => typeof value.captured_at === "string"), true);
  assert.match(contexts.resources[1]?.content ?? "", /selected text/);
  const capturedSelection = contexts.resources[1]?.content;
  selectionAttachment.visibleText = "later editor state";
  assert.equal(capturedSelection, contexts.resources[1]?.content,
    "context resources are immutable request snapshots and cannot silently switch to later window state");
  assert.doesNotMatch(contexts.resources[1]?.content ?? "", /later editor state/);
  await assert.rejects(
    stageAttachments([{
      kind: "browser", path: "browser:2", name: "screenshot", screenshotDataUrl: "data:image/png;base64,AA==",
    }], workspace, "run-screenshot"),
    /screenshot input is not supported/,
  );

  const cancelledSource = join(external, "cancel.bin");
  await writeFile(cancelledSource, "x"); await truncate(cancelledSource, 64 * 1024 * 1024);
  const controller = new AbortController();
  const copying = stageAttachments([{ kind: "file", path: cancelledSource, name: "cancel.bin" }], workspace, "run-cancel", controller.signal);
  setTimeout(() => controller.abort(new DOMException("copy cancelled", "AbortError")), 0);
  await assert.rejects(copying, /copy cancelled|aborted/i);
  const cancelledDir = join(workspace, ".opendrsai", "attachments", "run-cancel");
  assert.equal((await readdir(cancelledDir).catch(() => [])).some((name) => name.endsWith(".partial")), false);

  const cacheRoot = join(workspace, ".opendrsai", "attachments");
  const partial = join(cacheRoot, "orphan.partial");
  await writeFile(partial, "incomplete");
  const oldRun = join(cacheRoot, "run-old");
  await mkdir(oldRun); await writeFile(join(oldRun, "old.txt"), "old");
  const old = new Date(Date.now() - ATTACHMENT_CACHE_TTL_MS - 1_000);
  await utimes(join(oldRun, "old.txt"), old, old); await utimes(oldRun, old, old);
  const cleaned = await cleanupAttachmentCache(workspace);
  assert.ok(cleaned.removed >= 2, "crash partials and entries older than 24h must be removed");
  await assert.rejects(access(partial)); await assert.rejects(access(oldRun));

  const capacityRun = join(cacheRoot, "run-capacity");
  await mkdir(capacityRun); const capacity = join(capacityRun, "sparse.bin");
  await writeFile(capacity, "x"); await truncate(capacity, ATTACHMENT_CACHE_LIMIT_BYTES);
  await assert.rejects(
    stageAttachments([{ kind: "file", path: source, name: "another.txt" }], workspace, "run-full"),
    /cache would exceed/,
  );
  assert.equal((await stat(capacity)).size, ATTACHMENT_CACHE_LIMIT_BYTES);

  console.log("P7 attachment preflight, cancellation, crash recovery, capacity and 24h TTL verification passed.");
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
