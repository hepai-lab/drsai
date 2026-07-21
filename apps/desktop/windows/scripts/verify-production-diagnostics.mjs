import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const stateRoot = join(root, "out", "verification", "production-diagnostics-state");
const productionRoot = join(stateRoot, "desktop", "diagnostics-production");
rmSync(stateRoot, { recursive: true, force: true });
mkdirSync(productionRoot, { recursive: true });
writeFileSync(join(productionRoot, "settings.json"), "{corrupt", "utf8");
const nativeRequire = createRequire(import.meta.url);
const testRequire = (id) => id === "./paths" ? { DRSAI_HOME: stateRoot } : nativeRequire(id);

function loadTypeScript(path) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, testRequire);
  return loaded.exports;
}

const previousMode = process.env.OPENDRSAI_DIAGNOSTICS_MODE;
process.env.OPENDRSAI_DIAGNOSTICS_MODE = "detailed";
try {
  const module = loadTypeScript(join(root, "src", "main", "productionDiagnostics.ts"));
  const service = new module.ProductionDiagnosticsService();
  await service.initialize();
  let status = await service.status();
  assert.equal(status.settings.mode, "detailed");
  assert.ok(status.lockedSettings.includes("mode"));
  assert.ok(status.releaseGates.every((gate) => gate.passed));
  assert.ok(readdirSync(productionRoot).some((name) => name.startsWith("settings.json.corrupt-")), "Corrupt settings must be quarantined.");

  status = await service.update({ mode: "off", retentionDays: 999, diskLimitMb: 1, remoteTransmission: true });
  assert.equal(status.settings.mode, "detailed", "Enterprise-locked settings must not be changed.");
  assert.equal(status.settings.retentionDays, 365);
  assert.equal(status.settings.diskLimitMb, 16);
  assert.equal(status.settings.remoteTransmission, true);
  assert.ok(status.audit.some((entry) => entry.result === "denied"));

  const snapshot = JSON.stringify({ product: "OpenDrSai Desktop", schemaVersion: 1, snapshot: { events: [{ id: "event-1", message: "Bearer super-secret-token", apiToken: "sk_abcdefghijklmnop", source: { content: "private source" } }], rootCause: { summary: "repro" } } });
  const preview = await service.preview(snapshot);
  assert.equal(preview.eventCount, 1);
  assert.ok(preview.sensitiveMatchesRemoved >= 2);
  assert.equal(preview.encrypted, true);
  assert.equal(preview.integritySha256.length, 64);

  const packagePath = join(stateRoot, "support.oddiag");
  const exported = await service.exportPackage(snapshot, packagePath);
  assert.equal(exported.ok, true);
  const envelope = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(envelope.encrypted, true);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.ok(!readFileSync(packagePath, "utf8").includes("super-secret-token"));
  const imported = await service.importPackage(packagePath);
  assert.equal(imported.ok, true);
  assert.equal(imported.preview.eventCount, 1);

  const tamperedPath = join(stateRoot, "tampered.oddiag");
  envelope.payload = `${envelope.payload.slice(0, -2)}AA`;
  writeFileSync(tamperedPath, JSON.stringify(envelope), "utf8");
  await assert.rejects(service.importPackage(tamperedPath));

  for (let index = 0; index < 2_100; index += 1) service.observeEvent(10);
  status = await service.status();
  assert.equal(status.degraded, true);
  assert.ok(status.droppedEvents > 0);

  const mainIndex = readFileSync(join(root, "src", "main", "index.ts"), "utf8");
  const preload = readFileSync(join(root, "..", "shared", "main", "preload.ts"), "utf8");
  const panel = readFileSync(join(root, "..", "shared", "renderer", "src", "components", "DebugPanel.tsx"), "utf8");
  for (const contract of ["production-diagnostics-status", "production-diagnostics-settings", "production-diagnostics-preview", "production-diagnostics-export", "production-diagnostics-import"]) assert.ok(mainIndex.includes(contract), `Missing IPC ${contract}`);
  for (const contract of ["getProductionDiagnosticStatus", "previewDiagnosticPackage", "exportProductionDiagnosticPackage", "importProductionDiagnosticPackage"]) assert.ok(preload.includes(contract), `Missing preload ${contract}`);
  for (const contract of ["Production diagnostics governance", "Privacy-safe diagnostic package", "Release gates", "Audit trail", "Offline import"]) assert.ok(panel.includes(contract), `Missing governance UI ${contract}`);
  console.log("Production diagnostics verification passed (policy locks, normalization, corruption recovery, self-check, privacy minimization, encryption, integrity, offline import, dynamic degradation, release gates, IPC, and UI)." );
} finally {
  if (previousMode === undefined) delete process.env.OPENDRSAI_DIAGNOSTICS_MODE; else process.env.OPENDRSAI_DIAGNOSTICS_MODE = previousMode;
  rmSync(stateRoot, { recursive: true, force: true });
}
