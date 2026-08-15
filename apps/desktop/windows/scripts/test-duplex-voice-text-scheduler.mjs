import assert from "node:assert/strict";
import { DuplexTextInputScheduler } from "../../shared/renderer/src/voice/duplex/textInputScheduler.ts";

let active = true; let interrupts = 0; const sent = []; const changes = [];
const scheduler = new DuplexTextInputScheduler({
  isResponseActive: () => active,
  interrupt: async () => { interrupts += 1; active = false; return true; },
  send: async (item) => { sent.push(item); return true; },
  onPendingChange: (item) => changes.push(item?.text ?? null),
  createId: () => "stable-item", now: () => 123,
});
assert.equal(await scheduler.submit(" after answer ", "after_response"), true);
assert.deepEqual(scheduler.pending, { id: "stable-item", text: "after answer", queuedAt: 123 });
assert.equal(sent.length, 0); assert.equal(await scheduler.submit("second", "after_response"), false);
active = false; assert.equal(await scheduler.flush(), true); assert.equal(sent[0].text, "after answer");
active = true; assert.equal(await scheduler.submit("interrupt", "interrupt_now"), true);
assert.equal(interrupts, 1); assert.equal(sent[1].text, "interrupt");

active = true;
assert.equal(await scheduler.submit("restore me", "after_response"), true);
assert.equal(scheduler.cancel()?.text, "restore me"); assert.equal(scheduler.pending, null);
assert.deepEqual(changes, ["after answer", null, "restore me", null]);

let attempts = 0;
const retry = new DuplexTextInputScheduler({ isResponseActive: () => true, interrupt: async () => true, send: async () => ++attempts > 1, createId: () => "retry" });
assert.equal(await retry.submit("kept", "after_response"), true);
assert.equal(await retry.flush(), false); assert.equal(retry.pending?.text, "kept");
assert.equal(await retry.flush(), true); assert.equal(retry.pending, null);

let generatedItem;
const productionIdentity = new DuplexTextInputScheduler({ isResponseActive: () => false, interrupt: async () => true, send: async (item) => { generatedItem = item; return true; } });
assert.equal(await productionIdentity.submit("provider-bound", "after_response"), true); assert.match(generatedItem.id, /^t-[a-f0-9]{24}$/); assert.ok(generatedItem.id.length <= 32, "the default item ID must fit the live Provider limit while retaining 96 random bits");

console.log("Duplex text scheduler verified (default defer, explicit interruption, single-slot race control, cancellation restoration, and failed-send retry).");
