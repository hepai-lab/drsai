import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageVersion = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).version;
const requiredModes = ["online", "candidate", "upgrade", "networkcandidate"];
const requiredChecks = [
  "Manual OIDC, chat and restart acceptance",
  "Windows Sandbox identity",
  "Default Agent bound",
  "HepAI Provider selected",
  "API Key not required",
  "OIDC session persisted",
  "Gateway ready",
  "Runtime model catalog non-empty",
  "Real OpenDrSai execution completed",
  "Chat evidence correlated",
  "Diagnostic evidence redaction",
  "Run manifest generated",
];
const requiredArtifacts = [
  "acceptance-result.json", "collection-result.json", "run-manifest.json", "summary.md", "checksums.txt",
  "app/auth-metadata.json", "app/model-catalog-status.json", "agent/agent-telemetry.jsonl",
  "gateway/gateway.log", "installer/install-state.json", "network/connections.json",
  "windows-events/application.json", "windows-events/code-integrity.json", "windows-events/defender.json",
];

export function verifyEvidenceRoot(root, options = {}) {
  const evidenceRoot = resolve(root);
  const failures = [];
  const candidates = [];
  if (!existsSync(evidenceRoot)) {
    return report(evidenceRoot, [], [`Evidence root does not exist: ${evidenceRoot}`]);
  }
  for (const entry of readdirSync(evidenceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = join(evidenceRoot, entry.name);
    const dir = join(runDir, "evidence");
    const inputPath = join(dir, "resolved-input.json");
    const resultPath = join(dir, "acceptance-result.json");
    if (!existsSync(inputPath) || !existsSync(resultPath)) continue;
    try {
      const input = readJson(inputPath);
      const result = readJson(resultPath);
      candidates.push({ runDir, dir, input, result, time: Date.parse(result.generatedAt || input.createdAt || 0) || 0 });
    } catch (error) {
      failures.push(`${entry.name}: invalid JSON: ${error.message}`);
    }
  }

  const selected = [];
  for (const mode of requiredModes) {
    const matches = candidates
      .filter((item) => String(item.input.mode).toLowerCase() === mode && item.result.passed === true)
      .filter((item) => mode === "online" || String(item.result.expectedVersion) === packageVersion)
      .sort((a, b) => b.time - a.time);
    if (!matches.length) {
      failures.push(`Missing passing ${mode} Sandbox evidence${mode === "online" ? "" : ` for version ${packageVersion}`}.`);
      continue;
    }
    const item = matches[0];
    const itemFailures = verifyRun(item, mode);
    if (itemFailures.length) failures.push(...itemFailures.map((message) => `${basename(item.runDir)}: ${message}`));
    else selected.push({ mode, runId: item.result.runId, generatedAt: item.result.generatedAt, expectedVersion: item.result.expectedVersion, runDirectory: item.runDir, evidenceDirectory: item.dir });
  }
  return report(evidenceRoot, selected, failures, options);
}

function verifyRun(item, mode) {
  const { dir, input, result } = item;
  const failures = [];
  if (result.failedCount !== 0 || !Array.isArray(result.checks) || result.checks.some((check) => check.status !== "PASS")) failures.push("acceptance-result contains a failed or non-PASS check");
  for (const name of requiredChecks) {
    const check = result.checks.find((candidate) => candidate.name === name);
    if (!check) failures.push(`missing required check: ${name}`);
    else if (!check.checkedAt || !("diagnosticCode" in check) || !check.evidence) failures.push(`check lacks timestamp, diagnosticCode or evidence: ${name}`);
  }
  for (const artifact of requiredArtifacts) if (!existsSync(join(dir, artifact))) failures.push(`missing artifact: ${artifact}`);
  const screenshots = join(dir, "screenshots");
  if (!existsSync(screenshots) || !readdirSync(screenshots).some((name) => name.toLowerCase().endsWith(".png"))) failures.push("missing Sandbox screenshot evidence");
  for (const forbidden of ["auth.json", ".env"]) {
    if (walkFiles(dir).some((path) => basename(path).toLowerCase() === forbidden)) failures.push(`forbidden raw secret file exported: ${forbidden}`);
  }
  if (existsSync(join(dir, "collection-result.json"))) {
    const collection = readJson(join(dir, "collection-result.json"));
    if (collection.passed !== true || Number(collection.secretFindingCount) !== 0) failures.push("diagnostic secret scan did not pass cleanly");
  }
  if (existsSync(join(dir, "run-manifest.json"))) {
    const manifest = readJson(join(dir, "run-manifest.json"));
    if (manifest.runId !== result.runId || manifest.installedVersion !== result.expectedVersion || manifest.sandboxIdentity !== true) failures.push("run-manifest identity/version does not match acceptance-result");
  }
  if (existsSync(join(dir, "checksums.txt"))) failures.push(...verifyChecksums(dir));
  if (mode === "upgrade") {
    for (const artifact of ["msi-baseline-install.log", "msi-candidate-upgrade.log", "baseline-download-evidence.json", "candidate-download-evidence.json"]) if (!existsSync(join(dir, artifact))) failures.push(`upgrade evidence missing ${artifact}`);
    if (!input.baselineVersion) failures.push("upgrade evidence has no baselineVersion");
  }
  if (mode === "online" || mode === "networkcandidate") {
    const download = existsSync(join(dir, "download-evidence.json")) ? readJson(join(dir, "download-evidence.json")) : null;
    if (!download || !String(download.url || "").startsWith("https://")) failures.push(`${mode} evidence did not install from HTTPS`);
  }
  return failures;
}

function verifyChecksums(dir) {
  const failures = [];
  const lines = readFileSync(join(dir, "checksums.txt"), "utf8").split(/\r?\n/).filter(Boolean);
  const verified = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) { failures.push(`invalid checksum line: ${line}`); continue; }
    const relativePath = match[2].replaceAll("/", "\\");
    const path = resolve(dir, relativePath);
    if (isAbsolute(relativePath) || relative(dir, path).startsWith("..") || !existsSync(path) || !statSync(path).isFile()) { failures.push(`unsafe or missing checksum target: ${match[2]}`); continue; }
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== match[1]) failures.push(`checksum mismatch: ${match[2]}`);
    verified.add(match[2].replaceAll("\\", "/"));
  }
  for (const name of ["acceptance-result.json", "collection-result.json", "run-manifest.json", "summary.md"]) if (!verified.has(name)) failures.push(`checksums.txt does not bind ${name}`);
  return failures;
}

function walkFiles(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function report(evidenceRoot, selected, failures, options = {}) {
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), packageVersion, evidenceRoot, passed: failures.length === 0 && selected.length === requiredModes.length, requiredModes, selected, failures, ...options };
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = valueAfter("--root") || process.env.OPENDRSAI_SANDBOX_EVIDENCE_ROOT || join(appRoot, "release", "product-evidence", "windows-sandbox-oidc");
  const output = valueAfter("--write-report") || process.env.OPENDRSAI_SANDBOX_EVIDENCE_REPORT;
  const allowIncomplete = process.argv.includes("--allow-incomplete");
  const result = verifyEvidenceRoot(rootArg);
  if (output) { const destination = resolve(output); writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8"); }
  if (result.passed) console.log(`Windows Sandbox OIDC evidence passed for ${result.selected.map((item) => item.mode).join(", ")}.`);
  else console.error(`Windows Sandbox OIDC evidence is incomplete:\n- ${result.failures.join("\n- ")}`);
  if (!result.passed && !allowIncomplete) process.exit(1);
}

function valueAfter(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ""; }
