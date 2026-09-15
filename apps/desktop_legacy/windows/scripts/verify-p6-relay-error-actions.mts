import assert from "node:assert/strict";
import {
  RELAY_ERROR_ACTIONS,
  relayErrorAction,
} from "../../shared/api/runtimeRelayErrorActions.generated.ts";
import { relayActionableError } from "../../shared/api/runtimeRelay.ts";

const expected = new Set(["retry", "login", "re-pair", "update", "contact-admin"]);
assert.deepEqual(new Set(Object.values(RELAY_ERROR_ACTIONS)), expected);

for (const [code, action] of Object.entries(RELAY_ERROR_ACTIONS)) {
  assert.equal(relayErrorAction(code), action);
  const presentation = relayActionableError(code);
  assert.equal(presentation.action, action);
  assert.ok(presentation.title.length > 0);
  assert.ok(presentation.reason.length > 0);
  assert.ok(presentation.actionLabel.length > 0);
  const serialized = JSON.stringify(presentation).toLowerCase();
  assert.equal(serialized.includes("http"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(serialized.includes("\\"), false);
}

assert.equal(relayErrorAction("future_transient", true), "retry");
assert.equal(relayErrorAction("future_permanent"), "contact-admin");
assert.equal(relayActionableError("future_permanent").action, "contact-admin");

console.log(JSON.stringify({ passed: true, codes: Object.keys(RELAY_ERROR_ACTIONS).length, actions: expected.size }));
