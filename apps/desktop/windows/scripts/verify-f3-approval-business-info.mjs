import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`F3 business approval contract failed: ${message}`);
};

const api = read("src/shared/desktopApi.ts");
const main = read("src/main/index.ts");
const view = read("src/renderer/src/components/ApprovalCenterView.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");

assert(api.includes("businessAction?: string") && api.includes("businessObject?: string") && api.includes("scope?: string") && api.includes("impact?: string"), "business approval schema is incomplete");
assert(main.includes('getStringProperty(typed, "businessAction")') && main.includes('getStringProperty(typed, "businessObject")'), "main process does not sanitize business fields");
assert(main.includes("pendingF3ApprovalEffects") && main.includes("executeF3ApprovalEffect") && main.includes("if (!typed.approved) return true;"), "reject/approve effects are not bound to the approval decision");
assert(view.includes('data-testid="business-approval-card"') && view.includes("approvalBusinessAction") && view.includes("approvalRiskPresentation"), "business approval card is missing");
for (const label of ["要做什么", "涉及对象", "作用范围", "可能影响", "风险说明", "允许并执行", "拒绝并停止"]) assert(view.includes(label), `missing user-facing label: ${label}`);
assert(!view.includes("<span>{approval.source} / {approval.actionKind} / {approval.risk}</span>"), "internal source/action/risk identifiers remain primary copy");
assert(!view.includes("<dd>{approval.actionKind}</dd>"), "raw actionKind remains a primary business fact");
for (const key of ["file_access", "file_modify", "external_send", "large_compute", "file_delete"]) assert(smoke.includes(key), `packaged smoke misses ${key}`);
assert(smoke.includes("Accessibility.getFullAXTree") && smoke.includes("sendInputEvent") && smoke.includes("keyboardReject_") && smoke.includes("keyboardAllow_"), "packaged smoke lacks accessibility-tree or real keyboard coverage");
assert(smoke.includes("plainLanguage_") && smoke.includes("rejectZeroSideEffects_") && smoke.includes("approvedExactlyOnce_") && smoke.includes("cernFixturePreserved"), "packaged smoke lacks terminology, side-effect, or CERN gates");
for (const script of ["verify:f3-approval-business-info", "verify:packaged-f3-approvals", "verify:f3-approval-stability"]) assert(packageJson.includes(`"${script}"`), `package script missing: ${script}`);

console.log("F3 business approval contract passed.");
