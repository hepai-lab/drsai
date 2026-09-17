import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAttachmentContext, withAttachmentContext } from "../../shared/main/chat.ts";
import {
  LOCAL_ATTACHMENT_CONTEXT_MARKER,
  stripAttachmentContextFromUserContent,
} from "../../shared/api/attachmentContextDisplay.ts";

/**
 * Attachment loading must never fail silently.
 *
 * A clipped or skipped file that is not announced turns into a confident
 * "the material does not mention it" — indistinguishable from a correct
 * refusal, so the bug survives review and testing.
 */

const root = await mkdtemp(join(tmpdir(), "opendrsai-attachment-coverage-"));
const checks: Record<string, boolean> = {};

try {
  const full = join(root, "full.txt");
  const clipped = join(root, "clipped.txt");
  const skipped = join(root, "skipped.txt");
  const binary = join(root, "opaque.bin");
  await writeFile(full, "a".repeat(60_000), "utf8");
  await writeFile(clipped, "b".repeat(60_000), "utf8");
  await writeFile(skipped, "c".repeat(1_000), "utf8");
  await writeFile(binary, Buffer.from([0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0x00, 0x03]));

  const context = await buildAttachmentContext([
    { kind: "file", path: full, name: "full.txt" },
    { kind: "file", path: clipped, name: "clipped.txt" },
    { kind: "file", path: skipped, name: "skipped.txt" },
    { kind: "file", path: binary, name: "opaque.bin" },
  ]);

  const [fullItem, clippedItem, skippedItem, binaryItem] = context;

  assert.equal(fullItem.load, "full");
  assert.equal(fullItem.loadedChars, 60_000);
  assert.equal(fullItem.sourceChars, 60_000);
  checks.fullyLoadedFileReportsFullCoverage = true;

  // 60_000 + 60_000 exceeds the 80_000 character budget, so the second file
  // is clipped. It must record how much of itself actually got through.
  assert.equal(clippedItem.load, "partial");
  assert.equal(clippedItem.reason, "truncated");
  assert.equal(clippedItem.loadedChars, 20_000);
  assert.equal(clippedItem.sourceChars, 60_000);
  assert.equal(clippedItem.content?.length, 20_000);
  checks.clippedFileRecordsLoadedAndSourceLength = true;

  assert.equal(skippedItem.load, "none");
  assert.equal(skippedItem.included, false);
  assert.equal(skippedItem.reason, "context-limit-exceeded");
  assert.equal(skippedItem.loadedChars, 0);
  assert.equal(skippedItem.sourceChars, 1_000);
  checks.budgetExhaustedFileRecordsZeroCoverage = true;

  assert.equal(binaryItem.load, "none");
  assert.equal(binaryItem.included, false);
  assert.equal(binaryItem.reason, "binary-file");
  checks.unreadableFileRecordsZeroCoverage = true;

  const [message] = withAttachmentContext([{ role: "user", content: "什么是默认端口？" }], context);
  const prompt = message.content;

  assert.match(prompt, /Coverage: 1 of 4 attached file\(s\) loaded in full, 1 loaded only in part, 2 not loaded at all\./);
  checks.promptStatesCoverageCounts = true;

  // The model must be told that missing text is missing from the prompt, not
  // from the user's material — otherwise it reports absence as a finding.
  assert.match(prompt, /absent from this prompt, not from the user's material/);
  assert.match(prompt, /instead of stating that the material does not contain it/);
  checks.promptForbidsTreatingGapsAsAbsence = true;

  assert.match(prompt, /Loaded: PARTIAL — only the first 20,000 of 60,000 characters are below/);
  assert.match(prompt, /Loaded: complete file/);
  checks.promptLabelsEachAttachmentLoadState = true;

  assert.match(prompt, /Attachments that were NOT loaded/);
  assert.match(prompt, /- skipped\.txt \(context-limit-exceeded\)/);
  assert.match(prompt, /- opaque\.bin \(binary-file\)/);
  checks.promptListsUnloadedAttachmentsByName = true;

  // Previously an all-unreadable attachment set produced no prompt text at
  // all, so the model never learned that the user had attached anything.
  const opaqueOnly = await buildAttachmentContext([{ kind: "file", path: binary, name: "opaque.bin" }]);
  const [opaqueMessage] = withAttachmentContext([{ role: "user", content: "读一下这个文件" }], opaqueOnly);
  assert.notEqual(opaqueMessage.content, "读一下这个文件");
  assert.match(opaqueMessage.content, /Attachments that were NOT loaded/);
  checks.fullyUnreadableAttachmentSetStillAnnounced = true;

  // Chat bubbles and stored history must still show only the user's question.
  assert.ok(prompt.includes(LOCAL_ATTACHMENT_CONTEXT_MARKER));
  assert.equal(stripAttachmentContextFromUserContent(prompt), "什么是默认端口？");
  checks.injectedBlockStaysStrippableFromHistory = true;

  const clean = await buildAttachmentContext([{ kind: "file", path: skipped, name: "skipped.txt" }]);
  const [cleanMessage] = withAttachmentContext([{ role: "user", content: "总结一下" }], clean);
  assert.match(cleanMessage.content, /Coverage: all 1 attached file\(s\) were loaded in full\./);
  assert.doesNotMatch(cleanMessage.content, /Attachments that were NOT loaded/);
  checks.completeLoadReportsNoGaps = true;

  const passed = Object.keys(checks).length;
  console.log(`Attachment context coverage passed (${passed}/${passed}; truncation, omission and absence-vs-gap disclosure).`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
