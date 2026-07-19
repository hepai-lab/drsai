import { execFileSync } from "node:child_process";
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
const checks = Object.fromEntries(requiredChecks.map((name) => [name, supplied.checks?.[name] === true]));
const report = {
  schemaVersion: 1,
  evidenceClass: "physical-windows-device-matrix",
  generatedAt: new Date().toISOString(),
  ok: requiredChecks.every((name) => checks[name]) && Boolean(supplied.tester?.name && supplied.tester?.signedAt),
  checks,
  tester: supplied.tester ?? null,
  environment: {
    platform: process.platform,
    release: process.getSystemVersion?.() ?? process.version,
    architecture: process.arch,
    soundDevices: listSoundDevices(),
  },
  notes: supplied.notes ?? "Pending physical-device execution. False checks are intentionally not inferred from detected hardware.",
};
const outputPath = join(evidenceDir, "report.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`${report.ok ? "Complete" : "Pending"} Windows voice hardware evidence written: ${outputPath}`);
if (!report.ok) process.exitCode = 2;

function parseSuppliedResults(value) {
  if (!value?.trim()) return {};
  try { return JSON.parse(value); } catch { throw new Error("OPENDRSAI_VOICE_HARDWARE_RESULTS must be valid JSON."); }
}

function listSoundDevices() {
  try {
    const script = "Get-CimInstance Win32_SoundDevice | Select-Object Name,Status,Manufacturer | ConvertTo-Json -Compress";
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({ name: String(item.Name ?? "Unknown").slice(0, 120), status: String(item.Status ?? "Unknown").slice(0, 32), manufacturer: String(item.Manufacturer ?? "Unknown").slice(0, 80) }));
  } catch { return []; }
}
