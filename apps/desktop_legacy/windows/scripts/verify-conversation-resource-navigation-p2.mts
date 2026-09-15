import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalConversationResourceJson,
  projectOaepConversationResources,
} from "../../../../cores/protocol/oaep/conversationResourceProjection";
import { conversationResourceStateSemantics } from "../../../../cores/protocol/owop/conversationResourceStateSemantics";

const fixture = JSON.parse(await readFile(resolve(
  process.cwd(),
  "../../../cores/protocol/oaep/conversation-resources-p2.fixture.json",
), "utf8"));
const projection = projectOaepConversationResources(fixture.snapshot);
assert.deepEqual(projection.associations.map((value) => value.association_id), fixture.expected_association_ids);
assert.deepEqual(projection.partsByItem["message-resource-p2"]?.map((value) => value.type), fixture.expected_message_part_types);
assert.deepEqual(projection.associations[0]?.resource, projection.associations[1]?.resource);
assert.notDeepEqual(projection.associations[0]?.locator, projection.associations[1]?.locator);
assert.equal(projection.associations[2]?.operation_id, "operation-publish-report");
assert.doesNotMatch(canonicalConversationResourceJson(projection), /[A-Za-z]:[\\/]/);

const unsafe = structuredClone(fixture.snapshot);
unsafe.items[0].content.parts.push({ part_id: "part-unknown", type: "future_object", opaque: { secret: true } });
const unsupported = projectOaepConversationResources(unsafe);
assert.equal(unsupported.partsByItem["message-resource-p2"].at(-1)?.type, "unsupported");
assert.equal(canonicalConversationResourceJson(unsupported).includes("secret"), false);

const forwardCompatible = structuredClone(fixture.snapshot);
forwardCompatible.items[0].associations[0].future_display_hint = { density: "compact" };
forwardCompatible.items[0].associations[0].version_snapshot.future_cache_hint = 30;
const forwardProjection = projectOaepConversationResources(forwardCompatible);
assert.equal(forwardProjection.associations.length, fixture.expected_association_ids.length);
assert.equal("future_display_hint" in forwardProjection.associations[0], false);
assert.equal("future_cache_hint" in forwardProjection.associations[0].version_snapshot, false);
forwardCompatible.items[0].associations[0].relation = "future_required_relation";
assert.equal(projectOaepConversationResources(forwardCompatible).associations.length, fixture.expected_association_ids.length - 1);

for (const mutate of [
  (association: Record<string, any>) => { association.label_snapshot = `<img src=x onerror=alert(1)>${"x".repeat(513)}`; },
  (association: Record<string, any>) => { association.version_snapshot.mime_type = `text/plain${"x".repeat(257)}`; },
  (association: Record<string, any>) => { association.locator = { kind: "sheet_cell", sheet: "s".repeat(256), cell: "A1" }; },
]) {
  const malicious = structuredClone(fixture.snapshot);
  mutate(malicious.items[0].associations[0]);
  const rejected = projectOaepConversationResources(malicious);
  assert.equal(rejected.associations.some((association) => association.association_id === "association-plan-first"), false);
  assert.equal(rejected.diagnostics.some((diagnostic) => diagnostic.code === "association_invalid"), true);
}

const stateFixture = JSON.parse(await readFile(resolve(
  process.cwd(), "../../../cores/protocol/owop/conversation-resource-states-p2.fixture.json",
), "utf8"));
for (const vector of stateFixture.cases) {
  assert.deepEqual(conversationResourceStateSemantics(vector.descriptor), vector.expected, vector.id);
}

console.log("Conversation resource navigation P2 conformance verification passed.");
