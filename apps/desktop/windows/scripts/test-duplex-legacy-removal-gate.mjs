import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const verifier = resolve(root, "scripts/verify-duplex-legacy-removal-gate.mjs");
const normal = spawnSync(process.execPath, [verifier], { cwd: root, encoding: "utf8" });
assert.equal(normal.status, 0, normal.stderr); assert.match(normal.stdout, /removalEligible=false/);
const premature = spawnSync(process.execPath, [verifier, "--request-removal"], { cwd: root, encoding: "utf8" });
assert.notEqual(premature.status, 0, "Premature code deletion must fail closed.");
console.log("Duplex Voice M10 legacy gate verified (no UI/new config, old preference fixture, rollback assets, and premature-removal rejection).");
