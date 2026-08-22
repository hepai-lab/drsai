import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const read = (path) => readFileSync(resolve(desktopRoot, path), "utf8");
const channels = (source, patterns) => {
  const result = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.add(match[1]);
  }
  return [...result].sort();
};
const difference = (left, right) => left.filter((value) => !right.includes(value));
const ownerRules = [
  [/auth|login|logout|oidc|codex|api-key/, ["identity", "auth"]],
  [/terminal|shell/, ["workspace", "terminal"]],
  [/workspace|worktree|fork|file|git|ide|pdf/, ["workspace", "workspace"]],
  [/chat|agent|thread|approval|anomaly/, ["agent-runtime", "agent"]],
  [/ssh|remote|port-forward/, ["remote-development", "remote"]],
  [/browser|debug|mcp|diagnostic/, ["developer-tools", "tools"]],
  [/workflow|scheduled|background|reusable/, ["automation", "automation"]],
  [/share|channel|presentation/, ["collaboration", "collaboration"]],
  [/voice|notification/, ["experience", "experience"]],
  [/update|install|gateway|health|bootstrap/, ["desktop-foundation", "foundation"]],
];
const ownershipFor = (channel) => {
  const slug = channel.slice("desktop:".length);
  const match = ownerRules.find(([pattern]) => pattern.test(slug));
  const [owner, capability] = match?.[1] ?? ["desktop-foundation", "desktop"];
  return { owner, capability };
};

const preload = channels(read("shared/main/preload.ts"), [
  /ipcRenderer\.invoke\(\s*["'](desktop:[^"']+)["']/g,
]);
const windows = channels(read("windows/src/main/index.ts"), [
  /secureHandle\(\s*["'](desktop:[^"']+)["']/g,
  /ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g,
]);
const macosSource = macosIpcSource(desktopRoot);
const macos = channels(macosSource, [
  /secureHandle\(\s*["'](desktop:[^"']+)["']/g,
  /ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g,
]);
const macosRegistrations = [...macosSource.matchAll(/ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(macosRegistrations).size, macosRegistrations.length, "macOS IPC channel registration must not contain duplicates across registrars");

assert.ok(preload.length > 0, "desktop IPC inventory found no preload invoke channels");
assert.ok(windows.length > 0, "desktop IPC inventory found no Windows handlers");
assert.ok(macos.length > 0, "desktop IPC inventory found no macOS handlers");

const unknownWindows = difference(windows, preload);
const unknownMacos = difference(macos, preload);
assert.deepEqual(unknownWindows, [], `Windows handlers missing from preload contract: ${unknownWindows.join(", ")}`);
assert.deepEqual(unknownMacos, [], `macOS handlers missing from preload contract: ${unknownMacos.join(", ")}`);

const report = {
  schemaVersion: 1,
  counts: { preload: preload.length, windows: windows.length, macos: macos.length },
  macosCoverage: Number((macos.length / preload.length).toFixed(4)),
  missingOnMacos: difference(preload, macos),
  missingOnWindows: difference(preload, windows),
  platformOnly: {
    windows: difference(windows, macos),
    macos: difference(macos, windows),
  },
  channels: preload.map((channel) => ({
    channel,
    status: macos.includes(channel) ? "implemented" : "pending",
    ...ownershipFor(channel),
    testId: `ipc-contract:${channel}`,
  })),
};

assert.equal(report.channels.length, preload.length, "every preload channel must have an inventory record");
for (const entry of report.channels) {
  assert.match(entry.owner, /^[a-z][a-z-]+$/, `${entry.channel} has no valid owner`);
  assert.match(entry.capability, /^[a-z][a-z-]+$/, `${entry.channel} has no valid capability`);
  assert.ok(["implemented", "pending"].includes(entry.status), `${entry.channel} has no valid status`);
  assert.equal(entry.testId, `ipc-contract:${entry.channel}`);
}

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
console.log(`Desktop IPC inventory passed: preload=${preload.length}, windows=${windows.length}, macOS=${macos.length}.`);
console.log(`macOS coverage=${(report.macosCoverage * 100).toFixed(2)}%, missing=${report.missingOnMacos.length}. Use --json for the complete report.`);

if (process.argv.includes("--require-parity")) {
  assert.deepEqual(report.missingOnWindows, [], `Windows IPC parity is incomplete: ${report.missingOnWindows.join(", ")}`);
  assert.deepEqual(report.missingOnMacos, [], `macOS IPC parity is incomplete: ${report.missingOnMacos.join(", ")}`);
}
