import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionSyncStateStore,
  sessionPayloadHash,
} from "../../shared/main/sessionSyncState.ts";

const root = await mkdtemp(join(tmpdir(), "opendrsai-session-sync-"));
try {
  const path = join(root, "session-sync-state.json");
  const store = new SessionSyncStateStore(path);
  const sessionId = "session-one";
  await Promise.all([9, 2, 15, 7, 15].map((cursor) => store.advanceCursor(sessionId, cursor)));
  assert.equal((await store.get(sessionId)).cursor, 15, "cursor must never move backwards");

  const message = "SESSION_SYNC_PRIVATE_MESSAGE_CANARY";
  const pending = {
    sourceMessageId: "desktop-request-one",
    idempotencyKey: "desktop-runtime-request-one",
    payloadHash: sessionPayloadHash({ message }),
  };
  const first = await store.beginOutbox(sessionId, pending);
  assert.deepEqual(await store.beginOutbox(sessionId, pending), first, "same semantic retry must reuse outbox");
  await assert.rejects(
    () => store.beginOutbox(sessionId, { ...pending, sourceMessageId: "desktop-request-two" }),
    /awaiting Runtime acknowledgement/,
  );
  await store.attachRun(sessionId, pending.sourceMessageId, "run-one");

  const restarted = new SessionSyncStateStore(path);
  const recovered = await restarted.get(sessionId);
  assert.equal(recovered.cursor, 15);
  assert.equal(recovered.outbox?.runId, "run-one");
  assert.equal(await restarted.completeOutbox(sessionId, pending.sourceMessageId), true);
  assert.equal((await restarted.get(sessionId)).outbox, undefined);

  const persisted = await readFile(path, "utf8");
  assert(!persisted.includes(message), "outbox must persist only a semantic hash, never message plaintext");
  assert(!persisted.includes("token="), "outbox must not become a credential cache");

  const chatSource = await readFile(join(process.cwd(), "../shared/main/chat.ts"), "utf8");
  assert(chatSource.includes('agentDefinition: "codex@1" | "opendrsai@1"'));
  assert(chatSource.includes('isCodexBackend ? "codex@1" : "opendrsai@1"'));
  assert(chatSource.includes('sourceClient: "windows"'));
  assert(chatSource.includes("sessionSyncState.beginOutbox"));
  assert(
    !chatSource.includes('/v1/chat/completions'),
    "local Desktop agents must not bypass Runtime create_run semantics",
  );
  console.log("Session sync cursor/outbox verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
