import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`M06-F04 user-facing language contract failed: ${message}`);
};

const language = read("../shared/renderer/src/userFacingLanguage.ts");
const errors = read("../shared/renderer/src/userFacingErrors.ts");
const approvals = read("../shared/renderer/src/components/ApprovalCenterView.tsx");
const structured = read("../shared/renderer/src/components/StructuredMessageParts.tsx");
const inspector = read("../shared/renderer/src/components/RunInspectorPanel.tsx");
const app = read("../shared/renderer/src/App.tsx");
const chat = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const workspace = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const agentSquare = read("../shared/renderer/src/components/AgentSquareView.tsx");
const browser = read("../shared/renderer/src/components/PreviewBrowserPanel.tsx");
const plan = read("../../../docs/desktop/opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md");

for (const term of ["OAEP", "JSON-RPC", "HTTPException", "ValueError", "Traceback", "runtime_side_effects", "approval_id", "idempotency_key", "correlation_id", "operation_id", "call_id"]) {
  assert(language.includes(term), `negative terminology guard misses ${term}`);
}
assert(language.includes("userFacingBusinessText") && language.includes("userFacingFailureMessage"), "shared presentation boundary is incomplete");
assert(!errors.includes('"Codex needs you to sign in."') && !errors.includes('"登录 Codex"'), "OpenDrSai error UI still depends on Codex wording");
assert(!errors.includes("backend protocol is not compatible") && !errors.includes("后端协议不兼容"), "protocol wording remains in primary error copy");
assert(!approvals.includes("error instanceof Error ? error.message : String(error)"), "Approval Center still renders raw exceptions");
assert(approvals.match(/userFacingFailureMessage/g)?.length >= 6, "Approval Center failure paths do not share the presentation boundary");
assert(approvals.includes("userFacingBusinessText(approval.businessAction") && approvals.includes("userFacingBusinessText(approval.impact"), "approval business facts are not protected from protocol copy");
assert(!structured.includes("activity.callId.slice(0, 12)"), "chat activity details still expose call identifiers");
assert(structured.includes("执行记录已保存") && structured.includes("userFacingBusinessText(activity.toolName"), "chat activity lacks plain-language execution presentation");
assert(inspector.includes("查看脱敏技术数据") && inspector.includes("userFacingExecutionSource"), "Run inspector does not separate primary copy from technical data");
assert(inspector.indexOf("<details><summary>{zh ? \"查看脱敏技术数据\"") < inspector.indexOf("<pre>{boundedJson(selectedItem.content)}</pre>"), "raw item data is not disclosure-gated");
for (const [name, source] of Object.entries({ app, chat, workspace, agentSquare, browser })) {
  assert(!source.includes("error instanceof Error ? error.message : String(error)"), `${name} still renders raw exceptions in a primary flow`);
  assert(source.includes("userFacingFailureMessage"), `${name} does not use the shared failure presentation boundary`);
}
assert(plan.includes("M06-F04") && plan.includes("主流程不出现裸 JSON、内部异常或协议术语"), "plan acceptance wording changed");

console.log("M06-F04 user-facing language contract passed 23/23 checks.");
