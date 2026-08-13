import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const trust = join(root, "scripts", "runtime-build-trust.mjs");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-build-trust-"));
const payload = join(temp, "payload");

try {
  mkdirSync(join(payload, "app"), { recursive: true });
  mkdirSync(join(payload, "drsai-agent", "venv", "Lib", "site-packages", "drsai"), { recursive: true });
  writeFileSync(join(payload, "app", "OpenDrSai.exe"), "desktop-fixture");
  writeFileSync(join(payload, "drsai-agent", "venv", "Lib", "site-packages", "drsai", "__init__.py"), "fixture = True\n");
  run(["seal-runtime", "--payload", payload, "--version", "0.0.0-test", "--channel", "dev"]);
  run(["verify-directory", "--payload", payload, "--skip-python-import"]);

  const identity = JSON.parse(readFileSync(join(payload, "build-identity.json"), "utf8"));
  const agentIdentity = JSON.parse(readFileSync(join(payload, "drsai-agent", "build-identity.json"), "utf8"));
  assert(identity.buildId === agentIdentity.buildId, "sealed identities do not match");
  assert(identity.sourceTreeSha256.startsWith("sha256:"), "source tree digest is missing");

  writeFileSync(join(payload, "app", "OpenDrSai.exe"), "tampered-desktop-fixture");
  const changed = run(["verify-directory", "--payload", payload, "--skip-python-import"], false);
  assert(changed.status !== 0 && output(changed).includes("changed app/OpenDrSai.exe"), "changed Runtime file was accepted");

  writeFileSync(join(payload, "app", "OpenDrSai.exe"), "desktop-fixture");
  writeFileSync(join(payload, "app", "unexpected.dll"), "stale-file");
  const stale = run(["verify-directory", "--payload", payload, "--skip-python-import"], false);
  assert(stale.status !== 0 && output(stale).includes("unexpected app/unexpected.dll"), "unexpected stale Runtime file was accepted");

  rmSync(join(payload, "app", "unexpected.dll"));
  run(["verify-directory", "--payload", payload, "--skip-python-import"]);
  const archive = join(temp, "runtime.zip");
  const zip = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Compress-Archive -Path '${payload.replaceAll("'", "''")}\\*' -DestinationPath '${archive.replaceAll("'", "''")}'`],
  { encoding: "utf8", windowsHide: true });
  assert(zip.status === 0, `could not create archive fixture: ${output(zip)}`);
  run(["record-archive", "--payload", payload, "--archive", archive]);
  const stagedReceipt = JSON.parse(readFileSync(`${archive}.receipt.json`, "utf8"));
  assert(stagedReceipt.schemaVersion === 2 && stagedReceipt.status === "staged", "new archive receipt was not staged as schema v2");
  assert(stagedReceipt.payload.fileCount > 0 && stagedReceipt.payload.expandedSizeBytes > 0, "archive payload metrics are missing");
  const verifier = join(root, "scripts", "verify-final-runtime-artifact.ps1");
  const prematureFastVerify = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
    "-ArchivePath", archive, "-SkipPythonImport", "-Fast"], { encoding: "utf8", windowsHide: true });
  assert(prematureFastVerify.status !== 0 && output(prematureFastVerify).includes("not complete"), "staged receipt was accepted by fast verification");
  const validArchive = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
    "-ArchivePath", archive, "-SkipPythonImport", "-CompleteReceipt"], { encoding: "utf8", windowsHide: true });
  assert(validArchive.status === 0, `completed archive was rejected: ${output(validArchive)}`);
  const completedReceipt = JSON.parse(readFileSync(`${archive}.receipt.json`, "utf8"));
  assert(completedReceipt.status === "complete" && completedReceipt.verification.status === "passed", "full verification did not complete the receipt");
  const fastVerify = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
    "-ArchivePath", archive, "-SkipPythonImport", "-Fast"], { encoding: "utf8", windowsHide: true });
  assert(fastVerify.status === 0 && output(fastVerify).includes("Fast-verified"), `completed receipt failed fast verification: ${output(fastVerify)}`);
  const msiOutput = join(temp, "msi");
  const msiPath = join(msiOutput, "OpenDrSai-Windows-Installer-x64.msi");
  const msiBuild = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    join(root, "installer", "build-msi.ps1"), "-OutDir", msiOutput, "-RuntimePath", archive,
    "-BootstrapperVersion", "0.0.0-test", "-RequireTrustedRuntime"], { encoding: "utf8", windowsHide: true });
  assert(msiBuild.status === 0 && existsSync(msiPath), `MSI fast-path fixture build failed: ${output(msiBuild)}`);
  assert(output(msiBuild).includes("Fast-verified"), "MSI build did not use completed receipt fast verification");
  const legacyReceiptPath = join(temp, "legacy.receipt.json");
  const legacyReceipt = { ...completedReceipt, schemaVersion: 1, status: "complete" };
  delete legacyReceipt.payload;
  delete legacyReceipt.verification;
  writeFileSync(legacyReceiptPath, `${JSON.stringify(legacyReceipt, null, 2)}\n`);
  const legacyFullVerify = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
    "-ArchivePath", archive, "-ReceiptPath", legacyReceiptPath, "-SkipPythonImport"], { encoding: "utf8", windowsHide: true });
  assert(legacyFullVerify.status === 0, `legacy schema v1 receipt lost full-verification compatibility: ${output(legacyFullVerify)}`);
  appendFileSync(archive, "post-receipt-tamper");
  const tamperedArchive = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier,
    "-ArchivePath", archive, "-SkipPythonImport", "-Fast"], { encoding: "utf8", windowsHide: true });
  assert(tamperedArchive.status !== 0 && output(tamperedArchive).includes("SHA-256 differs"), "archive modified after receipt was accepted");

  console.log("Runtime build trust regressions passed: identity binding, changed/stale-file rejection, staged/full/fast receipt binding, MSI fast path.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function run(args, requireSuccess = true) {
  const result = spawnSync(process.execPath, [trust, ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (requireSuccess && result.status !== 0) throw new Error(output(result));
  return result;
}
function output(result) { return `${result.stdout || ""}\n${result.stderr || ""}`; }
function assert(condition, message) { if (!condition) throw new Error(message); }
