import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceMessageDelivery,
  isUncertainRunCreateFailure,
  recoverRunCreation,
} from "../../shared/main/messageDelivery.ts";
import { SessionSyncStateStore, sessionPayloadHash } from "../../shared/main/sessionSyncState.ts";

assert.equal(advanceMessageDelivery("optimistic", "sending"), "sending");
assert.equal(advanceMessageDelivery("sending", "uncertain"), "uncertain");
assert.equal(advanceMessageDelivery("uncertain", "accepted"), "accepted");
assert.equal(advanceMessageDelivery("accepted", "running"), "running");
assert.equal(advanceMessageDelivery("running", "terminal"), "terminal");
assert.throws(() => advanceMessageDelivery("terminal", "sending"), /transition_invalid/);
assert.equal(isUncertainRunCreateFailure(Object.assign(new Error("gateway"), { status: 504 })), true);
assert.equal(isUncertainRunCreateFailure(new Error("validation failed")), false);

let createCalls = 0;
let lookupCalls = 0;
const createOnce = async () => {
  createCalls += 1;
  throw Object.assign(new Error("response lost"), { status: 504 });
};
let recovered: { run_id: string } | null = null;
try {
  await createOnce();
} catch (error) {
  assert.equal(isUncertainRunCreateFailure(error), true);
  recovered = await recoverRunCreation(async () => {
    lookupCalls += 1;
    return lookupCalls < 3 ? null : { run_id: "run-authoritative" };
  }, { delaysMs: [0, 0, 0], wait: async () => undefined });
}
assert.deepEqual(recovered, { run_id: "run-authoritative" });
assert.equal(createCalls, 1, "response-loss recovery must never repeat the create side effect");
assert.equal(lookupCalls, 3);

const root = await mkdtemp(join(tmpdir(), "p6-message-delivery-"));
try {
  const path = join(root, "session-sync.json");
  const store = new SessionSyncStateStore(path);
  const entry = {
    sourceMessageId: "desktop-message-one",
    idempotencyKey: "desktop-runtime-message-one",
    payloadHash: sessionPayloadHash({ message: "PRIVATE_MESSAGE_CANARY" }),
  };
  assert.equal((await store.beginOutbox("session-one", entry)).deliveryState, "optimistic");
  assert.equal((await store.markOutboxDelivery("session-one", entry.sourceMessageId, "sending")).deliveryState, "sending");
  assert.equal((await store.markOutboxDelivery("session-one", entry.sourceMessageId, "uncertain")).deliveryState, "uncertain");
  assert.equal((await store.attachRun("session-one", entry.sourceMessageId, "run-authoritative")).deliveryState, "accepted");

  const restarted = new SessionSyncStateStore(path);
  assert.equal((await restarted.get("session-one")).outbox?.deliveryState, "accepted");
  assert.equal((await restarted.markOutboxDelivery("session-one", entry.sourceMessageId, "running")).deliveryState, "running");
  assert.equal((await restarted.markOutboxDelivery("session-one", entry.sourceMessageId, "terminal")).deliveryState, "terminal");
  await assert.rejects(
    () => restarted.markOutboxDelivery("session-one", entry.sourceMessageId, "sending"),
    /transition_invalid/,
  );
  assert.equal(await restarted.completeOutbox("session-one", entry.sourceMessageId), true);
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("PRIVATE_MESSAGE_CANARY"), false);
} finally {
  await rm(root, { recursive: true, force: true });
}

const [chat, runtimeClient, gateway, androidRepository, androidViewModel] = await Promise.all([
  readFile(join(process.cwd(), "../shared/main/chat.ts"), "utf8"),
  readFile(join(process.cwd(), "../shared/main/runtimeClient.ts"), "utf8"),
  readFile(join(process.cwd(), "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8"),
  readFile(join(process.cwd(), "../../android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt"), "utf8"),
  readFile(join(process.cwd(), "../../android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"), "utf8"),
]);
assert.match(chat, /recoverRunCreation[\s\S]*getAgentRunByIdempotency/);
assert.match(chat, /markOutboxDelivery\(runtimeSessionId, sourceMessageId, "uncertain"\)/);
assert.match(runtimeClient, /runs\/by-idempotency\/\$\{encodeURIComponent\(idempotencyKey\)\}/);
assert.match(gateway, /runtime_run_idempotency_result/);
assert.match(androidRepository, /recoverRun[\s\S]*idempotency[\s\S]*run\.create/);
assert.match(androidViewModel, /uncertainOaepSourceMessageIds[\s\S]*runs\.recoverRun/);

console.log(JSON.stringify({
  passed: true,
  delivery_states: 7,
  create_side_effects: createCalls,
  recovery_reads: lookupCalls,
  clients: ["desktop", "android"],
  restart_recovery: true,
}));
