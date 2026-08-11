import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeRuntimeErrorEnvelope } from "../../shared/api/errorEnvelope";
import { describeUserFacingError } from "../../shared/renderer/src/userFacingErrors";

const fixtures = [
  ["codex_session_resume_required", "binding"],
  ["codex_authentication_required", "auth"],
  ["codex_connection_eof", "transport"],
  ["codex_contract_incompatible", "contract"],
  ["codex_model_incompatible", "model"],
  ["codex_approval_timeout", "approval"],
  ["input_resource_changed", "resource"],
  ["history_cursor_expired", "history"],
  ["runtime_generation_invalidated", "runtime"],
  ["codex_turn_failed", "backend"],
] as const;

for (const [code, category] of fixtures) {
  const first = describeUserFacingError(Object.assign(new Error("SECRET-PROMPT-CANARY"), { code, retryable: true }), "zh");
  const second = describeUserFacingError(Object.assign(new Error("entirely different backend prose"), { code, retryable: true }), "zh");
  assert.equal(normalizeRuntimeErrorEnvelope({ code }).category, category);
  assert.equal(first.title, second.title, `${code} must not be classified by backend prose`);
  assert.deepEqual(first.actions, second.actions);
  assert.ok(!JSON.stringify(first).includes("SECRET-PROMPT-CANARY"));
}

const supplied = normalizeRuntimeErrorEnvelope({
  code: "opaque", category: "resource", retryable: false,
  recovery_actions: ["remove_resource", "diagnostics"], diagnostic_reference: "diag-safe",
});
assert.deepEqual(supplied.recovery_actions, ["remove_resource", "diagnostics"]);
assert.equal(supplied.diagnostic_reference, "diag-safe");

const source = await readFile(resolve(process.cwd(), "../shared/renderer/src/userFacingErrors.ts"), "utf8");
assert.ok(!source.includes(".match("), "UI error classification must not parse message text with match().");
assert.ok(!source.includes(".includes(error"), "UI error classification must not inspect backend prose.");
assert.ok(source.includes("当前任务需要恢复原有后端绑定。"), "Chinese recovery copy must remain valid UTF-8.");
const adapterSource = await readFile(resolve(process.cwd(), "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
assert.ok(!adapterSource.includes("formatAssistantError"), "Chat rendering must not classify backend message prose.");
const appSource = await readFile(resolve(process.cwd(), "../shared/renderer/src/App.tsx"), "utf8");
for (const action of ["diagnostics", "login_codex", "resync_workspace", "repair_codex", "new_task", "select_model", "remove_resource", "reconnect", "retry"]) {
  assert.ok(appSource.includes(`\"${action}\"`), `Recovery action ${action} must have a UI route.`);
}
console.log("P10 structured error and recovery contract verification passed.");
