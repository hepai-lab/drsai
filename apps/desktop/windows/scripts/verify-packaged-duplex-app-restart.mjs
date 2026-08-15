import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."); const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe"); const archive = resolve(root, "release/win-unpacked/resources/app.asar");
const home = resolve(process.argv[2] ?? join(homedir(), ".drsai-dev")); const output = resolve(process.argv[3] ?? join(root, "release/duplex-voice/packaged-app-restart-e2e.json"));
const stagedRuntime = resolve(process.env.OPENDRSAI_ACCEPTANCE_RUNTIME_ROOT ?? join(root, ".tmp/bootstrapper-msi3/.drsai/drsai-agent"));
for (const path of [executable, archive, stagedRuntime]) assert.ok(existsSync(path), `Required packaged app restart input is missing: ${path}`);
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-duplex-app-restart-")); const beforePath = join(temporary, "before.json"); const afterPath = join(temporary, "after.json"); const userData = join(temporary, "electron-user-data");
const common = { ...process.env, DRSAI_HOME: home, DRSAI_REPO: stagedRuntime, OPENDRSAI_RUNTIME_ROOT: stagedRuntime, OPENDRSAI_RUNTIME_PERSIST: "0", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_ENABLE_DUPLEX_VOICE: "1", OPENDRSAI_ELECTRON_USER_DATA: userData, OPENDRSAI_E2E_TIMEOUT_MS: "180000" };
const waitForFile = async (path, timeoutMs) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (existsSync(path)) return true; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } return false; };
try {
  const beforeChild = spawn(executable, [], { cwd: root, env: { ...common, OPENDRSAI_E2E_DUPLEX_APP_RESTART_PHASE: "before", OPENDRSAI_E2E_RESULT: beforePath }, stdio: "ignore", windowsHide: true });
  assert.equal(await waitForFile(beforePath, 120000), true, "The pre-kill packaged process did not reach a live Realtime Session.");
  const before = JSON.parse(readFileSync(beforePath, "utf8")); assert.equal(before.ok, true, JSON.stringify(before)); assert.ok(before.details?.sessionId, "The pre-kill Session ID is missing.");
  const mainProcessId = Number(before.details.mainProcessId); assert.ok(Number.isSafeInteger(mainProcessId) && mainProcessId > 0, "The authoritative packaged Main PID is missing.");
  const killed = spawnSync("taskkill.exe", ["/PID", String(mainProcessId), "/T", "/F"], { windowsHide: true, encoding: "utf8" }); assert.equal(killed.status, 0, `Unable to terminate the owned packaged Main process tree: ${killed.stderr || killed.stdout}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  assert.ok(before.details?.historyThreadId, "The committed history probe Thread ID is missing.");
  const afterCode = await new Promise((resolveExit, reject) => { const child = spawn(executable, [], { cwd: root, env: { ...common, OPENDRSAI_E2E_DUPLEX_APP_RESTART_PHASE: "after", OPENDRSAI_E2E_DUPLEX_PREVIOUS_SESSION_ID: before.details.sessionId, OPENDRSAI_E2E_DUPLEX_HISTORY_THREAD_ID: before.details.historyThreadId, OPENDRSAI_E2E_RESULT: afterPath }, stdio: "ignore", windowsHide: true }); child.once("error", reject); child.once("exit", resolveExit); });
  assert.ok(existsSync(afterPath), `The post-restart packaged process did not write a result (exit ${afterCode}).`); const after = JSON.parse(readFileSync(afterPath, "utf8")); const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = { schemaVersion: 1, kind: "packaged-duplex-app-restart", ok: before.ok === true && after.ok === true && afterCode === 0, generatedAt: new Date().toISOString(), homeProfile: home.toLowerCase().endsWith(".drsai-dev") ? "development" : "production", runtimeProfile: "staged_candidate", fault: { domain: "electron_process", injection: "force_kill_owned_packaged_process_tree_with_live_realtime_session", occurrences: 1 }, artifacts: { executable: { sha256: sha256(executable) }, appAsar: { sha256: sha256(archive) } }, before: { checks: before.checks, details: before.details, error: before.error ?? null }, after: { checks: after.checks, details: after.details, error: after.error ?? null } };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"); const summary = JSON.stringify({ afterCode, before: report.before, after: report.after }); assert.equal(afterCode, 0, summary); assert.equal(report.ok, true, summary); console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  try { rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
  catch (error) { console.warn(`Unable to remove isolated app-restart userData immediately: ${error instanceof Error ? error.message : String(error)}`); }
}
