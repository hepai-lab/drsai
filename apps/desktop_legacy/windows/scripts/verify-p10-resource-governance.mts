import assert from "node:assert/strict";
import { ThreadSnapshotEnvelopeCache } from "../../shared/main/threadSnapshotEnvelopeCache";
import { ThreadSnapshotStore } from "../../shared/renderer/src/threadSnapshotStore";

const snapshot = (threadId: string, text = "x") => ({
  threadId, title: threadId, messages: [{ id: `${threadId}-m`, role: "assistant", content: text }],
  status: "completed", updatedAt: 1,
}) as never;
const envelope = (threadId: string, text = "x") => ({
  version: 1, projection: "oaep/1", threadId, runtimeSessionId: `session-${threadId}`,
  sessionSequence: 1, generation: 1, snapshot: snapshot(threadId, text), source: "runtime",
}) as never;

const main = new ThreadSnapshotEnvelopeCache(128, 512 * 1024, 60_000);
main.pin("active");
main.set("active", envelope("active", "active"));
for (let index = 0; index < 10_000; index += 1) main.set(`thread-${index}`, envelope(`thread-${index}`, "x".repeat(64)));
assert(main.get("active"), "active Main-process snapshot must survive churn");
assert(main.diagnostics().entries <= 128, JSON.stringify(main.diagnostics()));
assert(main.diagnostics().bytes <= 512 * 1024, JSON.stringify(main.diagnostics()));
main.unpin("active");

const renderer = new ThreadSnapshotStore({}, 128, 512 * 1024, 60_000);
let notifications = 0;
const unsubscribe = renderer.subscribe("active", () => { notifications += 1; });
renderer.set("active", snapshot("active", "active"));
for (let index = 0; index < 10_000; index += 1) renderer.set(`thread-${index}`, snapshot(`thread-${index}`, "x".repeat(64)));
assert(renderer.get("active"), "subscribed Renderer snapshot must survive churn");
assert(renderer.diagnostics().sessions <= 128, JSON.stringify(renderer.diagnostics()));
assert(renderer.diagnostics().bytes <= 512 * 1024, JSON.stringify(renderer.diagnostics()));
assert.equal(notifications, 1, "unrelated session churn must not notify the active selector");
unsubscribe();

for (let index = 0; index < 1_000; index += 1) {
  const stop = renderer.subscribe(`switch-${index}`, () => undefined);
  stop();
}
assert.equal(renderer.diagnostics().subscribers, 0, "1,000 task switches must return listeners to baseline");
console.log("P10 resource governance verification passed.", { main: main.diagnostics(), renderer: renderer.diagnostics() });
