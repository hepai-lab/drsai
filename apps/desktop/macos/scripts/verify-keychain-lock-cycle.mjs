import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Keychain lock-cycle acceptance requires Apple Silicon macOS hardware.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keychainName = `opendrsai-acceptance-${randomUUID()}.keychain`;
const keychain = join(homedir(), "Library", "Keychains", `${keychainName}-db`);
assert.equal(existsSync(keychain), false, "Refusing to reuse an existing Keychain path");
const password = randomBytes(32).toString("base64url");
const secret = randomBytes(32).toString("base64url");
const account = randomUUID();
const service = "ai.drsai.desktop.acceptance.lock-cycle";

try {
  run(["create-keychain", "-p", password, keychainName]);
  run(["set-keychain-settings", "-lut", "300", keychain]);
  run(["add-generic-password", "-a", account, "-s", service, "-w", secret, keychain]);
  assert.equal(findSecret().status, 0, "unlocked isolated Keychain did not return its secret");
  run(["lock-keychain", keychain]);
  const locked = findSecret();
  assert.notEqual(locked.status, 0, "locked isolated Keychain unexpectedly disclosed its secret");
  assert.equal(`${locked.stdout || ""}${locked.stderr || ""}`.includes(secret), false, "locked Keychain output disclosed the fixture secret");
  run(["unlock-keychain", "-p", password, keychain]);
  const unlocked = findSecret();
  assert.equal(unlocked.status, 0, "isolated Keychain did not recover after unlock");
  assert.equal(unlocked.stdout.trim(), secret);
  run(["delete-generic-password", "-a", account, "-s", service, keychain]);
  const deleted = findSecret();
  assert.notEqual(deleted.status, 0, "deleted isolated Keychain item remained readable");
  const output = join(root, "build", "acceptance", "keychain-lock-cycle.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 2, testId: "keychain-lock-cycle", platform: "darwin-arm64", passed: true, featureIds: ["F03.1", "F03.5"], service, isolatedKeychain: true, lockedSecretRefused: true, unlockedSecretRecovered: true, deletedSecretRefused: true, secretMaterialRecorded: false, generatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("macOS isolated Keychain lock/unlock/delete acceptance passed.");
} finally {
  if (existsSync(keychain)) rmSync(keychain);
}

function findSecret() {
  return spawnSync("/usr/bin/security", ["find-generic-password", "-a", account, "-s", service, "-w", keychain], { encoding: "utf8", timeout: 30_000 });
}

function run(args) {
  const result = spawnSync("/usr/bin/security", args, { encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`security ${args[0]} failed without exposing command output`);
}
