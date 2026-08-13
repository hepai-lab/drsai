import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEvidenceRoot } from "./verify-windows-sandbox-oidc-evidence.mjs";

const root = mkdtempSync(join(tmpdir(), "opendrsai-sandbox-evidence-"));
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const checkNames = [
  "Manual OIDC, chat and restart acceptance", "Windows Sandbox identity", "Default Agent bound",
  "HepAI Provider selected", "API Key not required", "Encrypted OIDC session before logout",
  "Restart persistence verified", "Two acceptance chats completed", "Post-restart chat verified",
  "Tavily search available", "OIDC logout cleared local session", "Gateway ready",
  "Runtime model catalog non-empty", "Real OpenDrSai execution completed", "Chat evidence correlated",
  "Diagnostic evidence redaction", "Run manifest generated",
];
const acceptanceScript = readFileSync(new URL("complete-windows-sandbox-acceptance.ps1", import.meta.url), "utf8");
assert(acceptanceScript.includes("$drsaiHome = Join-Path $env:USERPROFILE \".drsai\""), "Sandbox acceptance must use a writable DrSai home variable");
assert(!/^\$home\s*=/mi.test(acceptanceScript), "Sandbox acceptance must not assign PowerShell's read-only HOME automatic variable");

try {
  for (const mode of ["online", "candidate", "upgrade", "networkcandidate"]) createRun(mode);
  const valid = verifyEvidenceRoot(root);
  assert(valid.passed && valid.selected.length === 4, `valid evidence fixture failed: ${valid.failures.join("; ")}`);
  const bundle = join(root, `windows-sandbox-oidc-evidence-v${version}.zip`);
  const seal = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("seal-windows-sandbox-oidc-evidence.ps1", import.meta.url)), "-EvidenceRoot", root, "-OutputPath", bundle], { encoding: "utf8", windowsHide: true });
  assert(seal.status === 0, `valid evidence fixture could not be sealed: ${(seal.stdout || "") + (seal.stderr || "")}`);
  assert(existsSync(bundle) && statSync(bundle).size > 0, "sealed evidence ZIP was not created");
  const sealedMetadata = JSON.parse(readFileSync(`${bundle}.json`, "utf8"));
  assert(sealedMetadata.modes.length === 4 && sealedMetadata.sha256 === sha256(bundle), "sealed evidence metadata does not bind all modes and ZIP digest");

  const candidateSummary = join(root, "opendrsai-candidate-fixture", "evidence", "summary.md");
  writeFileSync(candidateSummary, "tampered\n");
  const tampered = verifyEvidenceRoot(root);
  assert(!tampered.passed && tampered.failures.some((item) => item.includes("checksum mismatch: summary.md")), "tampered evidence was not rejected");
  console.log("Windows Sandbox OIDC evidence regressions passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function createRun(mode) {
  const runId = `opendrsai-${mode}-fixture`;
  const dir = join(root, runId, "evidence");
  for (const folder of ["app", "agent", "gateway", "installer", "network", "windows-events", "screenshots"]) mkdirSync(join(dir, folder), { recursive: true });
  writeJson(join(dir, "resolved-input.json"), { runId, mode, createdAt: new Date().toISOString(), expectedVersion: mode === "online" ? "1.4.9" : version, baselineVersion: mode === "upgrade" ? "1.4.9" : undefined });
  writeJson(join(dir, "acceptance-result.json"), { schemaVersion: 1, runId, generatedAt: new Date().toISOString(), passed: true, expectedVersion: mode === "online" ? "1.4.9" : version, failedCount: 0, checks: checkNames.map((name) => ({ name, status: "PASS", checkedAt: new Date().toISOString(), detail: "fixture", evidence: "fixture", diagnosticCode: "" })) });
  writeJson(join(dir, "pre-logout-validation.json"), { schemaVersion: 1, runId, passed: true, checks: { encryptedOidcSession: true, restartPersistence: true, twoAcceptanceChats: true, postRestartChat: true, gatewayReady: true, defaultAgentResolved: true, hepaiModelResolved: true, tavilySearchAvailable: true }, completedChatCount: 2, tavilyResultCount: 3 });
  writeJson(join(dir, "collection-result.json"), { passed: true, secretFindingCount: 0 });
  writeJson(join(dir, "run-manifest.json"), { runId, installedVersion: mode === "online" ? "1.4.9" : version, sandboxIdentity: true });
  writeFileSync(join(dir, "summary.md"), "# PASS\n");
  writeJson(join(dir, "app", "auth-metadata.json"), { exists: true, authMode: "oidc", encryptedTokens: true });
  writeJson(join(dir, "app", "model-catalog-status.json"), { authMode: "oidc", state: "ready", modelCount: 1 });
  writeFileSync(join(dir, "agent", "agent-telemetry.jsonl"), `${JSON.stringify({ event: "execution_completed", agentId: "opendrsai", acceptanceRunId: runId, requestId: "r", runId: "run" })}\n`);
  writeFileSync(join(dir, "gateway", "gateway.log"), "ready\n");
  writeJson(join(dir, "installer", "install-state.json"), { version: mode === "online" ? "1.4.9" : version });
  writeJson(join(dir, "network", "connections.json"), []);
  for (const name of ["application", "code-integrity", "defender"]) writeJson(join(dir, "windows-events", `${name}.json`), []);
  writeFileSync(join(dir, "screenshots", "final.png"), Buffer.from([137, 80, 78, 71]));
  writeJson(join(dir, "download-evidence.json"), { url: mode === "candidate" || mode === "upgrade" ? "file:///candidate.msi" : "https://download.example/OpenDrSai-Windows-Installer-x64.msi" });
  if (mode === "upgrade") {
    writeFileSync(join(dir, "msi-baseline-install.log"), "baseline\n");
    writeFileSync(join(dir, "msi-candidate-upgrade.log"), "candidate\n");
    writeJson(join(dir, "baseline-download-evidence.json"), { url: "https://download.example/baseline.msi" });
    writeJson(join(dir, "candidate-download-evidence.json"), { url: "file:///candidate.msi" });
  }
  const files = walk(dir).filter((path) => !path.endsWith("checksums.txt")).sort();
  const lines = files.map((path) => `${sha256(path)}  ${path.slice(dir.length + 1).replaceAll("\\", "/")}`);
  writeFileSync(join(dir, "checksums.txt"), `${lines.join("\n")}\n`);
}

function walk(rootPath) {
  const output = [];
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name);
    if (entry.isDirectory()) output.push(...walk(path)); else output.push(path);
  }
  return output;
}
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function assert(value, message) { if (!value) throw new Error(message); }
