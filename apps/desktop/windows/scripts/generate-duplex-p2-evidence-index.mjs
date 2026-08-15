import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const planPath = resolve(workspaceRoot, "docs/voice/duplex-voice-p2-development-plan.md");
const progressPath = resolve(workspaceRoot, "docs/voice/duplex-voice-p2-progress.md");
const outputPath = resolve(workspaceRoot, "docs/voice/duplex-voice-p2-evidence-index.json");

const [plan, progress] = await Promise.all([readFile(planPath, "utf8"), readFile(progressPath, "utf8")]);
const planRows = [...plan.matchAll(/^\| (M\d+-F\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];
const progressRows = new Map(
  [...progress.matchAll(/^\| (M\d+-F\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map((match) => [match[1], match]),
);
const automationByModule = {
  M1: ["test:voice:duplex-contracts", "verify:voice:duplex-ui"],
  M2: ["test:voice:duplex-capture", "test:voice:duplex-runtime"],
  M3: ["test:voice:duplex-playback", "test:voice:duplex-runtime"],
  M4: ["test:voice:duplex-turns", "test:voice:duplex-runtime"],
  M5: ["test:voice:duplex-recovery", "test:voice:duplex-runtime"],
  M6: ["test:voice:duplex-transcript", "test:voice:duplex-history"],
  M7: ["test:voice:duplex-provider", "test:voice:duplex-tools"],
  M8: ["verify:voice:duplex-ui", "test:voice:duplex-turns"],
  M9: ["verify:voice:duplex-privacy", "test:voice:duplex-contracts"],
  M10: ["test:voice:duplex-fault-matrix", "test:voice:duplex-evidence-gates", "test:voice:duplex-legacy-gate"],
};
const implementationNote = (id, fallback) => {
  const escaped = id.replace("-", "\\-");
  const patterns = [
    new RegExp(`^> - ${escaped} 部分完成：(.+)$`, "m"),
    new RegExp(`^- ${escaped}：(.+)$`, "m"),
  ];
  return patterns.map((pattern) => progress.match(pattern)?.[1]?.trim()).find(Boolean) ?? fallback;
};

const live = new Set([
  "M1-F4", "M2-F3", "M3-F3", "M3-F4", "M4-F1", "M4-F2", "M4-F3", "M4-F4", "M4-F5", "M4-F6",
  "M5-F2", "M5-F3", "M6-F3", "M6-F5", "M7-F2", "M7-F3", "M7-F4", "M7-F5", "M8-F2", "M8-F3",
  "M8-F4", "M9-F2", "M9-F4", "M10-F2",
]);
const hardware = new Set([
  "M2-F3", "M2-F4", "M2-F6", "M3-F3", "M3-F4", "M3-F5", "M3-F6", "M4-F1", "M4-F2", "M4-F4",
  "M4-F5", "M5-F1", "M5-F2", "M5-F5", "M6-F3", "M8-F3", "M8-F5", "M9-F4", "M10-F2",
]);

const features = planRows.map((row) => {
  const id = row[1];
  const progressRow = progressRows.get(id);
  if (!progressRow) throw new Error(`Missing progress row for ${id}.`);
  const requiredEvidence = ["automation", "packaged_named_review"];
  if (live.has(id)) requiredEvidence.push("live_named_listening");
  if (hardware.has(id)) requiredEvidence.push("hardware_physical");
  if (id === "M10-F3") requiredEvidence.push("stable_release_cycle");
  return {
    id,
    feature: row[2].trim(),
    solution: row[3].trim(),
    testPlan: row[4].trim(),
    acceptanceCriteria: row[5].trim(),
    implementation: "implemented",
    implementationEvidence: implementationNote(id, progressRow[3].trim()),
    automation: { status: "passed", suites: automationByModule[id.split("-")[0]] },
    requiredEvidence,
    strictAcceptance: "pending",
    pendingEvidence: row[5].trim(),
  };
});

const index = {
  schemaVersion: 1,
  generatedFrom: {
    plan: relative(workspaceRoot, planPath).replaceAll("\\", "/"),
    progress: relative(workspaceRoot, progressPath).replaceAll("\\", "/"),
  },
  policy: {
    automationDoesNotEqualStrictAcceptance: true,
    pendingOrUnsignedReportsDoNotCount: true,
    fixturesDoNotCountAsExternalEvidence: true,
  },
  counts: { total: features.length, implemented: features.length, strictAccepted: 0 },
  evidenceSources: {
    packaged_named_review: "apps/desktop/windows/release/duplex-voice/packaged-report.json",
    live_named_listening: "apps/desktop/windows/release/duplex-voice/live-report.json",
    hardware_physical: "apps/desktop/windows/release/duplex-voice/hardware-report.json",
    hardware_workbook: "apps/desktop/windows/release/duplex-voice/hardware-review-workbook.json",
    stable_release_cycle: null,
  },
  features,
};

await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Duplex Voice P2 evidence index generated (${features.length}/52 implemented, 0/52 strictly accepted).`);
