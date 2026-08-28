import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."); const releaseDir = resolve(root, "release/duplex-voice"); const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (name) => { const path = resolve(releaseDir, name); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; };
const passes = (script, args = []) => spawnSync(process.execPath, [resolve(import.meta.dirname, script), ...args], { cwd: root, encoding: "utf8" }).status === 0;
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe"); const appAsar = resolve(root, "release/win-unpacked/resources/app.asar");
const packaged = read("packaged-report.json"); const live = read("live-report.json"); const hardware = read("hardware-review-workbook.json");
const candidate = { executable: { path: executable, sha256: existsSync(executable) ? sha(executable) : null }, appAsar: { path: appAsar, sha256: existsSync(appAsar) ? sha(appAsar) : null } };
const bound = (report) => report?.artifacts?.executable?.sha256 === candidate.executable.sha256 && report?.artifacts?.appAsar?.sha256 === candidate.appAsar.sha256;
const automationReady = passes("verify-duplex-p2-automation.mjs"); const pendingConsistent = passes("verify-duplex-p2-evidence-index.mjs");
const gates = [
  { kind: "automation", status: automationReady ? "complete" : "stale_or_missing", nextAction: automationReady ? null : "npm run run:voice:duplex-p2-automation" },
  { kind: "packaged_named_review", status: packaged?.ok === true ? "signed" : pendingConsistent && bound(packaged) ? "ready_for_tester" : "prepare_required", nextAction: "Follow docs/voice/duplex-voice-p2-packaged-acceptance-guide.md" },
  { kind: "live_named_listening", status: live?.ok === true ? "signed" : pendingConsistent && bound(live) ? "ready_for_listener" : "prepare_required", nextAction: "Follow docs/voice/duplex-voice-p2-live-listening-guide.md" },
  { kind: "hardware_physical", status: read("hardware-report.json")?.ok === true ? "signed" : pendingConsistent && bound(hardware) ? "ready_for_physical_matrix" : "prepare_required", nextAction: "Follow docs/voice/duplex-voice-p2-physical-acceptance-guide.md" },
  { kind: "stable_release_cycle", status: passes("verify-duplex-stable-release-cycle.mjs") ? "signed" : "not_started", nextAction: "Follow docs/voice/duplex-voice-p2-stable-release-cycle-guide.md after a real stable publication" },
];
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), mode: "duplex", environment: "development", gatewayPort: 28642, productionGatewayPort: 18642, providerId: "zhizengzeng", modelId: "gpt-realtime-2", candidate, safeReadOnly: true, microphoneStarted: false, testerAttestationCreated: false, gates };
const outputArg = process.argv.indexOf("--output"); if (outputArg >= 0) writeFileSync(resolve(process.argv[outputArg + 1]), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
