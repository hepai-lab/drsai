import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectWebConversationResources } from "../src/protocol/conversationResources";
import { conversationResourcePreviewFrameProps } from "../src/protocol/conversationResourcePreviewPolicy";
import { conversationResourceStateSemantics } from "../../../../cores/protocol/owop/conversationResourceStateSemantics";

const fixture = JSON.parse(await readFile(resolve(
  process.cwd(), "../../../cores/protocol/oaep/conversation-resources-p2.fixture.json",
), "utf8"));
const projection = projectWebConversationResources(fixture.snapshot);

assert.deepEqual(
  projection.resources.map((resource) => resource.associationId),
  fixture.expected_association_ids,
);
assert.equal(projection.canonical.associations[0]?.resource.resource_id,
  projection.canonical.associations[1]?.resource.resource_id);
assert.notEqual(projection.resources[0]?.associationId, projection.resources[1]?.associationId);
assert.equal(projection.canonical.associations[2]?.operation_id, "operation-publish-report");
assert.equal(projection.resources.some((resource) => /[A-Za-z]:[\\/]/.test(resource.label)), false);
const frame = conversationResourcePreviewFrameProps({
  url: "https://preview.example.test/resource/opaque-token", isolatedOrigin: "https://preview.example.test", title: "Report",
});
assert.equal(frame.sandbox, "");
assert.equal(frame.referrerPolicy, "no-referrer");
assert.equal(frame.allow, "");
assert.throws(() => conversationResourcePreviewFrameProps({
  url: "https://app.example.test/resource/token", isolatedOrigin: "https://preview.example.test", title: "Report",
}), /origin_invalid/);

const stateFixture = JSON.parse(await readFile(resolve(
  process.cwd(), "../../../cores/protocol/owop/conversation-resource-states-p2.fixture.json",
), "utf8"));
for (const vector of stateFixture.cases) {
  assert.deepEqual(conversationResourceStateSemantics(vector.descriptor), vector.expected, vector.id);
}

console.log("Web/DocMaster conversation resource P2 conformance verification passed.");
