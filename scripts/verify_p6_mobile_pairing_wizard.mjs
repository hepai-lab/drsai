#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const source = resolve("apps/desktop/shared/renderer/src/components/mobilePairingWizard.ts");
const { mobilePairingWizardState } = await import(pathToFileURL(source).href);
const lifecycleSource = resolve("apps/desktop/shared/renderer/src/components/mobilePairingGrantLifecycle.ts");
const { mobilePairingGrantLifecycle } = await import(pathToFileURL(lifecycleSource).href);

const cases = [
  ["unregistered", { readiness: "not_registered", grantStatus: null, scopeValid: true, busy: false, error: false }, "allow", "retry"],
  ["loading", { readiness: null, grantStatus: null, scopeValid: true, busy: true, error: false }, "allow", null],
  ["choose-all", { readiness: "ready", grantStatus: null, scopeValid: true, busy: false, error: false }, "scope", "create_qr"],
  ["choose-empty", { readiness: "ready", grantStatus: null, scopeValid: false, busy: false, error: false }, "scope", null],
  ["scan", { readiness: "ready", grantStatus: "pending", scopeValid: true, busy: false, error: false }, "scan", null],
  ["expired", { readiness: "ready", grantStatus: "expired", scopeValid: true, busy: false, error: false }, "scan", "refresh_qr"],
  ["wrong-account", { readiness: "ready", grantStatus: null, scopeValid: true, busy: false, error: true }, "allow", "retry"],
  ["success", { readiness: "ready", grantStatus: "consumed", scopeValid: true, busy: false, error: false }, "complete", "done"],
];

for (const [name, input, step, action] of cases) {
  const actual = mobilePairingWizardState(input);
  assert.equal(actual.step, step, `${name}:step`);
  assert.equal(actual.primaryAction, action, `${name}:primary`);
  assert.ok(actual.primaryAction === null || typeof actual.primaryAction === "string", `${name}:one-primary`);
}

const dialog = await import("node:fs/promises").then(({ readFile }) =>
  readFile(resolve("apps/desktop/shared/renderer/src/components/MobilePairingDialog.tsx"), "utf8"));
assert.match(dialog, /aria-label=\{zh \? "连接步骤"/);
assert.match(dialog, /data-testid="mobile-pairing-primary"/);
assert.match(dialog, /hidden=\{wizard\.step !== "scope"\}/);
assert.doesNotMatch(dialog, /scopeChangeInitializedRef/);
assert.doesNotMatch(dialog, /Manual pairing code|手工配对码|<code>|copyTextSafely/);
assert.match(dialog, /activeGrantRef\.current\?\.grant_id !== grant\.grant_id/);

const expiry = "2026-01-01T00:02:00.000Z";
assert.deepEqual(mobilePairingGrantLifecycle("pending", expiry, Date.parse("2026-01-01T00:00:00.000Z")), {
  status: "pending", secondsLeft: 120, refreshRequired: false,
});
assert.deepEqual(mobilePairingGrantLifecycle("pending", expiry, Date.parse(expiry)), {
  status: "expired", secondsLeft: 0, refreshRequired: true,
});
assert.equal(mobilePairingGrantLifecycle("consumed", expiry, Date.parse(expiry) + 1).status, "consumed");
assert.equal(mobilePairingGrantLifecycle("revoked", expiry, 0).refreshRequired, true);

const { readFile } = await import("node:fs/promises");
const androidJourney = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemotePairingJourney.kt"), "utf8");
const androidHome = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"), "utf8");
const androidApp = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"), "utf8");
for (const marker of ["SCANNING", "CONNECTING", "COMPLETE", "FAILED", "remote_pairing_payload_without_scan"]) {
  assert.ok(androidJourney.includes(marker), `android-journey:${marker}`);
}
for (const marker of ["beginAssociationScan", "cancelAssociationScan", "RemotePairingJourneyEvent.Connected", "remoteActionableFailure(failure)"]) {
  assert.ok(androidHome.includes(marker), `android-home:${marker}`);
}
assert.match(androidApp, /addOnCanceledListener\(remoteViewModel::cancelAssociationScan\)/);

console.log(JSON.stringify({ passed: true, journeys: cases.length, primary_actions_per_state: 1, steps: 4,
  android_stages: 5, lifecycle_boundaries: 4, plaintext_codes: 0 }));
