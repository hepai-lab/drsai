import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("Windows voice hardware evidence must be collected on Windows.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceDir = join(root, "release", "voice-windows-hardware-evidence");
mkdirSync(evidenceDir, { recursive: true });
const requiredChecks = [
  "windows10", "windows11", "builtinMicrophone", "usbMicrophone", "bluetoothMicrophone",
  "builtinOutput", "usbOutput", "bluetoothOutput", "permissionDenied", "sleepResume",
  "deviceUnplug", "networkLoss", "systemSpeech", "twentyTurnStability", "memoryStable",
  "handleStable", "tempFilesClean", "privacyLogsClean",
];
const supplied = parseSuppliedResults(process.env.OPENDRSAI_VOICE_HARDWARE_RESULTS);
const runs = normalizeRuns(supplied.runs);
const checks = Object.fromEntries(requiredChecks.map((name) => [name, runs.some((run) => run.passed && run.checks.includes(name))]));
const tester = normalizeTester(supplied.tester);
const payload = {
  schemaVersion: 2,
  evidenceClass: "physical-windows-device-matrix",
  generatedAt: new Date().toISOString(),
  checks,
  runs,
  tester,
  environment: { platform: process.platform, release: process.getSystemVersion?.() ?? process.version, architecture: process.arch, soundDevices: listSoundDevices() },
  notes: supplied.notes ?? "Pending physical-device execution. Checks require passed runs with evidence references.",
};
const complete = requiredChecks.every((name) => checks[name]) && runs.length > 0 && Boolean(tester?.name && tester?.signedAt && tester?.attestation);
const report = { ...payload, ok: complete, integrity: { algorithm: "sha256", digest: digest(payload) } };
const outputPath = join(evidenceDir, "report.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`${report.ok ? "Complete" : "Pending"} Windows voice hardware evidence written: ${outputPath}`);
if (!report.ok) process.exitCode = 2;

function parseSuppliedResults(value) { if (!value?.trim()) return {}; try { return JSON.parse(value); } catch { throw new Error("OPENDRSAI_VOICE_HARDWARE_RESULTS must be valid JSON."); } }
function normalizeTester(value) {
  if (!value || typeof value !== "object") return null;
  return { name: String(value.name ?? "").trim().slice(0, 120), signedAt: String(value.signedAt ?? "").trim(), attestation: String(value.attestation ?? "").trim().slice(0, 500) };
}
function normalizeRuns(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((run, index) => ({
    id: String(run?.id ?? `run-${index + 1}`).trim().slice(0, 80),
    osVersion: String(run?.osVersion ?? "").trim().slice(0, 80),
    inputDevice: String(run?.inputDevice ?? "").trim().slice(0, 160),
    outputDevice: String(run?.outputDevice ?? "").trim().slice(0, 160),
    checks: Array.isArray(run?.checks) ? [...new Set(run.checks.filter((item) => requiredChecks.includes(item)))] : [],
    passed: run?.passed === true,
    evidence: Array.isArray(run?.evidence) ? run.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 20) : [],
  })).filter((run) => run.id && run.osVersion && run.inputDevice && run.outputDevice && run.checks.length && run.evidence.length);
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function listSoundDevices() {
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_SoundDevice | Select-Object Name,Status,Manufacturer | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({ name: String(item.Name ?? "Unknown").slice(0, 120), status: String(item.Status ?? "Unknown").slice(0, 32), manufacturer: String(item.Manufacturer ?? "Unknown").slice(0, 80) }));
  } catch { return []; }
}
