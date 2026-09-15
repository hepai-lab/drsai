import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { listAcceptanceScenarios } from "./acceptance/scenario-registry.mjs";
import { evaluateAcceptance, writeAcceptanceEvidence } from "./acceptance/evidence.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const level = option("--level", "smoke");
const reportDirectory = path.resolve(option("--report", path.join("release", "product-evidence", "sandbox-host-codex")));
const dryRun = process.argv.includes("--dry-run");
const runId = `acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const scenarios = listAcceptanceScenarios(level);

function runNpmScript(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["run", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => resolve({ status: "failed", durationMs: Date.now() - started, error: error.message }));
    child.on("close", (code) => resolve({
      status: code === 0 ? "passed" : "failed",
      durationMs: Date.now() - started,
      exitCode: code,
      stdout,
      stderr,
    }));
  });
}

const results = [];
for (const scenario of scenarios) {
  if (!scenario.command) {
    results.push({ ...scenario, status: dryRun ? "planned" : "blocked", durationMs: 0, error: "Host Codex Bridge is not implemented yet." });
    continue;
  }
  if (dryRun) {
    results.push({ ...scenario, status: "planned", durationMs: 0 });
    continue;
  }
  const result = await runNpmScript(scenario.command);
  results.push({ ...scenario, ...result });
  if (scenario.required && result.status !== "passed") break;
}

const gate = dryRun ? { passed: true, dryRun: true, failedScenarioIds: [] } : evaluateAcceptance(results);
const report = { schemaVersion: 1, runId, generatedAt: new Date().toISOString(), level, dryRun, gate, results };
const paths = await writeAcceptanceEvidence(path.join(reportDirectory, runId), report);
console.log(JSON.stringify({ runId, level, gate, report: paths.jsonPath }, null, 2));
if (!gate.passed) process.exitCode = 1;

