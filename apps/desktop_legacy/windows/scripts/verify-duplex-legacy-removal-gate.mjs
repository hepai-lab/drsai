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

assert.equal(manifest.p3RemovalDecision, true, "The authoritative P3 removal decision must be explicit.");
assert.equal(manifest.codeRemovalRequested, true, "P3 requires legacy Streaming runtime removal.");
assert.equal(manifest.supersededBy, "docs/voice/duplex-voice-p3-spec.md#11-明确移除的内容");
assert.ok(Array.isArray(manifest.removedRuntimeAssets) && manifest.removedRuntimeAssets.length > 0);
for (const asset of manifest.removedRuntimeAssets) assert.equal(existsSync(resolve(workspaceRoot, asset)), false, `P3-removed runtime asset still exists: ${asset}`);

console.log("Duplex legacy removal gate passed (P3 removal decision, runtime absence, closed UI/config, and legacy preference migration)." );
