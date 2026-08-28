import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const channels = readFileSync(resolve(root, "shared/renderer/src/components/ChannelsView.tsx"), "utf8");
const app = readFileSync(resolve(root, "shared/renderer/src/App.tsx"), "utf8");

assert.match(channels, /mode\?: "channels" \| "data"/, "Channels view must expose separate messaging and data-resource modes.");
assert.match(channels, /adapter\.id === "mobile-chat"\) continue/, "Legacy mobile handoff must not appear as a message channel.");
assert.match(channels, /mode === "channels" && <section[^>]+Chat channel adapters/, "Message channels must own only chat adapters.");
assert.match(channels, /mode === "data" && <section[^>]+Data perceptor connectors/, "External connectors must render under data perceptors.");
assert.doesNotMatch(channels, /aria-label="Input channel adapters"/, "File and voice input methods must not be exposed as Channels integrations.");
assert.match(channels, /readOnly \? .*只读数据/, "Data connector cards must expose a read-only boundary.");
assert.match(channels, /!readOnly &&[\s\S]{0,120}adapter\.requiresApproval/, "Data perceptors must not expose outbound draft actions.");
assert.match(app, /mode="data"/, "Settings must mount data connectors in data-perceptor mode.");
assert.match(app, /capabilitySettingsTab === "perceptors"[\s\S]{0,1000}dataPerceptorsPanel/, "Data connectors must remain in the Perceptors tab of the merged configuration.");
assert.match(app, /remote-workspace-settings-shell/, "Remote Workspace must retain its settings shell.");
assert.match(app, /computer-access-settings-panel/, "Device access must remain under Remote Workspace.");
assert.match(app, /访问本电脑/, "Device access must use the Access this computer product wording.");

console.log("Settings channel boundaries verified.");
