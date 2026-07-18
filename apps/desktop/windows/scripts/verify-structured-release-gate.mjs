import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requiredScripts = [
  "verify:structured-conversation",
  "verify:structured-gateway",
  "verify:structured-renderer",
  "verify:structured-debug",
  "verify:structured-quality",
  "verify:structured-integration",
  "verify:structured-visual",
];
for (const name of requiredScripts) {
  assert.equal(typeof pkg.scripts[name], "string", `Missing ${name}`);
  assert.ok(pkg.scripts.verify.includes(`npm run ${name}`), `${name} is not in the default verify chain.`);
}
for (const fixture of [
  "structured-conversation.json",
  "structured-sidebar-routes.json",
  "structured-failure-events.json",
]) {
  JSON.parse(readFileSync(join(root, "scripts/fixtures", fixture), "utf8"));
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "passed",
  gates: requiredScripts,
  fixtures: ["conversation", "sidebar-routes", "failure-events"],
  note: "This report is emitted only after the preceding structured checks in npm run verify have passed.",
};
const reportDirectory = join(root, "out", "verification");
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(join(reportDirectory, "structured-conversation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("Structured release gate passed; report written to out/verification/structured-conversation-report.json.");
