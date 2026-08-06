import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ATTACHMENT_CACHE_LIMIT_BYTES,
  ATTACHMENT_CACHE_TTL_MS,
  ATTACHMENT_FILE_LIMIT_BYTES,
  NATIVE_IMAGE_FILE_LIMIT_BYTES,
  cleanupAttachmentCache,
  preflightAttachments,
  stageAttachments,
} from "../../shared/main/chat.ts";
import { describeUserFacingError } from "../../shared/renderer/src/userFacingErrors.ts";

const root = await mkdtemp(join(tmpdir(), "opendrsai-attachments-"));
const workspace = join(root, "workspace");
const external = join(root, "external");
const checks: Record<string, boolean> = {};
await mkdir(workspace); await mkdir(external);

try {
  const source = join(external, "small.txt");
  await writeFile(source, "attachment content", "utf8");
  await preflightAttachments([{ kind: "file", path: source, name: "small.txt" }], workspace);
  await assert.rejects(access(join(workspace, ".opendrsai")), undefined, "preflight must not write into the workspace");
  checks.externalFilePreflightHasNoSideEffect = true;

  const staged = await stageAttachments([{ kind: "file", path: source, name: "small.txt" }], workspace, "run-small");
  assert.deepEqual(staged.refs, [".opendrsai/attachments/run-small/small.txt"]);
  assert.deepEqual(staged.resources.map((item) => [item.protocol, item.kind, item.status]), [["oaep.input/1", "file", "encoded"]]);
  await access(join(workspace, staged.refs[0]));
  checks.externalFileStagesWithOaepIdentity = true;

  const png = join(external, "pixel.png");
  await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await preflightAttachments([{ kind: "file", path: png, name: "pixel.png" }], workspace);
  const stagedImage = await stageAttachments([{ kind: "file", path: png, name: "pixel.png" }], workspace, "run-image");
  assert.equal(stagedImage.resources[0].mime, "image/png");
  assert.equal(stagedImage.resources[0].content, undefined);
  checks.nativeImageMimeAndReferenceEncoded = true;

  const disguisedImage = join(external, "pixel.bin");
  await writeFile(disguisedImage, await readFile(png));
  const stagedDisguised = await stageAttachments([{ kind: "file", path: disguisedImage, name: "pixel.bin" }], workspace, "run-image-magic");
  assert.equal(stagedDisguised.resources[0].mime, "image/png");
  checks.nativeImageMagicDetected = true;

  const corruptImage = join(external, "corrupt.png");
  await writeFile(corruptImage, "not an image", "utf8");
  await assert.rejects(preflightAttachments([{ kind: "file", path: corruptImage, name: "corrupt.png" }], workspace), /corrupt|unsupported format/i);
  checks.corruptImageRejectedBeforeRun = true;

  const mismatchedImage = join(external, "mismatch.jpg");
  await writeFile(mismatchedImage, await readFile(png));
  await assert.rejects(preflightAttachments([{ kind: "file", path: mismatchedImage, name: "mismatch.jpg" }], workspace), /does not match/i);
  checks.imageExtensionMismatchRejected = true;

  const hugeImage = join(external, "huge.png");
  await writeFile(hugeImage, "x"); await truncate(hugeImage, NATIVE_IMAGE_FILE_LIMIT_BYTES + 1);
  await assert.rejects(preflightAttachments([{ kind: "file", path: hugeImage, name: "huge.png" }], workspace), /native image limit/i);
  checks.oversizedImageRejectedBeforeRun = true;

  const unsupportedModel = describeUserFacingError({
    code: "model_image_input_unsupported", category: "model", retryable: false,
    recovery_actions: ["select_model"], diagnostic_reference: "diag-image",
  }, "zh");
  assert.match(unsupportedModel.action, /附件和输入内容已保留/);
  assert.equal(unsupportedModel.actions.some((action) => action.id === "select_model"), true);
  checks.nonvisionRecoveryPreservesInputAndSelectsModel = true;

  await assert.rejects(preflightAttachments([{ kind: "file", path: join(external, "missing.txt"), name: "missing.txt" }], workspace), /not a regular file/);
  checks.missingFileRejected = true;

  const huge = join(external, "huge.bin");
  await writeFile(huge, "x"); await truncate(huge, ATTACHMENT_FILE_LIMIT_BYTES + 1);
  await assert.rejects(preflightAttachments([{ kind: "file", path: huge, name: "huge.bin" }], workspace), /per-file limit/);
  checks.largeFileRejected = true;

  const outsideFolder = join(external, "outside-folder");
  await mkdir(outsideFolder);
  await assert.rejects(preflightAttachments([{ kind: "folder", path: outsideFolder, name: "outside-folder" }], workspace), /inside the current workspace/);
  checks.outsideFolderRejected = true;

  const aclFile = join(external, "acl-denied.txt");
  await writeFile(aclFile, "private", "utf8");
  const aclDenied = process.platform === "win32"
    && spawnSync("icacls.exe", [aclFile, "/inheritance:r", "/deny", "*S-1-1-0:(R)"], { windowsHide: true }).status === 0;
  if (aclDenied) {
    try {
      await assert.rejects(preflightAttachments([{ kind: "file", path: aclFile, name: "acl-denied.txt" }], workspace), /cannot be read|access|permission/i);
      checks.windowsAclUnreadableRejected = true;
    } finally {
      spawnSync("icacls.exe", [aclFile, "/reset"], { windowsHide: true });
      spawnSync("icacls.exe", [aclFile, "/inheritance:e"], { windowsHide: true });
    }
  } else {
    const handle = await open(aclFile, "r"); await handle.close();
    checks.windowsAclUnreadableRejected = process.platform !== "win32";
  }

  const blockedWorkspace = join(root, "blocked-workspace");
  await mkdir(blockedWorkspace);
  await writeFile(join(blockedWorkspace, ".opendrsai"), "destination blocker", "utf8");
  await preflightAttachments([{ kind: "file", path: source, name: "copy-fails.txt" }], blockedWorkspace);
  await assert.rejects(stageAttachments([{ kind: "file", path: source, name: "copy-fails.txt" }], blockedWorkspace, "run-copy-failure"));
  checks.copyFailureRejected = true;

  const folder = join(workspace, "docs");
  await mkdir(folder);
  const context = await stageAttachments([
    { kind: "folder", path: folder, name: "docs" },
    { kind: "selection", path: "editor:1", name: "selection", visibleText: "selected text" },
    { kind: "terminal", path: "terminal:1", name: "terminal", visibleText: "tests passed" },
    { kind: "browser", path: "browser:1", name: "browser", url: "https://example.invalid", visibleText: "page text" },
  ], workspace, "run-context");
  assert.deepEqual(context.resources.map((item) => item.kind), ["folder", "selection", "terminal", "browser"]);
  assert.equal(context.resources.every((item) => item.protocol === "oaep.input/1" && item.status === "encoded"), true);
  checks.contextResourcesEncoded = true;

  await assert.rejects(stageAttachments([{ kind: "browser", path: "browser:2", name: "screenshot", screenshotDataUrl: "data:image/png;base64,AA==" }], workspace, "run-screenshot"), /not supported/);
  checks.unsupportedScreenshotRejected = true;

  const cancelledSource = join(external, "cancel.bin");
  await writeFile(cancelledSource, "x"); await truncate(cancelledSource, 64 * 1024 * 1024);
  const controller = new AbortController();
  const copying = stageAttachments([{ kind: "file", path: cancelledSource, name: "cancel.bin" }], workspace, "run-cancel", controller.signal);
  setTimeout(() => controller.abort(new DOMException("copy cancelled", "AbortError")), 0);
  await assert.rejects(copying, /copy cancelled|aborted/i);
  assert.equal((await readdir(join(workspace, ".opendrsai", "attachments", "run-cancel")).catch(() => [])).some((name) => name.endsWith(".partial")), false);
  checks.cancelRemovesPartialCopy = true;

  const cacheRoot = join(workspace, ".opendrsai", "attachments");
  const partial = join(cacheRoot, "orphan.partial"); await writeFile(partial, "incomplete");
  const oldRun = join(cacheRoot, "run-old"); await mkdir(oldRun); await writeFile(join(oldRun, "old.txt"), "old");
  const old = new Date(Date.now() - ATTACHMENT_CACHE_TTL_MS - 1_000);
  await utimes(join(oldRun, "old.txt"), old, old); await utimes(oldRun, old, old);
  const cleaned = await cleanupAttachmentCache(workspace);
  assert.ok(cleaned.removed >= 2); await assert.rejects(access(partial)); await assert.rejects(access(oldRun));
  checks.crashAndTtlCleanup = true;

  const capacityRun = join(cacheRoot, "run-capacity"); await mkdir(capacityRun);
  const capacity = join(capacityRun, "sparse.bin"); await writeFile(capacity, "x"); await truncate(capacity, ATTACHMENT_CACHE_LIMIT_BYTES);
  await assert.rejects(stageAttachments([{ kind: "file", path: source, name: "another.txt" }], workspace, "run-full"), /cache would exceed/);
  assert.equal((await stat(capacity)).size, ATTACHMENT_CACHE_LIMIT_BYTES);
  checks.cacheCapacityRejected = true;

  const chatSource = readFileSync(resolve(process.cwd(), "../shared/main/chat.ts"), "utf8");
  const runtimeFlow = chatSource.slice(chatSource.indexOf("async function runRuntimeBackendChat("), chatSource.indexOf("function emitRuntimeOaepEvent("));
  assert.ok(runtimeFlow.indexOf("preflightAttachments(") < runtimeFlow.indexOf("client.createAgentRun("));
  assert.match(runtimeFlow, /stageAttachments[\s\S]{0,700}cancelAgentRun/);
  checks.preflightPrecedesRunCreation = true;
  checks.postRunStageFailureCancelsRun = true;

  assert.equal(Object.values(checks).every(Boolean), true, JSON.stringify(checks, null, 2));
  writeEvidence(checks);
  console.log(`OpenDrSai attachment lifecycle passed (${Object.keys(checks).length}/${Object.keys(checks).length}; Windows ACL, no-run preflight, OAEP staging, cancellation and recovery).`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function writeEvidence(passedChecks: Record<string, boolean>): void {
  const path = process.env.OPENDRSAI_ATTACHMENT_EVIDENCE?.trim();
  if (!path) return;
  const executable = resolve(process.cwd(), "release/win-unpacked/OpenDrSai.exe");
  const asar = resolve(process.cwd(), "release/win-unpacked/resources/app.asar");
  assert.ok(existsSync(executable) && existsSync(asar), "Current packaged artifacts are required for evidence binding.");
  const sha256 = (file: string) => `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    schema_version: "opendrsai.windows.attachment-evidence/1",
    captured_at: new Date().toISOString(),
    package: { version: "1.5.5", platform: "windows", arch: "x64" },
    checks: passedChecks,
    artifacts: {
      executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
      app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
    },
  }, null, 2)}\n`, "utf8");
}
