import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Keychain lock-cycle acceptance requires Apple Silicon macOS hardware.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync("/private/tmp/opendrsai-keychain-cycle-");
const keychain = join(fixture, "fixture.keychain-db");
const probe = join(fixture, "keychain-noninteractive-probe");
const probeSource = join(root, "scripts", "helpers", "keychain-noninteractive-probe.swift");
const password = randomBytes(32).toString("base64url");
const secret = randomBytes(32).toString("base64url");
const account = randomUUID();
const service = "ai.drsai.desktop.acceptance.lock-cycle";

try {
  run("/usr/bin/xcrun", ["swiftc", "-O", probeSource, "-o", probe]);
  const execution = spawnSync(probe, [keychain, account, service], {
    input: JSON.stringify({ password, secret }),
    encoding: "utf8",
    timeout: 30_000,
  });
  if (execution.error || execution.status !== 0) throw new Error("non-interactive Keychain lifecycle probe failed without exposing command output");
  let result;
  try { result = JSON.parse(execution.stdout); } catch { throw new Error("non-interactive Keychain lifecycle probe returned malformed output"); }
  assert.equal(result.passed, true, `non-interactive Keychain lifecycle failed at status ${JSON.stringify(result)}`);
  const output = join(root, "build", "acceptance", "keychain-lock-cycle.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 2,
    testId: "keychain-lock-cycle",
    platform: "darwin-arm64",
    passed: true,
    featureIds: ["F03.1", "F03.5"],
    service,
    isolatedKeychain: true,
    authenticationUiDisabled: true,
    lockedStatus: result.lockedReadStatus,
    lockedSecretRefused: true,
    unlockedSecretRecovered: true,
    deletedSecretRefused: true,
    secretMaterialRecorded: false,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("macOS isolated Keychain lock/unlock/delete acceptance passed without UI.");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed without exposing command output`);
  return result;
}
