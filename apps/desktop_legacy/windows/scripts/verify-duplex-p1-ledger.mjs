import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../..");
const [plan, ledger, pkg] = await Promise.all([
  readFile(resolve(root, "docs/voice/duplex-voice-p1-development-plan.md"), "utf8"),
  readFile(resolve(root, "docs/voice/duplex-voice-p1-progress.md"), "utf8"),
  readFile(resolve(root, "apps/desktop/windows/package.json"), "utf8").then(JSON.parse),
]);
const ids = [...new Set(plan.match(/M\d+-F\d+/g) ?? [])]; assert.equal(ids.length, 68, "Development plan must retain all 68 feature IDs.");
const states = new Map();
for (const line of ledger.split(/\r?\n/)) { const match = line.match(/^\| (M\d+-F\d+) \| (已验收|部分完成|待实施) \|/); if (match) { assert.equal(states.has(match[1]), false, `Duplicate ledger row: ${match[1]}`); states.set(match[1], match[2]); } }
assert.deepEqual([...states.keys()].sort(), [...ids].sort(), "Ledger must have exactly one authoritative row for every planned feature.");
const totals = { 已验收: 0, 部分完成: 0, 待实施: 0 }; for (const state of states.values()) totals[state] += 1;
assert.deepEqual(totals, { 已验收: 8, 部分完成: 60, 待实施: 0 }); assert.match(ledger, /\| 完成百分比 \| 11\.76% \|/);
for (const script of ["test:voice:duplex", "test:voice:duplex-release", "verify:voice:duplex-packaged", "verify:voice:duplex-live", "verify:voice:duplex-hardware"]) assert.ok(pkg.scripts[script], `Missing release script ${script}`);
assert.match(pkg.scripts["test:voice:duplex-release"], /test:voice:serial.*test:voice:duplex/, "Serial must precede Duplex.");
console.log("Duplex Voice P1 ledger verified (68/68 rows, 8 accepted, 60 partial, 0 pending, and all release gates wired).")
