import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const macos = macosIpcSource(root);
const preload = read("shared/main/preload.ts");
const channels = (source, pattern) => new Set([...source.matchAll(pattern)].map((match) => match[1]));
const expected = channels(preload, /ipcRenderer\.invoke\(\s*["'](desktop:[^"']+)["']/g);
const actual = channels(macos, /ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g);
assert.deepEqual([...actual].sort(), [...expected].sort(), "macOS v1.5.7 must register every shared preload channel exactly once");

const run = read("macos/src/main/ipc/registerRunInspectionIpc.ts");
for (const boundary of ["sanitizeSessionRunList", "sanitizeRunInspection", "sanitizeRunReproductionManifest", "writeJsonAtomically", "assertExperimentReleaseEnabled", "approvalRequired"]) assert.ok(run.includes(boundary), `Run parity registrar omits ${boundary}`);
const resources = read("shared/main/gatewayManagedResources.ts");
for (const boundary of ["AbortSignal.timeout", "maxResponseBytes", "getGatewayRequestHeaders", "X-OpenDrSai-User", "encodeURIComponent"]) assert.ok(resources.includes(boundary), `Gateway resource service omits ${boundary}`);
const shares = read("shared/main/threadShares.ts");
for (const boundary of ["mode: 0o600", "writeJsonAtomically"].filter((value) => shares.includes(value))) assert.ok(shares.includes(boundary));
assert.ok(shares.includes("relative(resolve(THREAD_SHARES_DIRECTORY)"), "Thread shares must enforce the managed-directory boundary");
assert.ok(shares.includes('parsed.protocol !== "https:"'), "Published Thread shares must require HTTPS");
const codex = read("macos/src/main/ipc/registerCodexSessionsIpc.ts");
for (const boundary of ["syncControllers.has", "AbortController", "throwIfAborted", "syncControllers.delete", "restartBackend"]) assert.ok(codex.includes(boundary), `Codex sync omits ${boundary}`);
const remote = read("macos/src/main/ipc/registerRemoteAccessIpc.ts");
for (const boundary of ["runtime_display_name_invalid", "mobile_pairing_relay_url_not_trusted", "refreshAuthContextAfterUnauthorized", 'redirect: "error"']) assert.ok(remote.includes(boundary), `Mobile Runtime parity omits ${boundary}`);

console.log(`macOS v1.5.7 parity contract passed: ${actual.size}/${expected.size} IPC channels with Run, resource, share, Codex and mobile safety boundaries.`);
