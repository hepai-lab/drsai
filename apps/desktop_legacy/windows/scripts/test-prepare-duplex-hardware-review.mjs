import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "opendrsai-hardware-review-"));
const script = new URL("./prepare-duplex-hardware-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
try {
  const developmentPath = join(directory, "development.json"); execFileSync(process.execPath, [script, "--output", developmentPath]);
  const development = JSON.parse(readFileSync(developmentPath, "utf8"));
  assert.equal(development.ok, false); assert.equal(development.tester, null); assert.equal(development.gateway.port, 28642); assert.equal(development.protocolVersion, 2);
  assert.deepEqual(new Set(development.scenarios.flatMap((item) => item.checks)), new Set(["win11Builtin", "speakerAec", "sleepResume", "win10Builtin", "permissionDenied", "usbHeadset", "deviceUnplug", "bluetoothHeadset", "weakNetwork"]));
  assert.ok(development.scenarios.every((item) => item.steps.length >= 2 && item.steps.every((step) => step.passed === null && step.observed === null)));
  assert.ok(Object.values(development.artifacts).every((item) => /^file:/.test(item.uri) && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.deepEqual(development.privacy, { deviceLabelsPersisted: false, transcriptTextPersisted: false, rawAudioRequired: false, credentialsPersisted: false });
  const productionPath = join(directory, "production.json"); execFileSync(process.execPath, [script, "--production", "--output", productionPath]);
  const production = JSON.parse(readFileSync(productionPath, "utf8")); assert.equal(production.gateway.port, 18642); assert.equal(production.gateway.profile, "production");
  console.log("Duplex physical review workbook verified (artifact binding, complete matrix, dev/prod ports, pending signature, and privacy).")
} finally { rmSync(directory, { recursive: true, force: true }); }
