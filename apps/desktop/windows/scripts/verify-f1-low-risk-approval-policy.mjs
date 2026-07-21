import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const policyPath = join(root, "..", "shared", "api", "executionPolicy.ts");
const mainPath = join(root, "src", "main", "index.ts");
const source = readFileSync(policyPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const lowRisk = ["chat.model_call", "browser.read", "workspace.read", "workspace.diff", "workspace.checkpoint"];
const mediumRisk = ["browser.interact", "workspace.stage", "terminal.create", "terminal.write", "network.request"];
const highRisk = ["browser.sensitive_interact", "workspace.revert", "shell.command", "git.commit", "fork.lifecycle", "fork.queue_start", "workflow.run", "external.service"];
const allActions = [...lowRisk, ...mediumRisk, ...highRisk];
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks += 1; };

check(new Set(allActions).size === 18, "F1 risk table must classify every execution action exactly once.");
for (const action of lowRisk) check(policy.getExecutionActionRisk(action) === "low", `${action} must be low risk.`);
for (const action of mediumRisk) check(policy.getExecutionActionRisk(action) === "medium", `${action} must be medium risk.`);
for (const action of highRisk) check(policy.getExecutionActionRisk(action) === "high", `${action} must be high risk.`);

const confirmEach = {
  mode: "confirm_each",
  workspaceTrusted: true,
  networkEnabled: true,
  shellEnabled: true,
  externalServicesEnabled: true,
  commitEnabled: true,
  dangerousAllowed: false,
  toolAllowlist: [],
  toolDenylist: [],
};
for (const action of lowRisk) {
  const decision = policy.evaluateExecutionPermission(action, confirmEach);
  check(decision.allowed && !decision.requiresApproval, `${action} must run without approval in confirm-each mode.`);
}
for (const action of [...mediumRisk, ...highRisk]) {
  const decision = policy.evaluateExecutionPermission(action, confirmEach);
  check(decision.allowed && decision.requiresApproval, `${action} must require approval in confirm-each mode.`);
}

const readOnly = { ...confirmEach, mode: "read_only" };
for (const action of lowRisk) {
  const decision = policy.evaluateExecutionPermission(action, readOnly);
  check(decision.allowed && !decision.requiresApproval, `${action} must not create a technical approval interruption in read-only mode.`);
}
check(!policy.evaluateExecutionPermission("workspace.stage", readOnly).allowed, "Read-only mode must block workspace mutation.");

const autoExecute = { ...confirmEach, mode: "auto_execute", dangerousAllowed: true };
for (const action of allActions) {
  const decision = policy.evaluateExecutionPermission(action, autoExecute);
  check(decision.allowed && !decision.requiresApproval, `${action} must respect explicit auto-execute authorization.`);
}

const mainSource = readFileSync(mainPath, "utf8");
check(mainSource.includes("return getExecutionActionRisk(request.actionKind)"), "Approval cards must use the central action-risk table.");
check(!/function normalizeApprovalRisk[\s\S]{0,1000}request\.actionKind ===/.test(mainSource), "Approval risk must not be duplicated as a drifting condition list.");

console.log(`F1 low-risk approval policy passed ${checks}/${checks} contract checks.`);
