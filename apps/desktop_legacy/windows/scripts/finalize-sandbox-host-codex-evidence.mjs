import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { evaluateAcceptance, writeAcceptanceEvidence } from "./acceptance/evidence.mjs";

const evidenceDirectory = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Evidence directory argument is required.");
const raw = JSON.parse(await readFile(path.join(evidenceDirectory, "sandbox-host-codex.json"), "utf8"));
const execution = JSON.parse(await readFile(path.join(evidenceDirectory, "execute-result.json"), "utf8"));
const recovery = JSON.parse(await readFile(path.join(evidenceDirectory, "recover-result.json"), "utf8"));

const requiredChecks = [
  "Windows Sandbox identity",
  "Host Bridge reachable",
  "Host account reused without guest login",
  "Archive and unarchive roundtrip",
  "Multi-turn reuses one Codex Thread",
  "Runtime and Bridge restart recovery",
];
const checkMap = new Map(raw.checks.map((check) => [check.name, check]));
const results = requiredChecks.map((title) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  required: true,
  status: checkMap.get(title)?.status === "PASS" ? "passed" : "failed",
  durationMs: 0,
  detail: checkMap.get(title)?.detail || "missing check",
}));
const multiTurn = execution.multi_turn || {};
const identityPassed = Boolean(
  multiTurn.context_retained && multiTurn.session_id && multiTurn.thread_id &&
  multiTurn.first_turn_id && multiTurn.second_turn_id && multiTurn.first_turn_id !== multiTurn.second_turn_id,
);
results.push({
  id: "multi-turn-identity-invariants",
  title: "One Session and one Codex Thread with two distinct Turns",
  required: true,
  status: identityPassed ? "passed" : "failed",
  durationMs: 0,
  detail: multiTurn,
});
results.push({
  id: "runtime-state-recovery",
  title: "All Runtime Runs and events recover after restart",
  required: true,
  status: recovery.passed && recovery.recovered ? "passed" : "failed",
  durationMs: 0,
  detail: { statuses: recovery.statuses, eventCounts: recovery.event_counts },
});
const gate = evaluateAcceptance(results);
const report = {
  schemaVersion: 1,
  runId: path.basename(path.dirname(evidenceDirectory)),
  generatedAt: new Date().toISOString(),
  level: "release",
  gate,
  results,
};
const paths = await writeAcceptanceEvidence(evidenceDirectory, report);
console.log(JSON.stringify({ gate, ...paths }));
if (!gate.passed) process.exitCode = 1;

