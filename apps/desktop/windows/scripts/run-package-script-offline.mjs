import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
const target = process.argv[2];
assert.ok(target && scripts[target], "Usage: node scripts/run-package-script-offline.mjs <package-script>");
const active = new Set();
const testHome = mkdtempSync(join(tmpdir(), "opendrsai-offline-tests-"));
const testEnvironment = { ...process.env, PATH: `${resolve(root, "../node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`, DRSAI_HOME: testHome, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" };

function run(name) {
  assert.ok(scripts[name], `Unknown package script: ${name}`);
  assert.ok(!active.has(name), `Recursive package script: ${name}`);
  active.add(name);
  try {
    for (const segment of scripts[name].split(/\s*&&\s*/)) {
      const nested = segment.match(/^npm(?:\.cmd)?\s+run\s+([\w:-]+)$/);
      if (nested) { run(nested[1]); continue; }
      console.log(`\n> ${name} :: ${segment}`);
      const result = spawnSync(segment, { cwd: root, encoding: "utf8", shell: true, stdio: "inherit", env: testEnvironment });
      assert.equal(result.status, 0, `Package script ${name} failed: ${segment}`);
    }
  } finally { active.delete(name); }
}

try { run(target); console.log(`Offline package script graph passed: ${target}`); }
finally { rmSync(testHome, { recursive: true, force: true }); }
