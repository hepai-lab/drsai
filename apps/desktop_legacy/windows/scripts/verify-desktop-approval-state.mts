import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopApprovalStateStore } from "../src/main/desktopApprovalState.ts";
import { protectDesktopApprovalPayload, unprotectDesktopApprovalPayload } from "../src/main/desktopApprovalPayloadProtection.ts";
import { writeDurableJson } from "../../shared/main/durableJsonStore.ts";
import { decideMcpAtMostOnce, recoverAmbiguousMcpApproval } from "../src/main/mcpApprovalRecovery.ts";

const fakeCredentials = {
  available: () => true,
  protect: (secret: string) => `cipher:${Buffer.from(secret).toString("base64")}`,
  unprotect: (ciphertext: string | undefined) => ciphertext?.startsWith("cipher:")
    ? Buffer.from(ciphertext.slice(7), "base64").toString("utf8") : undefined,
};
const secretRequest = { adapterId: "slack-chat", body: "reviewed secret body", target: "C012345" };
assert.equal(decideMcpAtMostOnce(false, true), "execute");
assert.equal(decideMcpAtMostOnce(false, false), "reject");
assert.equal(decideMcpAtMostOnce(true, true), "acknowledge", "recovered executing intent must acknowledge without replay");
assert.equal(decideMcpAtMostOnce(true, false), "keep", "ambiguous intent cannot be reclassified as a pre-execution rejection");
const protectedEnvelope = protectDesktopApprovalPayload(fakeCredentials, secretRequest);
assert(protectedEnvelope && !JSON.stringify(protectedEnvelope).includes(secretRequest.body), "protected envelope must not expose request plaintext");
assert.deepEqual(unprotectDesktopApprovalPayload(fakeCredentials, protectedEnvelope), secretRequest, "valid protected payload must restore exactly");
assert.equal(unprotectDesktopApprovalPayload(fakeCredentials, { protectedPayload: "damaged" }), null, "damaged ciphertext must fail closed");
assert.equal(protectDesktopApprovalPayload({ ...fakeCredentials, protect: () => undefined }, secretRequest), null, "locked credential storage must not fall back to plaintext");
assert.equal(protectDesktopApprovalPayload(fakeCredentials, { body: "x".repeat(700_000) }), null, "oversized sensitive payload must fail closed");
assert(protectDesktopApprovalPayload(fakeCredentials, { draft: "x".repeat(500_000) }), "the existing maximum conflict draft must remain restart-recoverable");

const root = await mkdtemp(join(tmpdir(), "drsai-windows-approvals-"));
try {
  const boundedWriteFile = join(root, "bounded-write.json");
  await writeDurableJson(boundedWriteFile, { value: "committed" }, { maxBytes: 1024 });
  const committedPrimary = await readFile(boundedWriteFile, "utf8");
  const committedBackup = await readFile(`${boundedWriteFile}.bak`, "utf8");
  await assert.rejects(() => writeDurableJson(boundedWriteFile, { value: "界".repeat(100) }, { maxBytes: 64 }), /write limit/, "UTF-8 byte size, not JavaScript character count, must gate writes");
  assert.equal(await readFile(boundedWriteFile, "utf8"), committedPrimary, "rejected oversized writes must not replace the committed primary");
  assert.equal(await readFile(`${boundedWriteFile}.bak`, "utf8"), committedBackup, "rejected oversized writes must not replace the committed backup");
  await assert.rejects(() => writeDurableJson(boundedWriteFile, {}, { maxBytes: 0 }), /positive safe integer/);
  const file = join(root, "approvals.json");
  const approval = { id: `approval:${"a".repeat(64)}`, source: "shell" as const, actionKind: "shell.command", title: "Run command", detail: "Execute reviewed command", createdAt: "2026-07-22T00:00:00.000Z", risk: "high" as const };
  const recoveredMcpCard = recoverAmbiguousMcpApproval(approval, { workspacePath: root, server: "fixture", tool: "external_write" }); assert.equal(recoveredMcpCard.executionState, "ambiguous"); assert.match(recoveredMcpCard.title, /external_write/);
  const browserApproval = { ...approval, id: "browser_task:task-1:action-1", source: "browser_task" as const };
  const executionRequest = { workspacePath: "C:\\repo", message: "reviewed execution secret" };
  const executionEnvelope = protectDesktopApprovalPayload(fakeCredentials, executionRequest);
  assert(executionEnvelope);
  const payload = { approvalId: approval.id, kind: "git_commit" as const, value: executionEnvelope };
  const reviewEnvelope = protectDesktopApprovalPayload(fakeCredentials, { ...approval, detail: "shell command with private-token-123" });
  assert(reviewEnvelope);
  const reviewPayload = { approvalId: approval.id, kind: "approval_review" as const, value: reviewEnvelope };
  const store = new DesktopApprovalStateStore(file);
  await store.save([approval, browserApproval], [approval.id], [payload, reviewPayload, { ...payload, approvalId: browserApproval.id }]);
  const loaded = await new DesktopApprovalStateStore(file).load();
  assert.deepEqual(loaded.pending.map((item) => item.id), [approval.id], "Browser approvals remain owned by BrowserTaskService and must not be restored as orphaned actions");
  assert.deepEqual(loaded.executed.map((item) => item.id), [approval.id]);
  assert.deepEqual(loaded.payloads, [payload, reviewPayload], "execution and encrypted review payloads for one approval must survive without overwriting each other");
  assert.equal(loaded.pending[0]?.title, "Protected pending external approval", "all reviews with protected envelopes must persist only a generic card");
  assert(!(await readFile(file, "utf8")).includes("private-token-123"), "full approval review details must not enter the primary JSON file");
  assert(!(await readFile(`${file}.bak`, "utf8")).includes("private-token-123"), "full approval review details must not enter backup history");
  assert.equal(JSON.parse(await readFile(`${file}.bak`, "utf8")).schemaVersion, 3);
  assert(!(await readFile(file, "utf8")).includes("execution secret"), "v3 execution payloads must be encrypted in the primary store");

  await writeFile(file, JSON.stringify({ pending: null, executed: null }));
  const recovered = await new DesktopApprovalStateStore(file).load();
  assert.equal(recovered.pending[0]?.id, approval.id, "schema-invalid primary state must recover pending approvals from backup");
  assert.equal(recovered.executed[0]?.id, approval.id, "executed idempotency history must survive restart recovery");
  assert.deepEqual(recovered.payloads, [payload, reviewPayload], "restart recovery must retain both execution and encrypted review descriptors");

  const filteredFile = join(root, "filtered.json");
  await writeFile(filteredFile, JSON.stringify({
    schemaVersion: 2,
    pending: [approval, browserApproval], executed: [],
    payloads: [{ approvalId: approval.id, kind: "git_commit", value: executionRequest }, { ...payload, approvalId: "orphan" }, { approvalId: approval.id, kind: "mcp_tool_execution", value: executionRequest }],
  }));
  const filtered = await new DesktopApprovalStateStore(filteredFile).load();
  assert.deepEqual(filtered.pending.map((item) => item.id), [approval.id], "crafted Browser approvals must be rejected on read, not only on save");
  assert.deepEqual(filtered.payloads, [{ approvalId: approval.id, kind: "git_commit", value: executionRequest }], "v2 safe plaintext may migrate, while orphaned and sensitive plaintext kinds fail closed");

  const injectedV3File = join(root, "injected-v3.json");
  await writeFile(injectedV3File, JSON.stringify({ schemaVersion: 3, pending: [approval], executed: [], payloads: [{ approvalId: approval.id, kind: "git_commit", value: executionRequest }] }));
  assert.deepEqual((await new DesktopApprovalStateStore(injectedV3File).load()).payloads, [], "v3 plaintext execution payload injection must fail closed");

  const protectedApproval = { ...approval, id: `approval:${"c".repeat(64)}`, source: "connector" as const, actionKind: "external.service", detail: secretRequest.body, target: secretRequest.target };
  const protectedPayload = { approvalId: protectedApproval.id, kind: "channel_outbound" as const, value: protectedEnvelope };
  await store.save([protectedApproval], [], [protectedPayload]);
  const protectedState = await store.load();
  assert.deepEqual(protectedState.payloads, [protectedPayload], "bounded encrypted sensitive payload envelopes must survive restart");
  assert.equal(protectedState.pending[0]?.title, "Protected pending external approval", "persisted sensitive approval cards must contain only a generic review summary");
  assert.equal(protectedState.pending[0]?.target, undefined, "sensitive approval targets must not leak outside the encrypted envelope");
  const protectedRaw = await readFile(file, "utf8");
  assert(!protectedRaw.includes("reviewed secret body"), "sensitive request plaintext must never enter the approval JSON store");
  assert(!(await readFile(`${file}.bak`, "utf8")).includes("reviewed secret body"), "backup history must never receive a pre-encryption approval card");

  const ambiguousApproval = { ...protectedApproval, id: `approval:${"d".repeat(64)}`, executionState: "ambiguous" as const };
  const ambiguousPayload = { ...protectedPayload, approvalId: ambiguousApproval.id, kind: "mcp_tool_execution" as const };
  await store.save([ambiguousApproval], [ambiguousApproval.id], [ambiguousPayload]);
  const ambiguousState = await store.load();
  assert.equal(ambiguousState.pending[0]?.executionState, "ambiguous", "protected pending cards must preserve the non-sensitive ambiguous execution state across restart");
  assert.equal(ambiguousState.executed[0]?.id, ambiguousApproval.id, "ambiguous MCP intent must remain in executed-at-most-once history");

  await Promise.all([
    store.save([approval], [approval.id], [payload, reviewPayload]),
    store.save([], [approval.id, `approval:${"b".repeat(64)}`]),
  ]);
  assert.equal((await store.load()).executed.length, 2, "serialized saves must not expose a partial state");

  await store.save([approval], [approval.id], [payload, reviewPayload]);
  const limitedStore = new DesktopApprovalStateStore(file, 64 * 1024);
  await writeFile(file, "x".repeat(64 * 1024 + 1));
  assert.equal((await limitedStore.load()).pending[0]?.id, approval.id, "oversized primary must be rejected before parsing and recover from a bounded backup");
  await writeFile(`${file}.bak`, "x".repeat(64 * 1024 + 1));
  assert.deepEqual(await limitedStore.load(), { schemaVersion: 3, pending: [], executed: [], payloads: [] }, "oversized primary and backup must fail closed to an empty state");
  await assert.rejects(() => new DesktopApprovalStateStore(file, 0).load(), /positive safe integer/, "invalid limits must be rejected as programmer errors");
  const missing = await new DesktopApprovalStateStore(join(root, "missing.json")).load();
  assert.deepEqual(missing, { schemaVersion: 3, pending: [], executed: [], payloads: [] });
  console.log("Windows desktop approval persistence, payload recovery, backup recovery, owner filtering and serialized writes passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
