import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(import.meta.dirname, "../release/duplex-voice"); mkdirSync(directory, { recursive: true });
const base = { schemaVersion: 1, mode: "duplex", ok: false, generatedAt: new Date().toISOString(), tester: null, attachments: [] };
const reports = {
  packaged: { ...base, kind: "packaged", packagedApp: true, featureFlag: "OPENDRSAI_ENABLE_DUPLEX_VOICE=1", observed: { uplinkAudioFrames: 0, downlinkAudioDeltas: 0, interrupts: 0, terminalCount: 0 } },
  live: { ...base, kind: "live", providerId: "zhizengzeng", modelId: "gpt-realtime-2", observed: { sessionReady: false, inputAudio: false, inputTranscript: false, outputAudio: false, outputTranscript: false, interruption: false, toolRoundTrip: false } },
  hardware: { ...base, kind: "hardware", runs: [] },
};
for (const [kind, payload] of Object.entries(reports)) { const report = { ...payload, integrity: { algorithm: "sha256", digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex") } }; writeFileSync(resolve(directory, `${kind}-report.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8"); }
console.log(`Pending Duplex release evidence templates written to ${directory}; they intentionally do not pass until signed real runs are attached.`);
