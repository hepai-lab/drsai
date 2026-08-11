import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktopRoot = resolve(windowsRoot, "..");
const repoRoot = resolve(desktopRoot, "../..");
const python = process.platform === "win32"
  ? resolve(repoRoot, ".venv/Scripts/python.exe")
  : resolve(repoRoot, ".venv/bin/python");

const bundledTest = resolve(desktopRoot, "shared/test-kit/run-bundled-test.mjs");
run(process.execPath, [bundledTest, "scripts/verify-session-sync-state.mts"], windowsRoot, "Desktop restart");
run(process.execPath, [bundledTest, "scripts/verify-oaep-session-stream.mts"], windowsRoot, "Gateway/SSE restart");
run(python, [
  "-m", "pytest", "-q",
  "cores/python/packages/drsai/tests/test_codex_backend_client.py::test_response_then_storage_fault_reuses_ids_without_duplicate_rpc",
  "cores/python/packages/drsai/tests/test_codex_backend_client.py::test_restart_resumes_same_thread_and_unsupported_config_fails_closed",
  "cores/python/packages/drsai/tests/test_codex_backend_client.py::test_runtime_restart_recovery_converges_completed_and_in_progress_deterministically",
], repoRoot, "Codex App Server/Runtime restart");

const chat = readFileSync(resolve(desktopRoot, "shared/main/chat.ts"), "utf8");
const recoveryBody = chat.slice(chat.indexOf("export async function recoverChatRun"), chat.indexOf("export async function respondChatInput"));
assert.ok(recoveryBody.includes("listOaepEvents"), "Desktop recovery must replay the authoritative OAEP journal");
assert.equal(recoveryBody.includes("runChat("), false, "Desktop recovery must never resend the user message");
assert.equal(recoveryBody.includes("createThread("), false, "Desktop recovery must never create a second Thread");

console.log("P7 restart matrix passed: Desktop, Gateway/SSE, and Codex App Server/Runtime converge without replaying input.");

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} verification failed (${result.status}).\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  process.stdout.write(result.stdout || "");
}
