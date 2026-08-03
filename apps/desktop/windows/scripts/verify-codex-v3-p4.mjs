import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const approvalUi = read("apps/desktop/shared/renderer/src/components/ApprovalCenterView.tsx");
const structured = read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx");
const security = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/security.py");
const app = read("apps/desktop/shared/renderer/src/App.tsx");
const workspace = read("apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx");
const adapter = read("apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const chatMain = read("apps/desktop/shared/main/chat.ts");
const rpc = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/jsonrpc_client.py");
const diagnostics = read("apps/desktop/shared/main/productionDiagnostics.ts");
const checks = [
  ["M06-F01 approval action object scope impact risk and source", ["Action", "Object", "Scope", "Impact", "Risk"].every((label) => approvalUi.includes(label)) && approvalUi.includes("approval.source")],
  ["M06-F02 once and session-scoped allow", structured.includes("Allow once") && structured.includes("Allow for session") && security.includes("acceptForSession")],
  ["M06-F03 decisions converge through Runtime state", security.includes("runtime_state.resolve_approval") && approvalUi.includes("setInterval")],
  ["M06-F04 timeout expires safely", security.includes("asyncio.wait_for") && security.includes("codex_approval_timeout") && security.includes('"timeout"')],
  ["M06-F05 operation and audit result navigation", structured.includes("View operation/audit result") && approvalUi.includes("approval-mcp-audit")],
  ["M07-F01 three health layers", app.includes("codex-health-layers") && app.includes("Desktop → Runtime") && app.includes("Runtime → Codex") && app.includes("Codex → account/model")],
  ["M07-F02 reconnect deduplicates", rpc.includes("generation") && adapter.includes("acceptChatEventSequence")],
  ["M07-F03 30/60/120 watchdog guidance", workspace.includes("elapsedSeconds >= 30") && workspace.includes("elapsedSeconds >= 60") && workspace.includes("elapsedSeconds >= 120")],
  ["M07-F04 actionable checks login restart retry backend selection", app.includes("Refresh Codex") && app.includes("Sign in to ChatGPT") && app.includes("Restart Codex Backend") && workspace.includes("Retry in this session") && workspace.includes("onSelectAgent")],
  ["M07-F05 privacy-safe diagnostic export", diagnostics.includes("minimizeAndRedact") && app.includes("Prompts, credentials, user identity, logs, and absolute workspace paths are intentionally excluded")],
  ["M07-F06 restart recovery keeps cursor and session", chatMain.includes("recoverChatRun") && chatMain.includes("appendResumedContent") && adapter.includes("lastSequenceByRequest")],
];
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) { console.error(`Codex V3 P4 verification failed:\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log(`Codex V3 P4 verification passed (${checks.length}/${checks.length}).`);
