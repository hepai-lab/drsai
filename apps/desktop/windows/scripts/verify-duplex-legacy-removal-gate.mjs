import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const manifestPath = resolve(process.argv.find((value) => value.endsWith(".json")) ?? resolve(workspaceRoot, "docs/voice/duplex-voice-legacy-removal-gate.json"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const settings = readFileSync(resolve(workspaceRoot, "apps/desktop/shared/renderer/src/App.tsx"), "utf8");
const preferences = readFileSync(resolve(workspaceRoot, "apps/desktop/shared/renderer/src/voice/useVoicePreferences.ts"), "utf8");
const mode = readFileSync(resolve(workspaceRoot, "apps/desktop/shared/renderer/src/voice/voiceMode.ts"), "utf8");

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.legacyRoute, "streaming_voice");
assert.equal(manifest.uiExposed, false);
assert.equal(manifest.newConfigAllowed, false);
assert.doesNotMatch(settings, /<option\s+value=["']streaming["']/, "Settings must not expose the legacy Streaming voice route.");
assert.match(preferences, /interactionMode === "streaming"[\s\S]{0,120}"serial"/, "Old Streaming preferences must migrate to Serial.");
assert.match(mode, /normalizeVoiceInteractionMode[\s\S]{0,180}value === "duplex" \? value : DEFAULT_VOICE_MODE/, "Runtime normalization must accept only Duplex or the Serial default.");

const telemetry = manifest.migrationTelemetry;
const policy = manifest.removalEligibility;
const telemetryEligible = telemetry.complete === true
  && Number.isInteger(telemetry.sampleSize) && telemetry.sampleSize >= policy.minimumTelemetrySampleSize
  && typeof telemetry.legacySelectionRate === "number" && telemetry.legacySelectionRate >= 0 && telemetry.legacySelectionRate <= policy.maximumLegacySelectionRate
  && typeof telemetry.windowStartedAt === "string" && typeof telemetry.windowEndedAt === "string";
const eligible = manifest.stableReleaseCyclesCompleted >= policy.minimumStableReleaseCycles && telemetryEligible;

if (!eligible) {
  assert.equal(manifest.codeRemovalRequested, false, "Legacy Streaming code removal is fail-closed until release-cycle and telemetry evidence are complete.");
  for (const asset of manifest.rollbackAssets) assert.ok(existsSync(resolve(workspaceRoot, asset)), `Rollback asset is missing before removal eligibility: ${asset}`);
}
if (process.argv.includes("--request-removal")) assert.equal(eligible, true, "Legacy Streaming removal is not eligible yet.");

console.log(`Duplex legacy removal gate passed (UI/config closed, old preference migration retained, removalEligible=${eligible}, rollback=${eligible ? "optional" : "required"}).`);
