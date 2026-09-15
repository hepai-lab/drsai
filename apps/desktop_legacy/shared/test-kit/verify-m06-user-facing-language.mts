import assert from "node:assert/strict";
import {
  userFacingBusinessText,
  userFacingExecutionSource,
  userFacingFailureMessage,
} from "../renderer/src/userFacingLanguage";

const fallback = "安全的业务说明";
assert.equal(userFacingBusinessText("更新 CERN 分析报告", fallback), "更新 CERN 分析报告");
assert.equal(userFacingBusinessText("第一行\n第二行", fallback), "第一行 第二行");

for (const hostile of [
  '{"approval_id":"approval-1","operation":"tool.write"}',
  "OAEP session snapshot failed",
  "HTTPException: invalid cursor",
  "ValueError: runtime_side_effects is locked",
  "Traceback at RuntimeEngine.claim_side_effect (engine.py:88)",
  "tool.started correlation_id=secret",
  "idempotency_key=side-effect:approval-1",
]) {
  assert.equal(userFacingBusinessText(hostile, fallback), fallback, hostile);
}

for (const language of ["zh", "en"] as const) {
  const message = userFacingFailureMessage(
    { code: "runtime_side_effects_failed", message: "Traceback: ValueError approval_id" },
    language,
    "approval",
  );
  assert.doesNotMatch(message, /Codex|OAEP|JSON-RPC|Traceback|ValueError|approval_id|runtime_side_effects|protocol/i);
  assert.ok(message.length > 20);
}

assert.equal(userFacingExecutionSource("opendrsai@1", "zh"), "OpenDrSai");
assert.equal(userFacingExecutionSource("windows-desktop", "zh"), "本机应用");
assert.equal(userFacingExecutionSource("unknown_backend_v4", "zh"), "已记录的执行来源");

console.log("M06-F04 user-facing language behavior passed 14/14 checks.");
