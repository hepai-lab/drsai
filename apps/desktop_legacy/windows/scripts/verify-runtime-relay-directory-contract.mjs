import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRelayRuntimeDirectoryPage } from "../../shared/api/runtimeRelay.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const fixture = JSON.parse(readFileSync(
  join(root, "cores/protocol/relay/runtime-directory-fixtures.json"),
  "utf8",
));
const page = parseRelayRuntimeDirectoryPage(fixture.runtime_list);
const runtime = page.items.at(0);

assert.equal(runtime.runtime.runtime_id, "runtime-fixture");
assert.equal(runtime.runtime.status, "online");
assert.equal(runtime.runtime.connection_generation, 7);
assert.equal(runtime.display_name, "Fixture Windows");
assert.deepEqual(runtime.capabilities, ["workspace.list", "session.list"]);
assert.equal(JSON.stringify(page).includes("path"), false);

assert.throws(
  () => parseRelayRuntimeDirectoryPage({
    ...fixture.runtime_list,
    items: [{ ...fixture.runtime_list.items[0], path: "C:\\private" }],
  }),
  /relay_runtime_summary_invalid/,
);

console.log("Runtime Relay directory TypeScript fixture passed.");
