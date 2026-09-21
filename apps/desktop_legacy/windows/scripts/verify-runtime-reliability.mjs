import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const module = await import(pathToFileURL(resolve(root, "src/main/runtimeReliability.ts")).href);

const clockRandom = () => 0.5;
const backoff = new module.ReconnectBackoff({ baseDelayMs: 1000, maxDelayMs: 30_000, maxWindowMs: 180_000, jitterRatio: 0.2, random: clockRandom });
const delays = [];
let now = 0;
for (;;) {
  const next = backoff.next(now);
  if (next.exhausted) break;
  delays.push(next.delayMs); now += next.delayMs;
}
assert.deepEqual(delays.slice(0, 6), [1000, 2000, 4000, 8000, 16000, 30000]);
assert(now <= 180_000 && delays.at(-1) === 30_000);
backoff.reset();
assert.equal(backoff.next(500_000).attempt, 1);

assert.equal(module.classifyRemoteFailure(false, false), "ssh");
assert.equal(module.classifyRemoteFailure(false, true), "runtime");
assert.equal(module.classifyRemoteFailure(true, true), undefined);

const tracker = new module.RuntimeInstanceTracker();
assert.equal(tracker.observe("runtime-1", "instance-1"), "initial");
assert.equal(tracker.observe("runtime-1", "instance-1"), "unchanged");
assert.equal(tracker.observe("runtime-1", "instance-2"), "restarted");
assert.equal(tracker.generation, 2);
assert.throws(() => tracker.observe("runtime-other", "instance-3"), /identity changed/);

const events = new module.RuntimeEventAccumulator();
assert.deepEqual(events.accept([
  { event_id: "event-1", sequence: 1 },
  { event_id: "event-2", sequence: 2 },
]), [{ event_id: "event-1", sequence: 1 }, { event_id: "event-2", sequence: 2 }]);
assert.deepEqual(events.accept([{ event_id: "event-2", sequence: 2 }, { event_id: "event-3", sequence: 3 }]), [{ event_id: "event-3", sequence: 3 }]);
assert.equal(events.afterSequence, 3);
assert.deepEqual(events.accept([{ event_id: "event-5", sequence: 5 }]), []);
assert.equal(events.afterSequence, 3);
assert.deepEqual(events.accept([{ event_id: "event-4", sequence: 4 }, { event_id: "event-5", sequence: 5 }]), [
  { event_id: "event-4", sequence: 4 },
  { event_id: "event-5", sequence: 5 },
]);
assert.equal(events.afterSequence, 5);
assert.throws(() => events.accept([{ event_id: "event-other", sequence: 5 }]), /reused/);

console.log("Runtime reliability policy verification passed.");
