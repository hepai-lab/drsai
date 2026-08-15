import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."); const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe"); const archive = resolve(root, "release/win-unpacked/resources/app.asar");
const home = resolve(process.argv[2] ?? join(homedir(), ".drsai-dev")); const output = resolve(process.argv[3] ?? join(root, "release/duplex-voice/packaged-provider-run.json")); const stagedRuntime = resolve(process.env.OPENDRSAI_ACCEPTANCE_RUNTIME_ROOT ?? join(root, ".tmp/bootstrapper-msi3/.drsai/drsai-agent"));
for (const path of [executable, archive, stagedRuntime]) assert.ok(existsSync(path), `Required packaged Provider input is missing: ${path}`);
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-duplex-packaged-run-")); const rawResult = join(temporary, "result.json"); const userData = join(temporary, "electron-user-data");
try {
  const code = await new Promise((resolveExit, reject) => { const child = spawn(executable, [], { cwd: root, env: { ...process.env, DRSAI_HOME: home, DRSAI_REPO: stagedRuntime, OPENDRSAI_RUNTIME_ROOT: stagedRuntime, OPENDRSAI_RUNTIME_PERSIST: "0", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_ENABLE_DUPLEX_VOICE: "1", OPENDRSAI_ELECTRON_USER_DATA: userData, OPENDRSAI_E2E_DUPLEX_PACKAGED_RUN: "1", OPENDRSAI_E2E_RESULT: rawResult, OPENDRSAI_E2E_TIMEOUT_MS: "120000" }, stdio: "ignore", windowsHide: true }); child.once("error", reject); child.once("exit", resolveExit); });
  assert.ok(existsSync(rawResult), `Packaged Duplex Provider run did not write a result (exit ${code}).`); const result = JSON.parse(readFileSync(rawResult, "utf8")); const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = { schemaVersion: 1, kind: "packaged-duplex-provider-run", mode: "duplex", ok: result.ok === true && code === 0, generatedAt: new Date().toISOString(), environment: home.toLowerCase().endsWith(".drsai-dev") ? "development" : "production", gatewayPort: home.toLowerCase().endsWith(".drsai-dev") ? 28642 : 18642, protocolVersion: 2, providerId: "zhizengzeng", modelId: "gpt-realtime-2", artifacts: { executable: { uri: pathToFileURL(executable).toString(), sha256: sha256(executable) }, appAsar: { uri: pathToFileURL(archive).toString(), sha256: sha256(archive) } }, checks: result.checks ?? {}, observed: { uplinkAudioFrames: result.details?.uplinkAudioFrames ?? 0, downlinkAudioDeltas: result.details?.downlinkAudioDeltas ?? 0, interrupts: result.details?.interrupts ?? 0, terminalCount: result.details?.terminalEvents?.length ?? 0 }, terminalEvents: result.details?.terminalEvents ?? [], privacy: result.details?.privacy ?? {}, error: result.error ?? null };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"); const summary = JSON.stringify({ code, checks: report.checks, observed: report.observed, error: report.error }); assert.equal(code, 0, summary); assert.equal(report.ok, true, summary); console.log(JSON.stringify({ output, ...report }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
