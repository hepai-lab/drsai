#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modelPath = resolve("apps/desktop/shared/main/mobileRemoteDiagnostics.ts");
const { classifyMobileRemoteDiagnostics, buildMobileRemoteDiagnosticPackage } =
  await import(pathToFileURL(modelPath).href);

const ok = {
  runtime: "ok", relay: "ok", oidc: "ok", device_proof: "ok",
  wss: "ok", heartbeat: "ok", protocol: "ok", push: "ok",
};
const fixtures = [
  ok,
  { ...ok, runtime: "failed" },
  { ...ok, relay: "failed" },
  { ...ok, oidc: "failed" },
  { ...ok, device_proof: "failed" },
  { ...ok, protocol: "failed" },
  { ...ok, push: "failed" },
];
const expected = [
  "none", "start_runtime", "retry_relay", "sign_in",
  "repair_device_identity", "update_runtime", "enable_notifications",
];
assert.deepEqual(fixtures.map(classifyMobileRemoteDiagnostics).map(({ action }) => action), expected);
assert.equal(classifyMobileRemoteDiagnostics({ ...ok, relay: "unknown", push: "unknown" }).action, "none");

const packages = fixtures.map(classifyMobileRemoteDiagnostics).map(buildMobileRemoteDiagnosticPackage);
for (const diagnostic of packages) {
  assert.deepEqual(Object.keys(diagnostic).sort(), ["action", "checks", "schema_version", "status"]);
  const encoded = JSON.stringify(diagnostic);
  assert.doesNotMatch(encoded, /token|authorization|password|secret|message|body|workspace[_-]?path|[A-Z]:\\|\/home\//i);
}

const androidModel = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteConnectionDiagnostic.kt"), "utf8");
const androidUi = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt"), "utf8");
const androidViewModel = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"), "utf8");
for (const marker of [
  "START_COMPUTER", "RETRY_CONNECTION", "SIGN_IN", "REPAIR_DEVICE", "UPDATE", "ENABLE_NOTIFICATIONS",
]) assert.ok(androidModel.includes(marker), `android-diagnostic-action:${marker}`);
assert.ok(androidUi.includes('Text("检查连接")'), "android-diagnostic-entry");
assert.ok(androidViewModel.includes("fun diagnoseConnection()"), "android-diagnostic-owner");

const desktopUi = await readFile(resolve("apps/desktop/shared/renderer/src/App.tsx"), "utf8");
assert.ok(desktopUi.includes('data-testid="android-runtime-diagnose"'), "desktop-diagnostic-entry");

console.log(JSON.stringify({
  passed: true,
  fixtures: fixtures.length,
  unique_actions: new Set(expected).size,
  diagnostic_packages_scanned: packages.length,
  sensitive_matches: 0,
  clients: ["desktop", "android"],
}));
