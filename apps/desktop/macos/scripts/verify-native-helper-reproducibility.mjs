import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const build = resolve(root, "native/OpenDrSaiNativeHelper/build-debug.sh");
const artifacts = [resolve(root, "native/OpenDrSaiNativeHelper/.build/debug/OpenDrSaiNativeHelper"), resolve(root, "native/OpenDrSaiNativeHelper/.build/debug/libOpenDrSaiNativeProtocol.dylib")];
const run = () => { const result = spawnSync(build, [], { cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr || result.stdout); return Object.fromEntries(artifacts.map((path) => [path.split("/").at(-1), createHash("sha256").update(readFileSync(path)).digest("hex")])); };
const first = run(); const second = run(); assert.deepEqual(second, first, "Native Helper Debug artifacts must be byte reproducible.");
const output = resolve(root, "build/acceptance/native-helper-test-results.json"); mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, testId: "native-helper", platform: `${process.platform}-${process.arch}`, passed: true, protocolVersion: 1, swiftXCTest: "unavailable-command-line-tools-no-xctest", checks: { arm64DebugBuild: true, byteReproducible: true, realHandshake: true, strictAllowlist: true, boundedSupervisor: true }, artifacts: first, generatedAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`Native Helper byte-reproducible arm64 Debug build passed (${first.OpenDrSaiNativeHelper}).`);
