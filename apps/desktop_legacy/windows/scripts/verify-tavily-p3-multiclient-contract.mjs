import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(repository, path), "utf8");
const fixture = JSON.parse(read("cores/protocol/web-search/managed-web-search-v1.json"));
const core = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/hai_tavily.py");
const desktop = read("apps/desktop/shared/renderer/src/userFacingErrors.ts");
const tui = read("apps/ui-tui/src/webSearchContract.ts");
const android = read("apps/android/app/src/main/java/ai/drsai/remote/remote/data/WebSearchContract.kt");

assert.equal(fixture.schema, "opendrsai.web-search/1");
assert.equal(fixture.model, "hepai/tavily-web-search-v1");
assert.deepEqual(fixture.functions, ["search", "extract"]);
assert.deepEqual(fixture.provider_modes, ["auto", "managed", "byok", "none"]);
assert.equal(fixture.errors.length, 13);

for (const { code, retryable, action } of fixture.errors) {
  assert.match(core, new RegExp(`\\b${code}\\b`), `Core omits ${code}`);
  assert.match(tui, new RegExp(`['\"]${code}['\"]`), `TUI omits ${code}`);
  assert.match(android, new RegExp(`\"${code}\"`), `Android omits ${code}`);
  if (code !== "invalid_request") assert.match(desktop, new RegExp(`\\b${code}\\b`), `Desktop UX omits ${code}`);
  const tuiEntry = new RegExp(`${code}: \\{ retryable: ${retryable}, action: ['\"]${action}['\"] \\}`);
  assert.match(tui, tuiEntry, `TUI recovery semantics drifted for ${code}`);
}

assert.match(android, /quota_exhausted" to WebSearchRecovery\(false, WebSearchRecoveryAction\.ACCOUNT_OR_BYOK\)/);
assert.match(android, /provider_quota_exhausted" to WebSearchRecovery\(false, WebSearchRecoveryAction\.CONTACT_ADMIN\)/);
assert.doesNotMatch(desktop + tui + android, /tvly-[A-Za-z0-9]/);
console.log(`Tavily P3 multi-client contract passed (Desktop, TUI, Android; ${fixture.errors.length} errors).`);
