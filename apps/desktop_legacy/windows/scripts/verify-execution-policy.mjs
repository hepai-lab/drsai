import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Execution policy verification failed: ${message}`);
    process.exit(1);
  }
}

const policy = read("../shared/api/executionPolicy.ts");
const browserPolicy = read("../shared/api/browser/actionPolicy.ts");
const mainGate = read("src/main/executionPolicyGate.ts");
const main = read("src/main/index.ts");
const normalizedMain = main.replace(/\r\n/g, "\n");
const chatCommands = read("../shared/renderer/src/chatCommands.ts");
const desktopApi = read("../shared/api/desktopApi.ts");
const terminalPanel = read("../shared/renderer/src/components/TerminalPanel.tsx");
const packageJson = read("package.json");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

for (const text of [
  "ExecutionActionKind",
  "ExecutionPermissionDecision",
  "evaluateExecutionPermission",
  "createExecutionPolicy",
  "read_only",
  "confirm_each",
  "auto_execute",
  "terminal.write",
  "workspace.stage",
  "workspace.revert",
  "workspace.checkpoint",
  "shell.command",
  "git.commit",
  "fork.lifecycle",
  "fork.queue_start",
  "workflow.run",
  "external.service",
  "plan_mode",
]) {
  assert(policy.includes(text), `shared policy missing ${text}`);
}

assert(
  mainGate.includes("getDesktopExecutionPolicy") &&
    mainGate.includes("getMyDrSaiConfig") &&
    mainGate.includes("createExecutionPolicy(config.config)") &&
    mainGate.includes("assertExecutionAllowed") &&
    mainGate.includes("evaluateExecutionPermission(action, policy)") &&
    mainGate.includes("decision.requiresApproval") &&
    mainGate.includes("options.approved !== true"),
  "main process does not expose a reusable execution-policy gate",
);
assert(
  main.includes('assertExecutionAllowed("terminal.create"') &&
  main.includes('assertExecutionAllowed("terminal.write"') &&
    main.includes("approved: true") &&
    main.includes("requestWorkspaceMutationApproval") &&
    main.includes("getWorkspaceMutationActionKind") &&
    main.includes("pendingWorkspaceMutationApprovals") &&
    main.includes("createQueuedWorkspaceMutationResult") &&
    main.includes("executeWorkspaceMutation") &&
    main.indexOf("requestWorkspaceMutationApproval") <
      main.indexOf('requestWorkspaceMutationApproval("stage-file"') &&
    main.indexOf("pendingWorkspaceMutationApprovals.set") <
      main.indexOf("pendingWorkspaceMutationApprovals.get") &&
    main.indexOf("getWorkspaceMutationActionKind(pendingWorkspaceMutation.action)") <
      main.lastIndexOf("executeWorkspaceMutation("),
  "main IPC does not enforce execution policy before terminal/workspace mutations",
);

assert(
  browserPolicy.includes("../executionPolicy") &&
    browserPolicy.includes("BROWSER_EXECUTION_ACTIONS") &&
    browserPolicy.includes("browser.sensitive_interact") &&
    browserPolicy.includes("evaluateExecutionPermission"),
  "browser action policy does not consume shared execution policy",
);
assert(
  chatCommands.includes("describeExecutionPolicyMode") &&
    chatCommands.includes("Execution policy:") &&
    chatCommands.includes("Shell command:"),
  "/permissions output does not expose shared execution policy",
);
assert(
  desktopApi.includes('from "./executionPolicy"') &&
    desktopApi.includes("ExecutionPolicyConfig") &&
    desktopApi.includes("DesktopShellCommandApprovalRequest") &&
    desktopApi.includes("requestShellCommandApproval"),
  "desktop API types do not export execution policy contracts",
);
assert(
    main.includes("requestTerminalShellCommandApproval") &&
    main.includes('actionKind: "shell.command"') &&
    main.includes("pendingShellCommandApprovals") &&
    main.includes("writeTerminalSession(") &&
    main.indexOf("pendingShellCommandApprovals.set") <
      main.indexOf("pendingShellCommandApprovals.get") &&
    terminalPanel.includes("requestShellCommandApproval") &&
    terminalPanel.includes("Command is waiting in Approval Center."),
  "agent shell command runner is not routed through approval center before terminal execution",
);
assert(
    main.includes("requestGitCommitApproval") &&
    main.includes('actionKind: "git.commit"') &&
    main.includes("pendingGitCommitApprovals") &&
    main.includes("executeGitCommit") &&
    normalizedMain.includes('execFile(\n      "git"') &&
    main.indexOf("pendingGitCommitApprovals.set") <
      main.indexOf("pendingGitCommitApprovals.get") &&
    main.indexOf('assertExecutionAllowed("git.commit"') <
      main.lastIndexOf("executeGitCommit(") &&
    desktopApi.includes("DesktopGitCommitApprovalRequest") &&
    desktopApi.includes("requestGitCommitApproval"),
  "git commit producer is not routed through approval center before execution",
);
assert(
  packageJson.includes('"verify:execution-policy"'),
  "package script is not registered",
);
assert(
  roadmap.includes("typed shared execution policy") &&
    roadmap.includes("terminal writes and workspace patch actions are gated"),
  "roadmap evidence does not mention the execution-policy runtime slice",
);

console.log("Execution policy verification passed.");
