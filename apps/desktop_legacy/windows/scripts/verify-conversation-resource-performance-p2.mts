import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  CONVERSATION_RESOURCE_DESCRIPTOR_TTL_MS,
  ConversationResourceDescriptorCache,
  visibleConversationResourceWindow,
} from "../../shared/renderer/src/conversationResourceDescriptorCache";

assert.equal(CONVERSATION_RESOURCE_DESCRIPTOR_TTL_MS, 30_000);
let now = 1_000;
let loads = 0;
const cache = new ConversationResourceDescriptorCache<{ state: string }>(30_000, () => now);
const load = async () => { loads += 1; return { state: "available" }; };
await Promise.all(Array.from({ length: 20 }, () => cache.getOrLoad("principal-a/workspace-a/authority-a", "assoc-1", load, "resource-1")));
assert.equal(loads, 1, "concurrent visible chips must share one resolve");
await cache.getOrLoad("principal-a/workspace-a/authority-a", "assoc-1", load, "resource-1");
assert.equal(loads, 1, "descriptor must remain cached for 30 seconds");
now += 30_001;
await cache.getOrLoad("principal-a/workspace-a/authority-a", "assoc-1", load, "resource-1");
assert.equal(loads, 2, "TTL expiry must resolve again");
cache.invalidateWatch("resource-1");
await cache.getOrLoad("principal-a/workspace-a/authority-a", "assoc-1", load, "resource-1");
assert.equal(loads, 3, "watch event must invalidate immediately");
cache.invalidateActionFailure("principal-a/workspace-a/authority-a", "assoc-1");
await cache.getOrLoad("principal-a/workspace-a/authority-a", "assoc-1", load, "resource-1");
assert.equal(loads, 4, "action failure must invalidate immediately");
cache.invalidateScope("principal-a/workspace-a/authority-a");
assert.equal(cache.size(), 0, "principal/workspace/authority switch must clear the old scope");

const history = Array.from({ length: 2_000 }, (_, index) => `association-${index}`);
const timings: number[] = [];
for (let index = 0; index < 1_900; index += 19) {
  const started = performance.now();
  const visible = visibleConversationResourceWindow(history, index);
  timings.push(performance.now() - started);
  assert.equal(visible.length, 100);
}
assert.throws(() => visibleConversationResourceWindow(history, 0, 101), /viewport_invalid/);
const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * .95) - 1] ?? 0;
assert(p95 < 16, `2,000-association viewport slice exceeded one frame: ${p95}ms`);
console.log(JSON.stringify({ descriptorTtlMs: 30_000, cacheLoads: loads, historyAssociations: 2_000, maxViewport: 100, viewportP95Ms: Number(p95.toFixed(3)) }));
