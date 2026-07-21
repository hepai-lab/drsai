import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Chat command verification failed: ${message}`);
    process.exit(1);
  }
}

const commands = read("src/renderer/src/chatCommands.ts");
const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const app = read("src/renderer/src/App.tsx");
const skillSquareView = read("src/renderer/src/components/SkillSquareView.tsx");
const preload = read("src/preload/index.ts");
const mainIndex = read("src/main/index.ts");
const mockDesktopApi = read("src/renderer/src/mockDesktopApi.ts");
const terminalTestResults = read("src/renderer/src/terminalTestResults.ts");
const css = read("src/renderer/src/styles.css");
const packageJson = read("package.json");

const expectedCommands = [
  "model",
  "permissions",
  "plan",
  "goal",
  "diff",
  "review",
  "fix",
  "test",
  "commit",
  "checkpoint",
  "rollback",
  "mcp",
  "mention",
  "compact",
  "memory",
  "skills",
  "agent",
  "fork",
  "status",
  "command",
];

for (const command of expectedCommands) {
  assert(commands.includes(`"${command}"`), `missing /${command} in command registry`);
  assert(commands.includes(`case "${command}"`), `missing /${command} execution branch`);
}

assert(commands.includes("parseChatCommand"), "parser is not exported");
assert(commands.includes("runChatCommand"), "command runner is not exported");
assert(commands.includes("Unknown slash command"), "unknown command feedback is missing");
assert(commands.includes("Local commands are read-only"), "permission boundary feedback is missing");
assert(commands.includes("Gateway ready:"), "status feedback omits gateway readiness");
assert(commands.includes("Command-created context attachments:"), "/status omits command-created context attachment count");
assert(commands.includes("Project memory entries:"), "/status omits project memory count");
assert(commands.includes("Active durable goals:"), "/status omits active durable goal count");
assert(commands.includes("Custom commands:"), "/status omits custom command count");
assert(commands.includes("Available agents:"), "/status omits available agent count");
assert(commands.includes("Available models:"), "/status omits available model count");
assert(commands.includes('attachment.path.startsWith("selection:")'), "/status does not identify command-created selection context");
assert(commands.includes('attachment.path.startsWith("mcp-prompt:")'), "/status does not identify command-created MCP prompt context");
assert(commands.includes("Only visible attachment chips"), "context boundary copy is missing");
assert(commands.includes("describeMcpCommand"), "/mcp does not route to the MCP command handler");
assert(commands.includes("Use `/mcp prompt <name> <prompt text>`"), "/mcp prompt usage copy is missing");
assert(commands.includes("Use `/mcp resource [selector]` or `/mcp tool [selector]`"), "/mcp resource/tool usage copy is missing");
assert(commands.includes("Preparing reviewed MCP"), "/mcp resource/tool reviewed import copy is missing");
assert(commands.includes("`.drsai/mcp-context.json`"), "/mcp resource/tool handoff path copy is missing");
assert(commands.includes("MCP prompt context attached"), "/mcp prompt does not attach reviewed prompt context");
assert(commands.includes("Reviewed MCP prompt context from /mcp prompt"), "/mcp prompt context source note is missing");
assert(commands.includes("This does not connect to or execute an MCP server"), "/mcp prompt boundary copy is missing");
assert(commands.includes('type: "attach-selection"'), "/mention selection does not produce a selection attachment action");
assert(commands.includes("describeMentionCommand"), "/mention does not route to the mention command handler");
assert(commands.includes('kind: "selection"'), "/mention selection does not create a selection attachment");
assert(commands.includes("Manual @selection context"), "/mention selection does not document its context source");
assert(commands.includes("Fix mode"), "/fix local intent feedback is missing");
assert(commands.includes("Test mode"), "/test local intent feedback is missing");
assert(commands.includes("Goal state set"), "/goal set durable feedback is missing");
assert(commands.includes("`goal:` marker"), "/goal durable project-memory marker copy is missing");
assert(commands.includes("Use `/goal set <objective>`, `/goal done <index|id>`, `/goal clear <index|id>`, or `/goal list`."), "/goal durable command usage copy is missing");
assert(commands.includes("Commit workflow"), "/commit local intent feedback is missing");
assert(commands.includes("Workspace checkpoint"), "/checkpoint local checkpoint feedback is missing");
assert(commands.includes("Submitting this command creates a bounded local workspace checkpoint"), "/checkpoint direct create copy is missing");
assert(commands.includes("Open the Files panel to create a bounded workspace checkpoint"), "/checkpoint Files panel guidance is missing");
assert(commands.includes("restore still requires Approval Center confirmation"), "/checkpoint approval boundary copy is missing");
assert(commands.includes("Rollback checkpoint"), "/rollback local rollback feedback is missing");
assert(commands.includes("Use `/rollback list`"), "/rollback list usage copy is missing");
assert(commands.includes("Use `/rollback preview <checkpoint>`"), "/rollback preview usage copy is missing");
assert(commands.includes("Use `/rollback restore <checkpoint>`"), "/rollback restore usage copy is missing");
assert(commands.includes("preview checkpoint differences before restore"), "/rollback preview guidance is missing");
assert(commands.includes("Restore is approval-gated"), "/rollback approval boundary copy is missing");
assert(commands.includes("Fork workflow"), "/fork local intent feedback is missing");
assert(commands.includes("Fork queue workflow"), "/fork queue local intent feedback is missing");
assert(commands.includes("Fork queue handoff"), "/fork handoff local intent feedback is missing");
assert(commands.includes("does not start an agent run or bypass queue-start approval"), "/fork handoff boundary copy is missing");
assert(commands.includes("Fork queue scheduler"), "/fork schedule local intent feedback is missing");
assert(commands.includes("Use `/fork schedule [limit N]`"), "/fork schedule usage copy is missing");
assert(commands.includes("Only ready subtasks are dispatched"), "/fork schedule readiness boundary copy is missing");
assert(commands.includes("parseForkQueueItems"), "/fork queue parser is missing");
assert(commands.includes("parseForkQueueEntries"), "/fork queue structured parser is missing");
assert(commands.includes("Each queued subtask will get its own isolated fork thread"), "/fork queue isolation copy is missing");
assert(commands.includes("Optional @agent prefixes"), "/fork queue agent assignment copy is missing");
assert(commands.includes('evaluateExecutionPermission("git.commit"'), "/commit does not expose git commit policy");
assert(commands.includes("Actual commits must use the policy-gated git workflow"), "/commit boundary copy is missing");
assert(commands.includes('"compact"'), "/compact runtime mode name is missing");
assert(commands.includes("Compact mode"), "/compact runtime mode feedback is missing");
assert(commands.includes("summarize visible context and preserve reusable decisions"), "/compact runtime mode instruction is missing");
assert(commands.includes("describeCompactCommand"), "/compact does not route to command-specific compaction feedback");
assert(commands.includes("Compact memory handoff"), "/compact save feedback is missing");
assert(commands.includes("`compact-summary:` marker"), "/compact save durable marker copy is missing");
assert(commands.includes("Memory context"), "/memory local context feedback is missing");
assert(commands.includes("Skills workflow selector"), "/skills workflow selector feedback is missing");
assert(commands.includes('type: "open-view"'), "/skills does not produce a navigation action");
assert(commands.includes('viewId: "skills_square"'), "/skills does not target Skills Square");
assert(commands.includes("Opening Skills Square focused on"), "/skills does not acknowledge focused targets");
assert(commands.includes('source: "slash_command"'), "/skills focused targets do not record their source");
assert(commands.includes('type: "select-model"'), "/model does not produce a selector action");
assert(commands.includes('type: "select-agent"'), "/agent does not produce a selector action");
assert(commands.includes('type: "set-runtime-mode"'), "mode commands do not produce a runtime mode action");
assert(commands.includes("createRuntimeModeAction"), "runtime mode action builder is missing");
assert(commands.includes("findModel(requested"), "/model does not resolve command arguments against available models");
assert(commands.includes("findAgent(requested"), "/agent does not resolve command arguments against available agents");
assert(commands.includes("currentRuntimeMode"), "/status cannot report the active runtime mode");
assert(commands.includes("Custom commands"), "/command custom command feedback is missing");
assert(commands.includes("describeCustomCommandInvocation"), "custom command alias invocation is missing");
assert(commands.includes('type: "set-input"'), "custom command aliases do not expand into the composer");
assert(commands.includes("{{args}}"), "custom command aliases do not support args placeholders");

assert(chatAdapter.includes("parseChatCommand(text)"), "adapter does not parse slash commands before chat");
assert(chatAdapter.indexOf("parseChatCommand(text)") < chatAdapter.indexOf("if (!canChat) return false"), "slash commands must work before gateway readiness gating");
assert(chatAdapter.includes("publishLocalAssistantResult"), "adapter does not publish local command results");
assert(chatAdapter.includes("applyChatCommandAction(result.action)"), "adapter does not apply command selector actions");
assert(chatAdapter.includes("onSelectModel?.(action.model)"), "adapter does not update selected model from /model");
assert(chatAdapter.includes("onSelectAgent?.(action.agentId)"), "adapter does not update selected agent from /agent");
assert(chatAdapter.includes("onOpenSkillsSquare?.(action.target)"), "adapter does not pass /skills focused targets");
assert(chatAdapter.includes('action.type === "set-input"'), "adapter does not keep custom command expansion local");
assert(chatAdapter.includes("setCurrentRuntimeMode(action.mode)"), "adapter does not persist runtime mode actions");
assert(chatAdapter.includes("maybeApplyCustomCommand"), "adapter does not handle /command custom command changes");
assert(chatAdapter.includes("maybeApplyGoalCommand"), "adapter does not handle durable /goal changes");
assert(chatAdapter.includes('content: `goal: ${setMatch[1].trim()}`'), "/goal set does not persist a durable project-memory goal");
assert(chatAdapter.includes("goal-done:"), "/goal done does not preserve completed durable goals");
assert(chatAdapter.includes("Active durable goals for this workspace:"), "/goal state is not injected into request context");
assert(chatAdapter.includes("formatGoalContent"), "/goal durable state formatting helper is missing");
assert(chatAdapter.includes("maybeImportMcpContext"), "adapter does not handle /mcp resource/tool context imports");
assert(chatAdapter.includes("desktopApi.importMcpContext"), "/mcp resource/tool import does not use the desktop bridge");
assert(chatAdapter.includes("No MCP server connection or tool execution was performed"), "/mcp imported context safety note is missing");
assert(chatAdapter.includes("commandAttachments"), "adapter does not retain command-created context attachments");
assert(chatAdapter.includes('action.type === "attach-selection"'), "adapter does not handle /mention selection attachments");
assert(chatAdapter.includes("clearCommandAttachments"), "adapter cannot clear command-created context attachments");
assert(chatAdapter.includes("removeCommandAttachment"), "adapter cannot remove command-created context attachments");
assert(chatAdapter.includes("currentRuntimeModeRef.current = action.mode"), "adapter does not keep runtime mode available for submit");
assert(chatAdapter.includes("runtime_mode: currentRuntimeModeRef.current"), "adapter does not send runtime mode metadata");
assert(chatAdapter.includes("Current chat runtime mode:"), "adapter does not add runtime mode request instructions");
assert(chatAdapter.includes("clearRuntimeMode"), "adapter does not expose a runtime mode clear action");
assert(chatAdapter.includes("maybeRequestCommitApproval"), "/commit does not request approval from the adapter");
assert(chatAdapter.includes("await maybeApplyCompactCommand(") && chatAdapter.includes("refreshProjectMemory"), "/compact local summary runtime is not wired to async workspace-aware command output");
assert(chatAdapter.includes("buildLocalCompactSummary"), "/compact local summary builder is missing");
assert(chatAdapter.includes("Local context compaction prepared from visible chat only"), "/compact local summary feedback is missing");
assert(chatAdapter.includes("Reusable decisions / follow-ups"), "/compact reusable decision summary is missing");
assert(chatAdapter.includes("no gateway, model provider, external connector, filesystem mutation, or network call was performed"), "/compact local safety boundary copy is missing");
assert(chatAdapter.includes("compact-summary:"), "/compact save does not persist a durable project-memory summary");
assert(chatAdapter.includes("Saved compact summary to project memory"), "/compact save persisted feedback is missing");
assert(chatAdapter.includes("Future natural-language chat includes this reviewed compact summary"), "/compact save request-context follow-up copy is missing");
assert(chatAdapter.includes("maybeApplyWorkspaceCheckpointCommand"), "/checkpoint and /rollback are not wired to checkpoint APIs");
assert(chatAdapter.includes("desktopApi.createWorkspaceCheckpoint"), "/checkpoint does not create a bounded workspace checkpoint");
assert(chatAdapter.includes("desktopApi.listWorkspaceCheckpoints"), "/rollback does not list workspace checkpoints");
assert(chatAdapter.includes("desktopApi.previewWorkspaceCheckpoint"), "/rollback does not preview checkpoint diffs");
assert(chatAdapter.includes("desktopApi.restoreWorkspaceCheckpoint"), "/rollback restore does not use approval-gated restore API");
assert(chatAdapter.includes('action: "list"'), "/rollback list parser branch is missing");
assert(chatAdapter.includes("Rollback checkpoints listed from slash command"), "/rollback list feedback is missing");
assert(chatAdapter.includes("Checkpoint created from slash command"), "/checkpoint result feedback is missing");
assert(chatAdapter.includes("Rollback preview prepared"), "/rollback preview result feedback is missing");
assert(chatAdapter.includes("Checkpoint restore is waiting in Approval Center"), "/rollback restore approval feedback is missing");
assert(chatAdapter.includes("No workspace files are restored until the approval item is accepted"), "/rollback restore safety copy is missing");
assert(chatAdapter.includes("maybeCreateForkThread"), "/fork does not create a local fork thread");
assert(chatAdapter.includes("maybeHandoffForkQueueThread"), "/fork handoff is not handled");
assert(chatAdapter.includes("maybeScheduleForkQueue"), "/fork schedule command is not handled");
assert(chatAdapter.includes("selectSchedulableForkQueueThreads"), "/fork schedule does not select ready queue threads");
assert(chatAdapter.includes("parseForkScheduleLimit"), "/fork schedule does not support bounded dispatch limits");
assert(chatAdapter.includes("compareForkQueueScheduleOrder"), "/fork schedule does not sort queue subtasks deterministically");
assert(chatAdapter.includes("buildForkQueueThreadAssignments"), "/fork schedule does not preserve per-thread assignments");
assert(chatAdapter.includes("Fork queue scheduler selected"), "/fork schedule does not report scheduler selection");
assert(chatAdapter.includes("parseForkHandoffArgs"), "/fork handoff parser is missing");
assert(chatAdapter.includes("desktopApi.updateThread"), "/fork handoff does not persist thread metadata");
assert(chatAdapter.includes("No agent run was started"), "/fork handoff does not preserve no-execution safety copy");
assert(chatAdapter.includes('command.name !== "fork"'), "/fork thread creation is not scoped to the fork command");
assert(chatAdapter.includes("desktopApi.prepareForkWorktree"), "/fork does not prepare an isolated worktree");
assert(chatAdapter.indexOf("desktopApi.prepareForkWorktree") < chatAdapter.indexOf("desktopApi.createThread"), "/fork must prepare a worktree before creating the thread");
assert(chatAdapter.includes("desktopApi.createThread"), "/fork does not use the thread creation bridge");
assert(chatAdapter.includes('kind: "agent_run"'), "/fork does not create an agent-run thread");
assert(chatAdapter.includes("workspacePath: fork.worktreePath"), "/fork thread does not use the isolated worktree path");
assert(chatAdapter.includes("Source workspace has uncommitted changes"), "/fork does not warn about dirty source workspaces");
assert(chatAdapter.includes("Fork thread was not created because isolated worktree creation failed"), "/fork does not fail closed when worktree creation fails");
assert(chatAdapter.includes("forkResult?.threads?.forEach"), "/fork does not report created threads to the app");
assert(chatAdapter.includes("Fork queue created"), "/fork queue does not report queue creation state");
assert(chatAdapter.includes("createdThreads.push"), "/fork queue does not collect created subtask threads");
assert(chatAdapter.includes("resolveForkQueueAgentAssignment"), "/fork queue does not resolve agent assignments");
assert(chatAdapter.includes("resolveForkQueueVisualAgentAssignment"), "/fork queue does not resolve visual composer agent assignments");
assert(chatAdapter.includes("options?.forkQueueAgentAssignments"), "/fork queue does not read structured visual assignment options");
assert(chatAdapter.includes("visualAssignment ?? prefixAssignment"), "/fork queue visual assignment does not take precedence over prefix hints");
assert(chatAdapter.includes("threadAgentAssignments"), "/fork dispatch does not send per-thread agent assignments");
assert(chatAdapter.includes("requestGitCommitApproval"), "/commit is not wired to the git approval bridge");
assert(chatAdapter.includes("buildCommitPreflight"), "/commit preflight builder is missing");
assert(chatAdapter.includes("getWorkspaceGitDiff({ workspacePath, staged: true"), "/commit preflight does not inspect staged diff");
assert(chatAdapter.includes("there are no staged changes"), "/commit preflight does not block empty staged commits");
assert(chatAdapter.includes("DesktopCommitApprovalChecklist"), "/commit preflight does not build a structured checklist");
assert(chatAdapter.includes("checklist: preflight.checklist"), "/commit approval does not pass the structured checklist");
assert(chatAdapter.includes("stagedFiles"), "/commit checklist does not include staged files");
assert(chatAdapter.includes("recentTestResult"), "/commit checklist does not capture recent test result status");
assert(chatAdapter.includes("readRecentTerminalTestResult"), "/commit preflight does not read terminal test results");
assert(chatAdapter.includes("formatRecentTerminalTestResult"), "/commit preflight does not format terminal test results");
assert(chatAdapter.includes("Test commitment:"), "/commit preflight test commitment is missing");
assert(chatAdapter.includes("body: preflight.approvalBody"), "/commit approval does not include the preflight body");
assert(chatAdapter.includes("Commit approval queued in Approval Center"), "/commit approval feedback is missing");
assert(chatAdapter.indexOf('if (action.type === "select-model")') < chatAdapter.indexOf("setCurrentRuntimeMode(action.mode)"), "runtime mode actions can fall through to model selection");
assert(chatAdapter.includes("desktopApi.startChat"), "normal chat backend path is missing");

assert(chatWorkspace.includes("CHAT_COMMAND_NAMES"), "composer does not use command registry");
assert(chatWorkspace.includes("slash-command-panel"), "composer command panel is missing");
assert(chatWorkspace.includes("selectSlashCommand"), "composer cannot insert slash commands");
assert(chatWorkspace.includes('checkpoint: "Create a bounded rollback checkpoint."'), "/checkpoint slash menu description is missing");
assert(chatWorkspace.includes('rollback: "List, preview, or queue an approval-gated checkpoint restore."'), "/rollback slash menu description is missing");
assert(chatWorkspace.includes("parseForkQueueEntries"), "composer does not parse /fork queue entries for visual assignment");
assert(chatWorkspace.includes("composer-fork-queue-agent-panel"), "composer visual fork queue agent panel is missing");
assert(chatWorkspace.includes("forkQueueAgentSelections"), "composer does not retain visual fork queue agent selections");
assert(chatWorkspace.includes("forkQueueAgentAssignments: buildForkQueueAgentAssignments"), "composer does not submit structured fork queue agent assignments");
assert(chatWorkspace.includes("Choose per-subtask agents before queue creation"), "composer fork queue assignment guidance is missing");
assert(chatWorkspace.includes("currentRuntimeMode"), "composer does not receive runtime mode state");
assert(chatWorkspace.includes("composer-runtime-mode-chip"), "composer does not show active runtime mode");
assert(chatWorkspace.includes("onClearRuntimeMode"), "composer cannot clear active runtime mode");
assert(chatWorkspace.includes('selection: "Selection"'), "context preview does not label selection attachments");
assert(chatWorkspace.includes("ClipboardList"), "composer does not show a selection-specific attachment icon");
assert(css.includes(".slash-command-panel"), "slash command panel CSS is missing");
assert(css.includes(".composer-runtime-mode-chip"), "runtime mode chip CSS is missing");
assert(css.includes(".composer-fork-queue-agent-panel"), "fork queue visual assignment panel CSS is missing");
assert(css.includes(".composer-fork-queue-agent-row select"), "fork queue visual assignment select CSS is missing");
assert(app.includes("availableAgents: availableChatAgents"), "App does not pass agent catalog to slash commands");
assert(app.includes("availableModels: availableChatModels"), "App does not pass model catalog to slash commands");
assert(app.includes("onSelectAgent: handleChatAgentSelect"), "App does not wire /agent to selector");
assert(app.includes("onSelectModel: handleChatModelSelect"), "App does not wire /model to selector");
assert(app.includes("skillSquareCommandTarget"), "App does not store /skills focused targets");
assert(app.includes("setSkillSquareCommandTarget(target ?? null)"), "App does not persist /skills focused targets");
assert(app.includes("initialFocus={skillSquareCommandTarget ?? undefined}"), "App does not pass /skills focus into Skills Square");
assert(app.includes("onForkThreadCreated: handleForkThreadCreated"), "App does not wire /fork thread creation");
assert(app.includes("function handleForkThreadCreated(thread: DesktopThread)"), "App does not define a fork thread handler");
assert(app.includes("setActiveThreadId(thread.id)"), "App does not select created fork threads");
assert(app.includes("activeThreadWorkspacePath"), "App does not derive workspace path from the active thread");
assert(app.includes("effectiveWorkspacePath"), "App does not compute an effective workspace path");
assert(app.includes("workspacePath: effectiveWorkspacePath"), "App does not persist active-thread workspace paths");
assert(app.includes('kind: threads.find((item) => item.id === snapshot.threadId)?.kind ?? "chat"'), "App does not preserve fork agent-run thread kind");
assert(app.includes("cwd={effectiveWorkspacePath}"), "Terminal panel does not follow fork worktree paths");
assert(app.includes("workspacePath={effectiveWorkspacePath}"), "Workspace-bound views do not follow fork worktree paths");
assert(app.includes("currentRuntimeMode={chat.currentRuntimeMode}"), "App does not pass runtime mode state to composer");
assert(app.includes("onClearRuntimeMode={chat.clearRuntimeMode}"), "App does not wire runtime mode clearing");
assert(app.includes("...chat.commandAttachments"), "App does not expose command-created context attachments");
assert(app.includes("chat.clearCommandAttachments()"), "App does not clear command-created context attachments after submit");
assert(app.includes("chat.removeCommandAttachment(index)"), "App does not remove command-created context attachments");
assert(preload.includes("desktop:prepare-fork-worktree"), "preload does not expose fork worktree preparation");
assert(preload.includes("desktop:mcp-context-import"), "preload does not expose MCP context import");
assert(mainIndex.includes("prepareForkWorktree"), "main process does not register fork worktree preparation");
assert(mainIndex.includes("importMcpContext"), "main process does not register MCP context import");
assert(mockDesktopApi.includes("prepareForkWorktree"), "mock desktop API does not expose fork worktree preparation");
assert(mockDesktopApi.includes("importMcpContext"), "mock desktop API does not expose MCP context import");
assert(terminalTestResults.includes("recordRecentTerminalTestResult"), "terminal test result recorder is missing");
assert(terminalTestResults.includes("No terminal test run captured for this workspace"), "missing empty recent-test-result fallback");
assert(terminalTestResults.includes("npm\\s+run\\s+(test|verify|typecheck|build)"), "terminal verifier does not recognize npm verification commands");
assert(read("src/renderer/src/components/TerminalPanel.tsx").includes("recordRecentTerminalTestResult(workspaceKey, run)"), "terminal panel does not persist recent test results");
assert(skillSquareView.includes("initialFocus"), "Skills Square cannot receive /skills focused targets");
assert(skillSquareView.includes("filteredWorkflowTemplates"), "Skills Square does not filter workflow templates from command focus");
assert(skillSquareView.includes("matchesWorkflowTemplate"), "Skills Square cannot match focused workflow templates");
assert(skillSquareView.includes("matchesSkill"), "Skills Square cannot match focused skills");
assert(skillSquareView.includes("skill-square-command-focus"), "Skills Square does not render focused command context");
assert(css.includes(".skill-square-command-focus"), "focused /skills command CSS is missing");
assert(css.includes(".workflow-template-card.focused"), "focused workflow template styling is missing");
assert(css.includes(".skill-card.focused"), "focused skill card styling is missing");

assert(packageJson.includes('"verify:chat-commands"'), "package script is not registered");

console.log(`Chat command verification passed (${expectedCommands.length} commands).`);
