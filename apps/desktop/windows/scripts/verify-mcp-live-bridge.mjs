import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`MCP live bridge verification failed: ${message}`);
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const api = read("src/shared/desktopApi.ts");
const liveBridge = read("src/main/mcpLiveBridge.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const commands = read("src/renderer/src/chatCommands.ts");
const approvalCenter = read("src/renderer/src/components/ApprovalCenterView.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const styles = read("src/renderer/src/styles.css");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const packageJson = read("package.json");

for (const text of [
  "DesktopMcpLiveEnumerationRequest",
  "DesktopMcpLiveEnumerationResult",
  "DesktopMcpToolExecutionApprovalRequest",
  "DesktopMcpToolExecutionApprovalResult",
  "DesktopMcpToolExecutionAuditEntry",
  "DesktopMcpToolExecutionAuditListRequest",
  "DesktopMcpSessionAuditEntry",
  "DesktopMcpSessionAuditListRequest",
  "DesktopMcpActiveSession",
  "DesktopMcpActiveSessionListRequest",
  "DesktopMcpReusableSession",
  "DesktopMcpReusableSessionListRequest",
  "DesktopMcpReusableSessionCloseRequest",
  "DesktopMcpReusableSessionCloseResult",
  "DesktopMcpSessionCancelRequest",
  "DesktopMcpSessionCancelResult",
  'reason?: "reject" | "cancel"',
  "requestMcpLiveEnumeration",
  "requestMcpToolExecutionApproval",
  "listMcpToolExecutionAudits",
  "listMcpSessionAudits",
  "resultContextName",
  "reuseSession?: boolean",
  "reusedSession?: boolean",
  "sessionReuseKey?: string",
  "reusable?: boolean",
  '"reusable_pool"',
  '"restart_reconnect_required"',
  "restartDetectedAt?: string",
  "diagnosticMessage?: string",
  '"closed"',
]) {
  assert(api.includes(text), `shared API missing ${text}`);
}

assert(
  liveBridge.includes(".drsai\", \"mcp-servers.json") &&
    liveBridge.includes(".drsai\", \"mcp-context.json") &&
    liveBridge.includes('method: "resources/list"') &&
    liveBridge.includes('method: "tools/list"') &&
    liveBridge.includes('method: "tools/call"') &&
    liveBridge.includes('method: "initialize"') &&
    liveBridge.includes('method: "notifications/initialized"') &&
    liveBridge.includes("spawn(server.command") &&
    liveBridge.includes("shell: false") &&
    liveBridge.includes("generatedBy: \"desktop-live-mcp-bridge\"") &&
    liveBridge.includes("executeMcpToolAfterApproval") &&
    liveBridge.includes("assertSafeMcpContextWriteTarget") &&
    liveBridge.includes("isSymbolicLink") &&
    liveBridge.includes("desktop-approved-mcp-tool-execution") &&
    liveBridge.includes(".drsai\", \"mcp-execution-audit.json") &&
    liveBridge.includes("recordRejectedMcpToolExecutionAudit") &&
    liveBridge.includes("desktop-mcp-execution-audit") &&
    liveBridge.includes(".drsai\", \"mcp-session-audit.json") &&
    liveBridge.includes("recordMcpSessionAudit") &&
    liveBridge.includes("recordCancelledMcpLiveEnumerationAudit") &&
    liveBridge.includes("recordCancelledMcpToolExecutionAudit") &&
    liveBridge.includes("activeMcpRuntimeSessions") &&
    liveBridge.includes("listMcpActiveSessions") &&
    liveBridge.includes("listMcpReusableSessions") &&
    liveBridge.includes("closeMcpReusableSession") &&
    liveBridge.includes("toReusableSessionSummary") &&
    liveBridge.includes("idleExpiresInMs") &&
    liveBridge.includes("cancelMcpActiveSession") &&
    liveBridge.includes("registerActiveMcpSession") &&
    liveBridge.includes("unregisterActiveMcpSession") &&
    liveBridge.includes("MAX_MCP_REUSABLE_SESSION_IDLE_MS") &&
    liveBridge.includes("reusableMcpSessions") &&
    liveBridge.includes("getReusableMcpSession") &&
    liveBridge.includes("callMcpEnumerationWithReusableSession") &&
    liveBridge.includes("callMcpToolWithReusableSession") &&
    liveBridge.includes("sendPooledMcpRequest") &&
    liveBridge.includes("scheduleReusableMcpIdleShutdown") &&
    liveBridge.includes("recordMcpReusablePoolAudit") &&
    liveBridge.includes("getReusableSessionRestartDiagnostic") &&
    liveBridge.includes("restart_reconnect_required") &&
    liveBridge.includes("Reusable MCP stdio sessions are process-local") &&
    liveBridge.includes("createReusableMcpSessionKey") &&
    liveBridge.includes("listMcpSessionAudits") &&
    liveBridge.includes("desktop-mcp-session-audit") &&
    liveBridge.includes("reusedSession") &&
    liveBridge.includes("sessionReuseKey") &&
    liveBridge.includes('"timed_out"') &&
    liveBridge.includes('status: "cancelled"') &&
    liveBridge.includes('phase: "enumeration"') &&
    liveBridge.includes('phase: "tool_execution"') &&
    liveBridge.includes('phase: "reusable_pool"'),
  "main live bridge does not enumerate or execute bounded stdio MCP requests into the reviewed handoff path",
);
assert(
  main.includes("pendingMcpLiveEnumerations") &&
    main.includes("pendingMcpToolExecutions") &&
    main.includes('actionKind: "network.request"') &&
    main.includes("MCP tool execution is not performed by this approval") &&
    main.includes("enumerateMcpLiveServer(pendingMcpLiveEnumeration)") &&
    main.includes("executeMcpToolAfterApproval(pendingMcpToolExecution, typed.id)") &&
    main.includes('assertExecutionAllowed("network.request", { approved: true })') &&
    main.includes('assertExecutionAllowed("external.service", { approved: true })') &&
    main.includes('actionKind: "external.service"') &&
    main.includes("requestMcpToolExecutionApproval") &&
    main.includes("recordRejectedMcpToolExecutionAudit(pendingMcpToolExecution") &&
    main.includes("recordCancelledMcpLiveEnumerationAudit(pendingMcpLiveEnumeration") &&
    main.includes("recordCancelledMcpToolExecutionAudit(pendingMcpToolExecution") &&
    main.includes('reason === "cancel"') &&
    main.includes("listMcpToolExecutionAudits(request)") &&
    main.includes("listMcpSessionAudits(request)") &&
    main.includes("desktop:mcp-session-audits") &&
    main.includes("listMcpActiveSessions(request)") &&
    main.includes("listMcpReusableSessions(request)") &&
    main.includes("closeMcpReusableSession(request)") &&
    main.includes("cancelMcpActiveSession(request)") &&
    main.includes("desktop:mcp-active-sessions") &&
    main.includes("desktop:mcp-reusable-sessions") &&
    main.includes("desktop:mcp-reusable-session-close") &&
    main.includes("desktop:mcp-session-cancel"),
  "main process does not route live MCP enumeration/tool execution through separate approvals and approved execution",
);
assert(
  preload.includes("desktop:mcp-live-enumerate") &&
    preload.includes("desktop:mcp-tool-execution-approval") &&
    preload.includes("desktop:mcp-execution-audits") &&
    preload.includes("desktop:mcp-session-audits") &&
    preload.includes("desktop:mcp-active-sessions") &&
    preload.includes("desktop:mcp-reusable-sessions") &&
    preload.includes("desktop:mcp-reusable-session-close") &&
    preload.includes("desktop:mcp-session-cancel"),
  "preload does not expose MCP live bridge IPC",
);
assert(
  commands.includes("Use `/mcp sync [server]`") &&
    commands.includes("Use `/mcp sync --reuse [server]`") &&
    commands.includes("Use `/mcp exec <server> <tool> [json]`") &&
    commands.includes("Use `/mcp exec --reuse <server> <tool> [json]`") &&
    commands.includes("Use `/mcp cancel <approval-id>`") &&
    commands.includes("This does not execute MCP tools"),
  "/mcp command help omits live enumeration/tool execution boundaries",
);
assert(
  adapter.includes("maybeRequestMcpLiveBridge") &&
    adapter.includes("desktopApi.requestMcpLiveEnumeration") &&
    adapter.includes("desktopApi.requestMcpToolExecutionApproval") &&
    adapter.includes("desktopApi.decidePendingApproval") &&
    adapter.includes("Cancelled pending MCP approval") &&
    adapter.includes("After approval, run `/mcp resource` or `/mcp tool`") &&
    adapter.includes("Reviewed tool result written") &&
    adapter.includes("reuseSession") &&
    adapter.includes("Reusable MCP session") &&
    adapter.includes("No MCP tool was executed by the context import path"),
  "renderer adapter does not wire live MCP approvals into slash commands",
);
assert(
    mock.includes("requestMcpLiveEnumeration") &&
    mock.includes("requestMcpToolExecutionApproval") &&
    mock.includes("listMcpToolExecutionAudits") &&
    mock.includes("listMcpSessionAudits") &&
    mock.includes("listMcpActiveSessions") &&
    mock.includes("listMcpReusableSessions") &&
    mock.includes("closeMcpReusableSession") &&
    mock.includes("cancelMcpActiveSession") &&
    mock.includes("mockMcpActiveSessions") &&
    mock.includes("mockMcpReusableSessions") &&
    mock.includes("mockMcpExecutionAudits") &&
    mock.includes("mockMcpSessionAudits") &&
    mock.includes("mcp-reuse:mock") &&
    mock.includes("mcp-reuse:mock-restart") &&
    mock.includes("restart_reconnect_required") &&
    mock.includes("Restart diagnostics are read-only lifecycle evidence") &&
    mock.includes("reusedSession") &&
    mock.includes("sessionReuseKey") &&
    mock.includes('status: "approval_queued"') &&
    mock.includes('request.reason === "cancel"') &&
    mock.includes('"cancelled"') &&
    mock.includes("Mock MCP live enumeration is waiting in Approval Center") &&
    mock.includes("MCP tool execution is separately approval-gated"),
  "mock desktop API omits live MCP bridge fixtures",
);
assert(
  approvalCenter.includes("DesktopMcpActiveSession") &&
    approvalCenter.includes("DesktopMcpReusableSession") &&
    approvalCenter.includes("DesktopMcpContextResult") &&
    approvalCenter.includes("listMcpActiveSessions") &&
    approvalCenter.includes("listMcpReusableSessions") &&
    approvalCenter.includes("closeMcpReusableSession") &&
    approvalCenter.includes("cancelMcpActiveSession") &&
    approvalCenter.includes("desktopApi.importMcpContext") &&
    approvalCenter.includes("Attach result") &&
    approvalCenter.includes("approval-mcp-active-panel") &&
    approvalCenter.includes("approval-mcp-reusable-panel") &&
    approvalCenter.includes("Cancel MCP") &&
    approvalCenter.includes("Close idle") &&
    approvalCenter.includes("Close session") &&
    approvalCenter.includes("Reconnect required") &&
    approvalCenter.includes("session.diagnosticMessage") &&
    styles.includes(".approval-mcp-active-panel") &&
    styles.includes(".approval-mcp-reusable-panel") &&
    styles.includes(".approval-mcp-reusable-row") &&
    styles.includes(".approval-mcp-reusable-row.restart_reconnect_required") &&
    styles.includes(".approval-mcp-reconnect-pill") &&
    styles.includes(".approval-mcp-audit-actions") &&
    styles.includes(".approval-mcp-active-row"),
  "approval center does not expose running MCP session cancellation and result attachment controls",
);
assert(
    roadmap.includes("permissioned live MCP") &&
    roadmap.includes("/mcp sync [server]") &&
    roadmap.includes(".drsai/mcp-servers.json") &&
    roadmap.includes(".drsai/mcp-execution-audit.json") &&
    roadmap.includes(".drsai/mcp-session-audit.json") &&
    roadmap.includes("/mcp cancel <approval-id>") &&
    roadmap.includes("running MCP session cancellation") &&
    roadmap.includes("reusable MCP") &&
    roadmap.includes("/mcp exec --reuse") &&
    roadmap.includes("MCP reusable pool close") &&
    roadmap.includes("runtime fake stdio MCP fixture"),
  "roadmap does not record the MCP live bridge slice",
);
assert(
  packageJson.includes('"verify:mcp-live-bridge"'),
  "package script is not registered",
);

const fixtureRoot = join(tmpdir(), `drsai-mcp-live-bridge-${process.pid}`);
const fixtureWorkspace = join(fixtureRoot, "workspace");
const fixtureDrsaiDir = join(fixtureWorkspace, ".drsai");
const fixtureServer = join(fixtureRoot, "fixture-mcp-server.mjs");
const fixturePidLog = join(fixtureRoot, "fixture-pids.log");
const fixtureBridge = join(fixtureRoot, "mcpLiveBridge.fixture.mjs");

mkdirSync(fixtureDrsaiDir, { recursive: true });
writeFileSync(
  fixtureServer,
  `import { appendFileSync } from "node:fs";
import readline from "node:readline";

const pidLog = process.env.FIXTURE_MCP_PID_LOG;
let requestCount = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (!message.id) return;
  requestCount += 1;
  if (message.method === "initialize") {
    if (pidLog) appendFileSync(pidLog, String(process.pid) + "\\n", "utf8");
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "fixture-mcp", version: "1.0.0" }
      }
    });
    return;
  }
  if (message.method === "resources/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        resources: [
          {
            uri: "fixture://state",
            name: "fixture-state",
            title: "Fixture state",
            description: "Runtime fake stdio MCP resource"
          }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes input through the reusable fixture session.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } }
            }
          }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    await wait(180);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: \`echo:\${message.params?.arguments?.query ?? ""}:pid:\${process.pid}:requests:\${requestCount}\`
          }
        ]
      }
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" }
  });
});
`,
  "utf8",
);
writeFileSync(
  join(fixtureDrsaiDir, "mcp-servers.json"),
  `${JSON.stringify(
    {
      version: 1,
      servers: {
        fixture: {
          command: process.execPath,
          args: [fixtureServer],
          env: {
            FIXTURE_MCP_PID_LOG: fixturePidLog,
          },
          description: "Runtime fake stdio MCP fixture",
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const fixtureBridgeSource = liveBridge.replace(
  "const MAX_MCP_REUSABLE_SESSION_IDLE_MS = 120_000;",
  "const MAX_MCP_REUSABLE_SESSION_IDLE_MS = 80;",
);
const transpiledBridge = ts.transpileModule(fixtureBridgeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
}).outputText;
writeFileSync(fixtureBridge, transpiledBridge, "utf8");

try {
  const bridge = await import(`${pathToFileURL(fixtureBridge).href}?run=${Date.now()}`);
  const enumeration = await bridge.enumerateMcpLiveServer({
    workspacePath: fixtureWorkspace,
    server: "fixture",
    reuseSession: true,
  });
  assert(enumeration.status === "completed", "runtime fixture reusable enumeration did not complete");
  assert(enumeration.reusedSession === true, "runtime fixture enumeration did not use a reusable session");
  assert(Boolean(enumeration.sessionReuseKey), "runtime fixture enumeration did not return a reuse key");
  assert(enumeration.resourceCount === 1, "runtime fixture enumeration did not import one resource");
  assert(enumeration.toolCount === 1, "runtime fixture enumeration did not import one tool");
  const pooledAfterEnumeration = bridge.listMcpReusableSessions({ workspacePath: fixtureWorkspace });
  assert(
    pooledAfterEnumeration.some(
      (session) =>
        session.sessionReuseKey === enumeration.sessionReuseKey &&
        session.server === "fixture" &&
        session.status === "idle" &&
        session.pendingRequestCount === 0 &&
        typeof session.idleExpiresInMs === "number",
    ),
    "runtime fixture did not expose idle reusable MCP pool health after enumeration",
  );
  const restartedBridge = await import(`${pathToFileURL(fixtureBridge).href}?restart=${Date.now()}`);
  const restartDiagnostic = restartedBridge.listMcpReusableSessions({ workspacePath: fixtureWorkspace });
  assert(
    restartDiagnostic.some(
      (session) =>
        session.sessionReuseKey === enumeration.sessionReuseKey &&
        session.server === "fixture" &&
        session.status === "restart_reconnect_required" &&
        typeof session.restartDetectedAt === "string" &&
        String(session.diagnosticMessage).includes("process-local") &&
        String(session.diagnosticMessage).includes("/mcp sync --reuse"),
    ),
    "runtime fixture did not expose reusable MCP restart reconnect diagnostics from lifecycle audit",
  );

  const toolPromise = bridge.executeMcpToolAfterApproval(
    {
      workspacePath: fixtureWorkspace,
      server: "fixture",
      tool: "echo",
      input: JSON.stringify({ query: "reuse-fixture" }),
      reuseSession: true,
    },
    "fixture-approval",
  );
  await delay(50);
  const activeSessions = bridge.listMcpActiveSessions({ workspacePath: fixtureWorkspace });
  const pooledWhileRunning = bridge.listMcpReusableSessions({ workspacePath: fixtureWorkspace });
  assert(
    activeSessions.some(
      (session) =>
        session.phase === "tool_execution" &&
        session.reusable === true &&
        session.sessionReuseKey === enumeration.sessionReuseKey,
    ),
    "runtime fixture did not expose the running reusable MCP session",
  );
  assert(
    pooledWhileRunning.some(
      (session) =>
        session.sessionReuseKey === enumeration.sessionReuseKey &&
        session.status === "busy" &&
        session.pendingRequestCount > 0,
    ),
    "runtime fixture did not expose busy reusable MCP pool health during tool execution",
  );
  const toolResult = await toolPromise;
  assert(toolResult.status === "completed", "runtime fixture reusable tool execution did not complete");
  assert(toolResult.reusedSession === true, "runtime fixture tool execution did not use a reusable session");
  assert(
    toolResult.sessionReuseKey === enumeration.sessionReuseKey,
    "runtime fixture enumeration and tool execution did not reuse the same session key",
  );
  assert(
    toolResult.outputPreview.includes("reuse-fixture"),
    "runtime fixture tool result was not written into the reviewed output preview",
  );
  assert(
    bridge.listMcpActiveSessions({ workspacePath: fixtureWorkspace }).length === 0,
    "runtime fixture left a completed MCP session active",
  );

  const pidLines = readFileSync(fixturePidLog, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert(pidLines.length === 1, "runtime fixture started more than one reusable MCP stdio process");

  const context = JSON.parse(readFileSync(join(fixtureDrsaiDir, "mcp-context.json"), "utf8"));
  assert(
    context.generatedBy === "desktop-mcp-reviewed-handoff" &&
      context.servers.fixture.resources.length === 1 &&
      context.servers.fixture.tools.some((tool) => String(tool.name).includes("echo result")),
    "runtime fixture did not preserve reviewed resource/tool context",
  );
  const executionAudits = bridge.listMcpToolExecutionAudits({ workspacePath: fixtureWorkspace });
  assert(
    executionAudits.some(
      (entry) =>
        entry.status === "completed" &&
        entry.reusedSession === true &&
        entry.sessionReuseKey === enumeration.sessionReuseKey,
    ),
    "runtime fixture did not record reusable tool execution audit evidence",
  );
  const sessionAudits = bridge.listMcpSessionAudits({ workspacePath: fixtureWorkspace, limit: 20 });
  assert(
    sessionAudits.some(
      (entry) =>
        entry.phase === "enumeration" &&
        entry.status === "completed" &&
        entry.reusedSession === true,
    ) &&
      sessionAudits.some(
        (entry) =>
          entry.phase === "tool_execution" &&
          entry.status === "completed" &&
          entry.reusedSession === true,
      ) &&
      sessionAudits.some(
        (entry) =>
          entry.phase === "reusable_pool" &&
          entry.status === "started" &&
          entry.sessionReuseKey === enumeration.sessionReuseKey,
      ),
    "runtime fixture did not record reusable enumeration, tool, and pool-start lifecycle audits",
  );
  const closeResult = bridge.closeMcpReusableSession({
    workspacePath: fixtureWorkspace,
    sessionReuseKey: enumeration.sessionReuseKey,
  });
  assert(closeResult.closed === true, "runtime fixture reusable MCP pool close did not report success");
  assert(
    bridge.listMcpReusableSessions({ workspacePath: fixtureWorkspace }).length === 0,
    "runtime fixture reusable MCP pool close left the session visible",
  );
  const closedSessionAudits = bridge.listMcpSessionAudits({ workspacePath: fixtureWorkspace, limit: 20 });
  assert(
    closedSessionAudits.some(
      (entry) =>
        entry.phase === "reusable_pool" &&
        entry.status === "closed" &&
        entry.sessionReuseKey === enumeration.sessionReuseKey &&
        entry.message.includes("closed"),
    ),
    "runtime fixture did not record reusable MCP pool close diagnostics",
  );
  await delay(140);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("MCP live bridge verification passed.");
