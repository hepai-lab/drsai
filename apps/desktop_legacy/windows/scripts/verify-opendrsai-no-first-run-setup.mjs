import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const shared = resolve(import.meta.dirname, "../../shared");
const appPath = resolve(shared, "renderer/src/App.tsx");
const stylesPath = resolve(shared, "renderer/src/styles.css");
const app = readFileSync(appPath, "utf8");
const styles = readFileSync(stylesPath, "utf8");

for (const retiredPath of [
  "api/firstRunSetup.ts",
  "renderer/src/components/FirstRunSetup.tsx",
  "renderer/src/containers/SetupContainer.tsx",
]) {
  assert.equal(existsSync(resolve(shared, retiredPath)), false, `${retiredPath} must remain retired`);
}

assert.doesNotMatch(app, /FirstRunSetup|SetupContainer|deriveFirstRunSetup|first-run-complete|first-run-draft/);
assert.doesNotMatch(styles, /\.first-run-setup\b/);
assert.match(app, /mainContent=\{mainContent\}/, "authenticated users must enter the normal application shell directly");

console.log(JSON.stringify({
  ok: true,
  schema: "opendrsai.no-first-run-setup/1",
  authenticatedEntry: "application-shell",
  retiredModules: 3,
}, null, 2));
