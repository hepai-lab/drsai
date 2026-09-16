import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Settings availability contract.
 *
 * The settings surface must never open a pane whose backend the Desktop
 * Runtime does not serve. Two ways to satisfy that are legitimate:
 *   a) implement the backend, or
 *   b) render the entry disabled with an explicit reason.
 *
 * This verification pins the current, deliberate choice for each gap so the
 * surface cannot silently drift back into "rendered but 404s at mount":
 *
 *   1. desktop_gateway  - the V2 runtime serves no Perceptor / Executor /
 *                         Memory registry, no mobile-pairing enrolment, no
 *                         remote speech synthesis, and no remote env write.
 *                         Those absences are the *reason* for every disabled
 *                         entry below; when one is implemented this check
 *                         fails on purpose so the pane gets re-enabled.
 *   2. windows/platform.ts - the build descriptor states the same gaps as
 *                         false feature capabilities instead of leaving them
 *                         absent (undefined reads as "assume supported").
 *   3. shared/api/platform.ts - the capability keys exist in the shared
 *                         contract so every renderer can gate on them.
 *   4. SettingsPanel.tsx - unavailable panes are disabled with a reason
 *                         (UNAVAILABLE_SETTINGS_PANES for missing backends,
 *                         capabilityDisabledPaneReason for missing features)
 *                         and the Android remote card gates on mobilePairing.
 *   5. shared/main/settings.ts - the API-key sync tolerates a runtime without
 *                         the config-write route instead of rejecting callers.
 *   6. shared/main/myDrSaiConfig.ts + SettingsPanel.tsx - reads of the
 *                         unsupported Perceptor registry degrade to an empty
 *                         registry in the main process, and the renderer does
 *                         not probe the route at all. Both are needed: a
 *                         rejected ipcMain handler is logged by Electron even
 *                         when the renderer catches the rejection, so the
 *                         renderer's .catch() alone cannot keep the log quiet.
 *
 * The point of testing the *absence* of routes is that it is the half that
 * nobody notices breaking: adding a route is silent, but the UI would keep
 * lying about the feature being unavailable.
 */

// Resolve the checkout from the entry path the runner was given rather than
// from `import.meta.url`: the bundled runner executes a copy under a temporary
// directory, so module-relative paths would resolve outside the checkout. Both
// runners pass the entry as argv[2], so this works either way.
const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-desktop-settings-availability.mts");
const testKit = dirname(entryFile);
const desktop = resolve(testKit, "..");
const repo = resolve(testKit, "..", "..", "..", "..");
const gateway = resolve(repo, "cores/python/packages/drsai/src/drsai/backend/desktop_gateway");

const read = (path: string): string => readFileSync(path, "utf8");
const flatten = (source: string): string => source.replace(/\s+/g, " ");

function check(source: string, needle: string, label: string): void {
  assert.ok(flatten(source).includes(flatten(needle)), `missing settings-availability contract: ${label}`);
}

function checkAbsent(source: string, needle: string, label: string): void {
  assert.ok(
    !flatten(source).includes(flatten(needle)),
    `the runtime now serves this route — implement the backend and re-enable the pane: ${label}`,
  );
}

function collectPython(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectPython(full, out);
    else if (entry.name.endsWith(".py")) out.push(full);
  }
  return out;
}

const runtimeSource = collectPython(gateway).map(read).join("\n");
const descriptor = read(resolve(repo, "apps/desktop/windows/src/main/platform.ts"));
const platformContract = read(resolve(desktop, "api/platform.ts"));
const settingsPanel = read(resolve(desktop, "renderer/src/components/SettingsPanel.tsx"));
const mainSettings = read(resolve(desktop, "main/settings.ts"));
const mainConfig = read(resolve(desktop, "main/myDrSaiConfig.ts"));

// 0. Positive control: prove the reader actually sees the runtime route table.
//    Without this, an empty/misresolved directory would make every
//    "route is absent" assertion below pass vacuously.
for (const route of ['"/v1/capabilities"', '"/v1/audio/transcriptions"', '"/v1/workspaces']) {
  check(runtimeSource, route, `runtime route ${route} (reader sanity check)`);
}

// 1. The runtime gaps that justify the disabled entries.
checkAbsent(runtimeSource, '"/v1/config/perceptors', "Perceptor registry (Settings → Perceptors)");
checkAbsent(runtimeSource, '"/v1/executors', "Executor registry (Settings → Executors)");
checkAbsent(runtimeSource, '"/v1/memories', "Memory registry (Settings → Memories)");
checkAbsent(runtimeSource, '"/v1/mobile-pairing', "mobile-pairing enrolment (Settings → Android remote)");
checkAbsent(runtimeSource, '"/v1/audio/speech', "remote speech synthesis (Settings → Voice)");
checkAbsent(runtimeSource, '"/v1/config/env', "remote provider-env write (Settings → API key sync)");
checkAbsent(runtimeSource, '"/v1/feedback', "feedback submission (Settings → Feedback)");

// 2. The build descriptor states the gaps as explicit false capabilities.
check(descriptor, "codexBackend: false,", "Windows descriptor: codexBackend=false");
check(descriptor, "remoteSpeechSynthesis: false,", "Windows descriptor: remoteSpeechSynthesis=false");
check(descriptor, "mobilePairing: false,", "Windows descriptor: mobilePairing=false");

// 3. The shared contract carries the capability keys.
check(platformContract, "mobilePairing: boolean;", "DesktopFeatureCapabilities.mobilePairing");
check(
  platformContract,
  '"remoteWorkspace", "mobilePairing", "portForwarding",',
  "DESKTOP_FEATURE_CAPABILITY_KEYS keeps mobilePairing",
);

// 4. Unavailable panes are disabled with a reason, never silently opened.
check(settingsPanel, "export const UNAVAILABLE_SETTINGS_PANES", "UNAVAILABLE_SETTINGS_PANES registry");
check(settingsPanel, "perceptors: {", "perceptors pane marked unavailable");
check(settingsPanel, "GET /v1/config/perceptors returns 404", "perceptors reason names the missing route");
check(settingsPanel, "executors: {", "executors pane marked unavailable");
check(settingsPanel, "memories: {", "memories pane marked unavailable");
check(settingsPanel, "export function settingsPaneUnavailableReason", "backend-gap reason resolver");
check(settingsPanel, "export function capabilityDisabledPaneReason", "feature-gap reason resolver");
check(settingsPanel, 'pane === "codex" && features?.codexBackend === false', "codex pane gated on codexBackend");
check(settingsPanel, "return settingsPaneUnavailableReason(pane, zh) ?? capabilityDisabledPaneReason(", "single disabled-pane entry point");

// 5. The Android remote surface gates on the capability instead of calling a
//    runtime that cannot answer.
check(settingsPanel, "featureCapabilities?.mobilePairing !== false", "Android device refresh gated on mobilePairing");
check(settingsPanel, "const mobilePairingUnavailableReason = featureCapabilities?.mobilePairing === false", "Android card derives an unavailable reason");
check(settingsPanel, "disabled={Boolean(mobilePairingUnavailableReason)", "Android toggle disabled while unavailable");

// 6. The API-key sync tolerates a runtime without the config-write route.
check(mainSettings, "export async function syncSavedApiKeyToGateway", "syncSavedApiKeyToGateway exists");
check(mainSettings, "} catch { return false; }", "syncSavedApiKeyToGateway returns false on unsupported runtime");

// 7. Reads of the unsupported Perceptor registry degrade instead of rejecting
//    the IPC handler. Electron logs every rejected ipcMain handler without the
//    renderer being able to suppress it, so the tolerance has to live in the
//    main process — and the renderer must not even probe while it is absent.
check(mainConfig, "export class GatewayHttpError extends Error", "gateway errors keep their HTTP status");
check(mainConfig, "throw new GatewayHttpError(response.status", "gatewayRequest throws a status-carrying error");
check(mainConfig, "export function isMissingRouteError", "missing-route error predicate");
check(mainConfig, "if (!isMissingRouteError(error)) throw error;", "unserved-registry read rethrows real failures");
check(mainConfig, "async function readUnservedRegistry<T>", "unserved-registry tolerant read exists");
check(mainConfig, 'readUnservedRegistry<PerceptorResource>("/v1/config/perceptors", gateway.baseUrl', "listPerceptors degrades to an empty registry");
check(mainConfig, 'reportMissingRoute("/v1/config/perceptors/web-search/provider-policy", error.status)', "web-search provider policy degrades with a reason");
check(settingsPanel, "export const PERCEPTOR_REGISTRY_AVAILABLE = !UNAVAILABLE_SETTINGS_PANES.perceptors", "renderer probe gate derives from the pane registry");
check(settingsPanel, "PERCEPTOR_REGISTRY_AVAILABLE ? await desktopApi.listPerceptors().catch(() => []) : []", "Agent resources does not probe the missing registry");
checkAbsent(settingsPanel, "const perceptorRows = await desktopApi.listPerceptors()", "the unguarded perceptor probe (Electron logs the rejected handler)");

console.log(
  "Desktop settings availability verification passed (runtime gaps, descriptor capabilities, disabled-pane reasons, Android mobilePairing gate, API-key sync tolerance, unsupported Perceptor registry read tolerance).",
);
