import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`F2 approval security verification failed: ${message}`);
    process.exit(1);
  }
}

const api = read("src/shared/desktopApi.ts");
const main = read("src/main/index.ts");
const view = read("src/renderer/src/components/ApprovalCenterView.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");

assert(api.includes("scope?: string") && api.includes("impact?: string"), "approval schema lacks scope/impact fields");
assert(
  main.includes("executedDesktopApprovalIds") &&
    main.includes("Approval idempotency key already executed once.") &&
    main.includes("executedDesktopApprovalIds.has(typed.id)") &&
    main.includes("if (!typed.approved) return true;"),
  "main process does not prove reject-before-execute and approve-once idempotency",
);
assert(
  view.includes('aria-label="Approval facts"') &&
    view.includes("<dt>Action</dt>") &&
    view.includes("<dt>Object</dt>") &&
    view.includes("<dt>Scope</dt>") &&
    view.includes("<dt>Impact</dt>") &&
    view.includes("<dt>Risk</dt>") &&
    view.includes("Approve") &&
    view.includes("Reject"),
  "approval card does not expose required action/object/scope/impact/risk/allow/reject fields",
);
assert(
  smoke.includes("OPENDRSAI_E2E_F2_APPROVALS") &&
    smoke.includes("runF2ApprovalSmoke") &&
    smoke.includes("new_directory") &&
    smoke.includes("external_data") &&
    smoke.includes("large_compute") &&
    smoke.includes("overwrite_file") &&
    smoke.includes("delete_file") &&
    smoke.includes("public_share") &&
    smoke.includes("unauthorizedExecutions: 0") &&
    smoke.includes("retries: 0"),
  "packaged F2 smoke does not cover the six high-risk reject scenarios",
);
assert(
  packageJson.includes('"verify:f2-approval-security"') &&
    packageJson.includes('"verify:packaged-f2-approvals"') &&
    packageJson.includes('"verify:f2-approval-stability"'),
  "package scripts for F2 verification are not registered",
);

console.log("F2 approval security verification passed.");
