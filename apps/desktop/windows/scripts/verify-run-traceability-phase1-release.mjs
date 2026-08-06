import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const ledgerPath = resolve(
  repoRoot,
  "docs/desktop/evidence/agent-runtime-traceability-phase1-acceptance-ledger.json",
);
const fixturePath = resolve(
  repoRoot,
  "docs/desktop/evidence/agent-runtime-traceability-phase1-fixtures.json",
);
const windowsE2eResultPath = resolve(
  repoRoot,
  "docs/desktop/evidence/agent-runtime-traceability-phase1-windows-e2e-result.json",
);
const attestationPath = resolve(
  repoRoot,
  "docs/desktop/evidence/agent-runtime-traceability-phase1-release-attestation.json",
);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const expectedFeatureIds = Object.entries({
  M01: 4,
  M02: 6,
  M03: 6,
  M04: 5,
  M05: 4,
  M06: 7,
  M07: 5,
  M08: 4,
  M09: 4,
}).flatMap(([moduleId, count]) =>
  Array.from({ length: count }, (_, index) => `${moduleId}-${String(index + 1).padStart(2, "0")}`),
);

function validateRelativeEvidencePath(path, featureId) {
  assert.equal(typeof path, "string", `${featureId}: evidence path must be a string`);
  assert.ok(path.length > 0, `${featureId}: evidence path must not be empty`);
  assert.ok(!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(path), `${featureId}: evidence path must be repository-relative`);
  assert.ok(existsSync(resolve(repoRoot, path)), `${featureId}: missing evidence path ${path}`);
}

function validateLedger(ledger) {
  assert.equal(ledger.schema_version, "opendrsai.acceptance-ledger/2");
  assert.equal(ledger.release_gate, "fail_closed");
  assert.ok(existsSync(resolve(repoRoot, ledger.plan)), "acceptance plan is missing");
  assert.equal(ledger.features?.length, 45, "release requires exactly 45 feature records");
  const actualIds = ledger.features.map((feature) => feature.id);
  assert.equal(new Set(actualIds).size, actualIds.length, "feature ids must be unique");
  assert.deepEqual([...actualIds].sort(), [...expectedFeatureIds].sort(), "feature ledger is incomplete");
  const expectedCommands = ["backend", "desktop_contract", "renderer_visual", "windows_e2e", "regression", "release_gate"];
  assert.deepEqual(Object.keys(ledger.verification_commands || {}).sort(), [...expectedCommands].sort(), "verification command catalog is incomplete");
  for (const [commandId, command] of Object.entries(ledger.verification_commands)) {
    assert.ok(typeof command.command === "string" && command.command.length >= 12, `${commandId}: executable command is missing`);
    assert.ok(Array.isArray(command.evidence) && command.evidence.length > 0, `${commandId}: command evidence is missing`);
    for (const path of command.evidence) validateRelativeEvidencePath(path, commandId);
  }
  assert.deepEqual(Object.keys(ledger.acceptance_evidence || {}).sort(), [...expectedFeatureIds].sort(), "feature acceptance evidence is incomplete");
  for (const feature of ledger.features) {
    assert.equal(feature.status, "passed", `${feature.id}: release evidence is not passed`);
    assert.ok(feature.implementation?.length > 0, `${feature.id}: implementation evidence is missing`);
    assert.ok(feature.tests?.length > 0, `${feature.id}: test evidence is missing`);
    for (const path of [...feature.implementation, ...feature.tests]) {
      validateRelativeEvidencePath(path, feature.id);
    }
    const evidence = ledger.acceptance_evidence[feature.id];
    assert.ok(typeof evidence.assertion === "string" && evidence.assertion.length >= 16, `${feature.id}: acceptance assertion is missing`);
    assert.ok(Array.isArray(evidence.commands) && evidence.commands.length > 0, `${feature.id}: executable evidence is missing`);
    assert.ok(evidence.commands.every((id) => expectedCommands.includes(id)), `${feature.id}: unknown verification command`);
  }
  assert.ok(ledger.acceptance_evidence["M08-01"].commands.includes("backend"), "M08-01 must execute the real backend benchmark");
  assert.ok(ledger.acceptance_evidence["M08-02"].commands.includes("renderer_visual"), "M08-02 must execute the 10k Renderer benchmark");
  assert.ok(ledger.acceptance_evidence["M09-02"].commands.includes("windows_e2e"), "M09-02 must execute real Windows E2E");
  const m09e2e = ledger.features.find((feature) => feature.id === "M09-02");
  assert.ok(m09e2e.tests.includes("docs/desktop/evidence/agent-runtime-traceability-phase1-windows-e2e-result.json"), "M09-02 must link persisted E2E result evidence");
}

function validateFixtures(fixtures) {
  assert.equal(fixtures.schema_version, "opendrsai.run-traceability-fixtures/1");
  assert.deepEqual(fixtures.scenarios?.map((scenario) => scenario.id), ["A", "B", "C", "D", "E", "F"]);
  for (const scenario of fixtures.scenarios) {
    assert.ok(scenario.kind, `${scenario.id}: scenario kind is missing`);
    assert.ok(scenario.run_status, `${scenario.id}: expected run status is missing`);
    assert.ok(scenario.reproducibility_level, `${scenario.id}: reproducibility level is missing`);
    assert.ok(scenario.expected?.length > 0, `${scenario.id}: expected assertions are missing`);
  }
}

function validateNoCredentialMaterial(value, source) {
  const text = JSON.stringify(value);
  const forbidden = [
    /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  assert.ok(forbidden.every((pattern) => !pattern.test(text)), `${source}: credential material detected`);
}

function validateWindowsE2eResult(result) {
  assert.equal(result.schema_version, "opendrsai.run-traceability-windows-e2e-result/1");
  assert.equal(result.platform, "win32", "release evidence must come from Windows");
  assert.deepEqual(result.scenarios, ["A", "B", "C-waiting", "C-denied", "D", "E", "F"]);
  assert.ok(Object.keys(result.checks || {}).length >= 7, "Windows E2E check set is incomplete");
  assert.ok(Object.values(result.checks).every((value) => value === true), "Windows E2E has a failed check");
  assert.equal(result.offline_database_verification, true);
  assert.equal(result.security_audit_verification, true);
  assert.equal(result.details?.stage, "complete");
  assert.equal(result.details?.scenarios?.length, 7);
  for (const scenario of result.details.scenarios) {
    assert.ok(scenario.apiOk && scenario.identityOk && scenario.exportOk && scenario.uiOk, `${scenario.id}: incomplete Windows E2E evidence`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeDiagnosticTail(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .slice(-12_000);
}

function sourceDigest(ledger) {
  const paths = [...new Set(ledger.features.flatMap((feature) => [
    ...(feature.implementation || []), ...(feature.tests || []),
  ]))]
    .filter((path) => !path.startsWith("docs/desktop/evidence/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const absolute = resolve(repoRoot, path);
    assert.ok(existsSync(absolute), `attestation source is missing: ${path}`);
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true,
  }).trim();
}

function executeVerificationCommands(ledger) {
  const results = [];
  for (const [id, specification] of Object.entries(ledger.verification_commands)) {
    if (id === "release_gate") continue;
    const cwd = /(?:^|&&\s*)(?:npm\s+run|node\s+scripts\/)/.test(specification.command)
      ? resolve(repoRoot, "apps/desktop/windows")
      : repoRoot;
    const startedAt = new Date().toISOString();
    const started = performance.now();
    console.log(`[release] starting ${id}: ${specification.command}`);
    const child = spawnSync(specification.command, {
      cwd,
      shell: true,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30 * 60 * 1000,
    });
    const stdout = child.stdout || "";
    const stderr = child.stderr || "";
    const durationMs = Math.round(performance.now() - started);
    results.push({
      id,
      command: specification.command,
      cwd: cwd === repoRoot ? "." : "apps/desktop/windows",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      exit_code: typeof child.status === "number" ? child.status : -1,
      signal: child.signal || null,
      error_code: child.error?.code || null,
      stdout_sha256: sha256(stdout),
      stderr_sha256: sha256(stderr),
    });
    if (child.status !== 0 || child.error) {
      console.error(`[release] ${id} failed after ${durationMs}ms`);
      const diagnostic = safeDiagnosticTail(`${stdout}\n${stderr}`);
      if (diagnostic) console.error(diagnostic);
      break;
    }
    console.log(`[release] passed ${id} in ${durationMs}ms`);
  }
  return results;
}

function validateAttestation(attestation, ledger) {
  assert.equal(attestation.schema_version, "opendrsai.run-traceability-release-attestation/1");
  assert.equal(attestation.commit, currentCommit(), "release evidence belongs to another commit");
  assert.equal(attestation.source_digest, sourceDigest(ledger), "release evidence belongs to another source snapshot");
  assert.equal(attestation.ledger_digest, sha256(readFileSync(ledgerPath)), "release ledger changed after execution");
  const failed = attestation.commands.find((item) => item.exit_code !== 0 || item.error_code);
  assert.equal(
    failed,
    undefined,
    failed
      ? `release command ${failed.id} failed (exit=${failed.exit_code}, error=${failed.error_code || "none"})`
      : "a release command failed",
  );
  const expected = Object.keys(ledger.verification_commands).filter((id) => id !== "release_gate");
  assert.deepEqual(attestation.commands.map((item) => item.id), expected, "not every release command executed");
}

assert.ok(existsSync(ledgerPath), "acceptance ledger is missing");
assert.ok(existsSync(fixturePath), "A-F fixture evidence is missing");
assert.ok(existsSync(windowsE2eResultPath), "real Windows E2E result evidence is missing");
const ledger = readJson(ledgerPath);
const fixtures = readJson(fixturePath);
let windowsE2eResult = readJson(windowsE2eResultPath);
validateLedger(ledger);
validateFixtures(fixtures);
validateWindowsE2eResult(windowsE2eResult);
validateNoCredentialMaterial(ledger, "acceptance ledger");
validateNoCredentialMaterial(fixtures, "A-F fixtures");
validateNoCredentialMaterial(windowsE2eResult, "Windows E2E result");

// Prove the release gate fails closed when a P0 record loses its passing evidence.
const incompleteLedger = structuredClone(ledger);
incompleteLedger.features[0].status = "pending";
assert.throws(() => validateLedger(incompleteLedger), /release evidence is not passed/);
const missingEvidenceLedger = structuredClone(ledger);
delete missingEvidenceLedger.acceptance_evidence["M07-01"];
assert.throws(() => validateLedger(missingEvidenceLedger), /feature acceptance evidence is incomplete/);
const missingCommandLedger = structuredClone(ledger);
missingCommandLedger.acceptance_evidence["M09-02"].commands = [];
assert.throws(() => validateLedger(missingCommandLedger), /executable evidence is missing/);

if (process.argv.includes("--self-test")) {
  const passing = executeVerificationCommands({
    verification_commands: { backend: { command: 'node -e "process.exit(0)"' } },
  });
  assert.equal(passing[0].exit_code, 0, "release runner did not execute a passing command");
  const failing = executeVerificationCommands({
    verification_commands: { backend: { command: 'node -e "process.exit(7)"' } },
  });
  assert.equal(failing[0].exit_code, 7, "release runner did not preserve a failing exit code");
  console.log("Agent runtime traceability release gate executable self-test passed.\n");
  process.exit(0);
}

if (!process.argv.includes("--validate-only")) {
  const commands = executeVerificationCommands(ledger);
  const attestation = {
    schema_version: "opendrsai.run-traceability-release-attestation/1",
    generated_at: new Date().toISOString(),
    commit: currentCommit(),
    source_digest: sourceDigest(ledger),
    ledger_digest: sha256(readFileSync(ledgerPath)),
    commands,
  };
  writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  validateAttestation(attestation, ledger);
  windowsE2eResult = readJson(windowsE2eResultPath);
  validateWindowsE2eResult(windowsE2eResult);
} else {
  assert.ok(existsSync(attestationPath), "release attestation is missing");
  validateAttestation(readJson(attestationPath), ledger);
}

console.log("Agent runtime traceability phase 1 release gate passed with current-source executable attestation.\n");
