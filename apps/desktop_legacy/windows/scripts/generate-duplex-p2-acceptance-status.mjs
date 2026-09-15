import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { candidateEvidenceMatches, projectAcceptance } from "./duplex-p2-acceptance-projection.mjs";

const root = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(root, "../../..");
const valueAfter = (flag, fallback) => { const i = process.argv.indexOf(flag); return resolve(i < 0 ? fallback : process.argv[i + 1]); };
const indexPath = valueAfter("--index", resolve(workspaceRoot, "docs/voice/duplex-voice-p2-evidence-index.json"));
const releaseDir = valueAfter("--release-dir", resolve(root, "release/duplex-voice"));
const outputPath = valueAfter("--output", resolve(releaseDir, "p2-acceptance-status.json"));
const verifier = resolve(import.meta.dirname, "verify-duplex-release-evidence.mjs");
const validateAutomation = async () => {
  const path = resolve(releaseDir, "p2-automation-report.json");
  if (!existsSync(path) || spawnSync(process.execPath, [resolve(import.meta.dirname, "verify-duplex-p2-automation.mjs"), path], { encoding: "utf8" }).status !== 0) return null;
  const bytes = await readFile(path); return { report: JSON.parse(bytes.toString("utf8")), path, sha256: sha256(bytes) };
};
const validateExternal = async (kind) => {
  const path = resolve(releaseDir, `${kind}-report.json`);
  if (!existsSync(path) || spawnSync(process.execPath, [verifier, kind, path], { encoding: "utf8" }).status !== 0) return null;
  const bytes = await readFile(path); return { report: JSON.parse(bytes.toString("utf8")), path, sha256: sha256(bytes) };
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validStableRelease = async () => {
  const path = resolve(releaseDir, "stable-release-cycle-report.json");
  if (!existsSync(path) || spawnSync(process.execPath, [resolve(import.meta.dirname, "verify-duplex-stable-release-cycle.mjs"), path], { encoding: "utf8" }).status !== 0) return null;
  const bytes = await readFile(path); return { report: JSON.parse(bytes.toString("utf8")), path, sha256: sha256(bytes) };
};

const sourceBytes = await readFile(indexPath);
const index = JSON.parse(sourceBytes.toString("utf8"));
const [automation, packaged, live, hardware, stable] = await Promise.all([validateAutomation(), validateExternal("packaged"), validateExternal("live"), validateExternal("hardware"), validStableRelease()]);
const evidenceStatus = {
  automation: automation !== null && index.features.every((feature) => feature.automation?.status === "passed"),
  packaged_named_review: packaged !== null,
  live_named_listening: packaged !== null && live !== null && candidateEvidenceMatches(packaged.report, live.report),
  hardware_physical: packaged !== null && hardware !== null && candidateEvidenceMatches(packaged.report, hardware.report),
  stable_release_cycle: stable !== null,
};
const signed = (source, actor) => source ? { reportPath: source.path, reportSha256: source.sha256, signer: source.report[actor]?.name, signedAt: source.report[actor]?.signedAt } : null;
const evidenceProvenance = {
  automation: automation ? { sourceIndexSha256: sha256(sourceBytes), reportPath: automation.path, reportSha256: automation.sha256, completedAt: automation.report.completedAt, source: automation.report.source, suites: automation.report.suites.map(({ command }) => command) } : null,
  packaged_named_review: signed(packaged, "tester"), live_named_listening: signed(live, "tester"),
  hardware_physical: signed(hardware, "tester"), stable_release_cycle: signed(stable, "approver"),
};
const features = projectAcceptance(index.features, evidenceStatus, evidenceProvenance);
const strictAccepted = features.filter(({ strictAcceptance }) => strictAcceptance === "accepted").length;
const payload = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), sourceIndexSha256: sha256(sourceBytes),
  counts: { total: features.length, implemented: index.counts.implemented, strictAccepted }, evidenceStatus, evidenceProvenance, features,
};
const report = { ...payload, integrity: { algorithm: "sha256", digest: sha256(JSON.stringify(payload)) } };
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Duplex Voice P2 acceptance projected (${strictAccepted}/${features.length} strictly accepted).`);
