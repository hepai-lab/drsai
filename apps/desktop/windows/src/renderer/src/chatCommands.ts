import type {
  ChatAttachment,
  DesktopAgent,
  DesktopCustomCommand,
  DesktopProjectMemoryEntry,
  MyDrSaiModelConfig,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import {
  createExecutionPolicy,
  describeExecutionPolicyMode,
  evaluateExecutionPermission,
} from "@shared/executionPolicy";
import type { ChatSubmitOptions } from "./components/ChatWorkspace";

export const CHAT_COMMAND_NAMES = [
  "model",
  "permissions",
  "plan",
  "goal",
  "diff",
  "review",
  "fix",
  "test",
  "commit",
  "mcp",
  "mention",
  "compact",
  "memory",
  "skills",
  "agent",
  "fork",
  "status",
  "command",
] as const;

export type ChatCommandName = (typeof CHAT_COMMAND_NAMES)[number];

export interface ParsedChatCommand {
  raw: string;
  name: string;
  args: string;
  known: boolean;
}

export interface ChatCommandContext {
  attachments: ChatAttachment[];
  availableAgents?: DesktopAgent[];
  availableModels?: MyDrSaiModelConfig[];
  canChat: boolean;
  currentRuntimeMode?: ChatRuntimeMode;
  customCommands?: DesktopCustomCommand[];
  options?: ChatSubmitOptions;
  projectMemory?: DesktopProjectMemoryEntry[];
  workspaceInstructions?: WorkspaceInstructionSummary[];
  workspacePath?: string;
}

export type ChatRuntimeModeName =
  | "plan"
  | "goal"
  | "review"
  | "fix"
  | "test"
  | "commit"
  | "fork";

export interface ChatRuntimeMode {
  name: ChatRuntimeModeName;
  label: string;
  description: string;
  intent?: string;
  activatedBy: string;
}

export type ChatCommandAction =
  | {
      type: "select-agent";
      agentId: string;
      agentName: string;
    }
  | {
      type: "select-model";
      model: string;
      label: string;
    }
  | {
      type: "set-runtime-mode";
      mode: ChatRuntimeMode;
    }
  | {
      type: "attach-selection";
      attachment: ChatAttachment;
    }
  | {
      type: "open-view";
      viewId: "skills_square";
      target?: {
        query: string;
        source: "slash_command";
      };
    }
  | {
      type: "set-input";
      input: string;
      sourceCommand: string;
    };

export interface ChatCommandResult {
  action?: ChatCommandAction;
  title: string;
  content: string;
}

const COMMAND_SET = new Set<string>(CHAT_COMMAND_NAMES);

export function parseChatCommand(input: string): ParsedChatCommand | null {
  const raw = input.trim();
  if (!raw.startsWith("/") || raw === "/") return null;
  const match = raw.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return {
    raw,
    name,
    args: match[2]?.trim() ?? "",
    known: COMMAND_SET.has(name),
  };
}

export function runChatCommand(
  command: ParsedChatCommand,
  context: ChatCommandContext,
): ChatCommandResult {
  if (!command.known) {
    const customResult = describeCustomCommandInvocation(command, context);
    if (customResult) return customResult;
    return {
      title: "Unknown command",
      content: [
        `Unknown slash command: \`/${command.name}\`.`,
        "",
        `Available commands: ${CHAT_COMMAND_NAMES.map((name) => `\`/${name}\``).join(", ")}.`,
      ].join("\n"),
    };
  }

  switch (command.name as ChatCommandName) {
    case "model":
      return describeModelCommand(command.args, context);
    case "permissions":
      return describePermissionsCommand(context);
    case "plan":
      return describeModeCommand("plan", "Plan mode", "Use this chat to ask for an implementation plan before execution.", command.args);
    case "goal":
      return describeModeCommand("goal", "Goal mode", "Track a concrete objective and completion criteria in the current thread.", command.args);
    case "diff":
      return describeContextCommand("Diff context", "Open the Files panel and add workspace or file diff context before sending.", context);
    case "review":
      return describeModeCommand("review", "Review mode", "Ask for findings first, ordered by severity, with file and line references.", command.args);
    case "fix":
      return describeModeCommand("fix", "Fix mode", "Ask for a focused bug fix with implementation, verification, and risk notes.", command.args);
    case "test":
      return describeModeCommand("test", "Test mode", "Ask for relevant automated tests or a targeted verification run before broader execution.", command.args);
    case "commit":
      return describeCommitCommand(command.args);
    case "mcp":
      return describeMcpCommand(command.args, context);
    case "mention":
      return describeMentionCommand(command.args, context);
    case "compact":
      return describeContextCommand("Compact context", "Review the queued context before asking the model to summarize or compact it.", context);
    case "memory":
      return describeMemoryCommand(command.args, context);
    case "skills":
      return describeSkillsCommand(command.args, context);
    case "agent":
      return describeAgentCommand(command.args, context);
    case "fork":
      return describeForkCommand(command.args);
    case "status":
      return describeStatusCommand(context);
    case "command":
      return describeCustomCommandManager(command.args, context);
  }
}

function describeCustomCommandManager(args: string, context: ChatCommandContext): ChatCommandResult {
  if (!context.workspacePath) {
    return {
      title: "Custom commands",
      content: "Select a workspace before listing or editing custom commands.",
    };
  }
  const trimmed = args.trim();
  if (/^add\s+/i.test(trimmed)) {
    return {
      title: "Custom command add",
      content: [
        "The custom command will be saved for this workspace.",
        "Use `/command add <name> = <prompt with optional {{args}}>` to create or replace a command.",
        "Invoking a saved command expands its prompt into the composer for review before sending.",
      ].join("\n"),
    };
  }
  if (/^(?:delete|remove)\s+/i.test(trimmed)) {
    return {
      title: "Custom command delete",
      content: "The selected workspace custom command will be removed after this local command runs.",
    };
  }
  const commands = context.customCommands ?? [];
  const lines = commands.length
    ? commands
        .slice(0, 12)
        .map((entry, index) => `${index + 1}. \`/${entry.name}\` - ${entry.title}`)
    : ["No custom commands have been saved for this workspace."];
  return {
    title: "Custom commands",
    content: [
      "Custom commands are workspace-scoped reusable prompt templates.",
      "",
      ...lines,
      "",
      "Use `/command add <name> = <prompt>`, `/command delete <name>`, or invoke a saved command as `/<name> [args]`.",
      "Templates may include `{{args}}`; without that token, invocation args are appended under an Arguments section.",
    ].join("\n"),
  };
}

function describeCustomCommandInvocation(
  command: ParsedChatCommand,
  context: ChatCommandContext,
): ChatCommandResult | null {
  const customCommand = (context.customCommands ?? []).find(
    (entry) => normalizeCommandToken(entry.name) === normalizeCommandToken(command.name),
  );
  if (!customCommand) return null;
  const expanded = expandCustomCommandPrompt(customCommand.prompt, command.args);
  return {
    action: {
      type: "set-input",
      input: expanded,
      sourceCommand: customCommand.name,
    },
    title: "Custom command expanded",
    content: [
      `Expanded \`/${customCommand.name}\` into the composer for review.`,
      "Nothing was sent automatically; submit the expanded prompt when ready.",
    ].join("\n"),
  };
}

function expandCustomCommandPrompt(prompt: string, args: string): string {
  const trimmedArgs = args.trim();
  if (prompt.includes("{{args}}")) {
    return prompt.replaceAll("{{args}}", trimmedArgs);
  }
  if (!trimmedArgs) return prompt;
  return [prompt, "", "Arguments:", trimmedArgs].join("\n");
}

function describeSkillsCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const query = args.trim();
  return {
    action: {
      type: "open-view",
      viewId: "skills_square",
      ...(query ? { target: { query, source: "slash_command" } } : {}),
    },
    title: "Skills workflow selector",
    content: [
      query
        ? `Opening Skills Square focused on: ${query}.`
        : "Opening Skills Square so reusable skills, project memory, and workflow marketplace recipes can be reviewed before execution.",
      `Current context attachments: ${context.attachments.length}.`,
      "Workflow recipes still run through their explicit chat, terminal, manual review, and Approval Center checkpoints.",
    ].join("\n"),
  };
}

function describeForkCommand(args: string): ChatCommandResult {
  if (/^(?:schedule|auto|autoschedule)\b/i.test(args.trim())) {
    return {
      action: createRuntimeModeAction(
        "fork",
        "Fork queue scheduler",
        "Schedule approved ready fork queue subtasks by queue order without bypassing Approval Center.",
        args,
      ),
      title: "Fork queue scheduler",
      content: [
        "Use `/fork schedule [limit N]` to auto-select approved ready fork queue subtasks for the current workspace.",
        "The scheduler orders subtasks by queue group, queue index, and update time before dispatch.",
        "Only ready subtasks are dispatched; queue-start approval and normal agent run safeguards still apply.",
      ].join("\n"),
    };
  }
  if (/^handoff\b/i.test(args.trim())) {
    return {
      action: createRuntimeModeAction(
        "fork",
        "Fork queue handoff",
        "Reassign an existing queued fork subtask to a different agent without starting execution.",
        args,
      ),
      title: "Fork queue handoff",
      content: [
        "Use `/fork handoff <thread-id> <agent>` to change the assigned agent for a queued fork subtask.",
        "The handoff only updates thread metadata; it does not start an agent run or bypass queue-start approval.",
        "Approved ready queues still dispatch through `/fork dispatch`.",
      ].join("\n"),
    };
  }
  if (/^(?:dispatch|start|run)\b/i.test(args.trim())) {
    return {
      action: createRuntimeModeAction(
        "fork",
        "Fork queue dispatch",
        "Dispatch approved ready fork queue subtasks to agent runs.",
        args,
      ),
      title: "Fork queue dispatch",
      content: [
        "Approved ready fork queue subtasks for the current workspace will be dispatched to agent runs.",
        "Each subtask keeps its isolated worktree and records running, completed, or blocked queue state on the thread.",
      ].join("\n"),
    };
  }
  const queueItems = parseForkQueueEntries(args);
  const description = "Forks should create isolated threads or worktrees before code execution.";
  if (queueItems.length > 1) {
    return {
      action: createRuntimeModeAction("fork", "Fork workflow", description, args),
      title: "Fork queue workflow",
      content: [
        description,
        `Queued subtasks: ${queueItems.length}.`,
        ...queueItems.map((item, index) =>
          `${index + 1}. ${item.agentHint ? `@${item.agentHint} ` : ""}${item.intent}`,
        ),
        "Each queued subtask will get its own isolated fork thread and worktree before execution.",
        "Optional @agent prefixes assign a queued subtask to a specific agent during dispatch.",
      ].join("\n"),
    };
  }
  return describeModeCommand("fork", "Fork workflow", description, args);
}

function describeMemoryCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const trimmed = args.trim();
  if (!context.workspacePath) {
    return {
      title: "Project memory",
      content: "Select a workspace before listing, adding, or clearing project memory.",
    };
  }
  if (/^add\s+/i.test(trimmed)) {
    return {
      title: "Project memory add",
      content: [
        "The note will be saved to durable project memory for the current workspace.",
        "Saved project memory is visible through `/memory` and included as explicit context in later natural-language chat.",
      ].join("\n"),
    };
  }
  if (/^retrospective\s+/i.test(trimmed)) {
    return {
      title: "Project memory retrospective",
      content: [
        "The retrospective will be saved as durable project memory for future similar tasks.",
        "Use this for lessons, verification notes, and reusable workflow decisions after a task.",
      ].join("\n"),
    };
  }
  if (/^edit\s+/i.test(trimmed)) {
    return {
      title: "Project memory edit",
      content: "The selected project memory entry will be replaced after this local command runs.",
    };
  }
  if (/^(?:delete|remove)\s+/i.test(trimmed)) {
    return {
      title: "Project memory delete",
      content: "The selected project memory entry will be removed after this local command runs.",
    };
  }
  if (/^clear(?:\s+all)?$/i.test(trimmed)) {
    return {
      title: "Project memory clear",
      content: "Project memory for the current workspace will be cleared after this local command runs.",
    };
  }

  const entries = context.projectMemory ?? [];
  const lines = entries.length
    ? entries
        .slice(0, 8)
        .map((entry, index) => `${index + 1}. ${entry.content}`)
    : ["No project memory has been saved for this workspace."];
  return {
    title: "Memory context",
    content: [
      "Project memory is explicit, reviewable context for this workspace.",
      "",
      ...lines,
      "",
      "Use `/memory add <note>`, `/memory retrospective <note>`, `/memory edit <index|id> <note>`, `/memory delete <index|id>`, or `/memory clear`.",
    ].join("\n"),
  };
}

function describeModelCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const requested = args.trim();
  if (!requested) {
    return {
      title: "Model command",
      content: [
        `Selected model: ${context.options?.model || "default"}.`,
        "Use `/model <alias>` to change the active model for the next natural-language message.",
      ].join("\n"),
    };
  }

  const model = findModel(requested, context.availableModels ?? []);
  if (!model) {
    return {
      title: "Model not found",
      content: [
        `No available model matched \`${requested}\`.`,
        availableModelHint(context.availableModels ?? []),
      ].join("\n"),
    };
  }

  const modelValue = model.alias || model.model || requested;
  const label = getModelLabel(model);
  return {
    action: {
      type: "select-model",
      model: modelValue,
      label,
    },
    title: "Model selected",
    content: [
      `Selected model: ${label}.`,
      "The composer model selector has been updated for the next natural-language message.",
    ].join("\n"),
  };
}

function describeAgentCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const requested = args.trim();
  if (!requested) {
    return {
      title: "Agent command",
      content: [
        `Selected agent: ${context.options?.agentName || "OpenDrSai"}.`,
        "Use `/agent <id-or-name>` to route the next natural-language message.",
      ].join("\n"),
    };
  }

  const agent = findAgent(requested, context.availableAgents ?? []);
  if (!agent) {
    return {
      title: "Agent not found",
      content: [
        `No available agent matched \`${requested}\`.`,
        availableAgentHint(context.availableAgents ?? []),
      ].join("\n"),
    };
  }

  return {
    action: {
      type: "select-agent",
      agentId: agent.id,
      agentName: agent.name,
    },
    title: "Agent selected",
    content: [
      `Selected agent: ${agent.name}.`,
      "The composer agent selector has been updated for the next natural-language message.",
    ].join("\n"),
  };
}

function describePermissionsCommand(context: ChatCommandContext): ChatCommandResult {
  const attachmentCount = context.attachments.length;
  const policy = createExecutionPolicy();
  const shellDecision = evaluateExecutionPermission("shell.command", policy);
  const commitDecision = evaluateExecutionPermission("git.commit", policy);
  const browserDecision = evaluateExecutionPermission("browser.interact", policy);
  return {
    title: "Permission boundary",
    content: [
      `Gateway ready: ${context.canChat ? "yes" : "no"}.`,
      `Queued context attachments: ${attachmentCount}.`,
      `Execution policy: ${describeExecutionPolicyMode(policy)}.`,
      `Browser interaction: ${browserDecision.requiresApproval ? "approval required" : "allowed"}.`,
      `Shell command: ${shellDecision.requiresApproval ? "approval required" : shellDecision.allowed ? "allowed" : "blocked"}.`,
      `Git commit: ${commitDecision.requiresApproval ? "approval required" : commitDecision.allowed ? "allowed" : "blocked"}.`,
      "Local commands are read-only. Model calls, shell, browser automation, commits, external services, and file mutations must stay behind explicit UI or system permission boundaries.",
    ].join("\n"),
  };
}

function describeCommitCommand(args: string): ChatCommandResult {
  const policy = createExecutionPolicy();
  const decision = evaluateExecutionPermission("git.commit", policy);
  const description = "Prepare a commit only after reviewing the diff, tests, and staged files.";
  return {
    action: createRuntimeModeAction("commit", "Commit workflow", description, args),
    title: "Commit workflow",
    content: [
      description,
      args ? `Commit intent: ${args}` : "No commit message or intent was provided.",
      `Git commit policy: ${decision.requiresApproval ? "approval required" : decision.allowed ? "allowed" : "blocked"} (${decision.reason})`,
      "Commit workflow is now the active runtime mode for the next natural-language message. Actual commits must use the policy-gated git workflow.",
    ].join("\n"),
  };
}

function describeStatusCommand(context: ChatCommandContext): ChatCommandResult {
  const instructionCount = context.workspaceInstructions?.length ?? 0;
  const attachmentLabels = context.attachments.length
    ? context.attachments.map((attachment) => `${attachment.kind}:${attachment.name}`).join(", ")
    : "none";
  return {
    title: "Chat status",
    content: [
      `Gateway ready: ${context.canChat ? "yes" : "no"}.`,
      `Workspace: ${context.workspacePath || "not selected"}.`,
      `Workspace instructions: ${instructionCount}.`,
      `Context attachments: ${attachmentLabels}.`,
      `Agent: ${context.options?.agentName || "OpenDrSai"}.`,
      `Model: ${context.options?.model || "default"}.`,
      `Thinking effort: ${context.options?.thinkingEffort || "medium"}.`,
      `Runtime mode: ${context.currentRuntimeMode ? `${context.currentRuntimeMode.label}${context.currentRuntimeMode.intent ? ` (${context.currentRuntimeMode.intent})` : ""}` : "default chat"}.`,
    ].join("\n"),
  };
}

function describeModeCommand(
  name: ChatRuntimeModeName,
  title: string,
  description: string,
  args: string,
): ChatCommandResult {
  return {
    action: createRuntimeModeAction(name, title, description, args),
    title,
    content: [
      description,
      args ? `Command argument: ${args}` : "No command argument was provided.",
      "This runtime mode is now active for the next natural-language message and will be sent as request metadata.",
    ].join("\n"),
  };
}

function createRuntimeModeAction(
  name: ChatRuntimeModeName,
  label: string,
  description: string,
  args: string,
): ChatCommandAction {
  const intent = args.trim();
  return {
    type: "set-runtime-mode",
    mode: {
      name,
      label,
      description,
      intent: intent || undefined,
      activatedBy: `/${name}`,
    },
  };
}

function describeContextCommand(
  title: string,
  description: string,
  context: ChatCommandContext,
): ChatCommandResult {
  return {
    title,
    content: [
      description,
      `Current context attachments: ${context.attachments.length}.`,
      "Only visible attachment chips and workspace instructions are sent to the backend.",
    ].join("\n"),
  };
}

function describeMcpCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const cancelMatch = args.match(/^cancel\s+(\S+)$/i);
  if (cancelMatch) {
    return {
      title: "MCP approval cancellation",
      content: [
        `Cancelling pending MCP approval \`${cancelMatch[1]}\` if it is still waiting in Approval Center.`,
        "Cancellation only applies before the approved stdio runtime starts; running MCP calls still rely on bounded timeouts.",
        "Cancelled MCP approvals are recorded in the session lifecycle audit without writing reviewed context.",
      ].join("\n"),
    };
  }
  const syncMatch = args.match(/^sync(?:\s+([\s\S]+))?$/i);
  if (syncMatch) {
    const server = syncMatch[1]?.trim() ?? "";
    return {
      title: "MCP live enumeration",
      content: [
        "Requesting Approval Center permission for live MCP resources/list and tools/list enumeration.",
        server ? `Server selector: ${server}` : "No server selector was provided; configured servers can be enumerated after approval.",
        "The approved runtime writes reviewed results to `.drsai/mcp-context.json`; use `/mcp resource` or `/mcp tool` afterward to attach visible context chips.",
        "This does not execute MCP tools; use `/mcp exec` for the separate tools/call approval path.",
      ].join("\n"),
    };
  }
  const execMatch = args.match(/^exec\s+([^\s]+)\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
  if (execMatch) {
    return {
      title: "MCP tool execution approval",
      content: [
        `Preparing a separate Approval Center request for MCP tool \`${execMatch[2]}\` on server \`${execMatch[1]}\`.`,
        execMatch[3]?.trim() ? "A bounded input preview will be included in the approval detail." : "No tool input was provided.",
        "After approval, the runtime performs a bounded MCP tools/call and writes the reviewed result to `.drsai/mcp-context.json` for explicit `/mcp tool` import.",
        "Tool execution is not performed by `/mcp resource`, `/mcp tool`, or live enumeration.",
      ].join("\n"),
    };
  }
  const importMatch = args.match(/^(resource|tool)s?(?:\s+([\s\S]+))?$/i);
  if (importMatch) {
    const kind = importMatch[1].toLowerCase() === "tool" ? "tool" : "resource";
    const selector = importMatch[2]?.trim() ?? "";
    return {
      title: `MCP ${kind} context`,
      content: [
        `Preparing reviewed MCP ${kind} context from the workspace handoff.`,
        selector ? `Selector: ${selector}` : "No selector was provided; the first bounded handoff items will be imported.",
        "The desktop app reads only `.drsai/mcp-context.json`, creates visible context chips, and does not connect to or execute an MCP server.",
      ].join("\n"),
    };
  }
  const promptMatch = args.match(/^prompt\s+([^\s:]+)(?::\s*|\s+)([\s\S]+)$/i);
  const promptName = promptMatch?.[1]?.trim() ?? "";
  const promptText = promptMatch?.[2]?.trim() ?? "";
  if (!promptText) {
    return {
      title: "MCP tools",
      content: [
        "Connectors and MCP tools should be attached as explicit, permissioned context.",
        "Use `/mcp prompt <name> <prompt text>` to queue a reviewed MCP prompt context chip for the next natural-language message.",
        "Use `/mcp sync [server]` to queue Approval Center permission for live MCP resource/tool enumeration from `.drsai/mcp-servers.json`.",
        "Use `/mcp sync --reuse [server]` to explicitly keep a bounded reusable MCP stdio session for follow-up approved requests.",
        "Use `/mcp resource [selector]` or `/mcp tool [selector]` to import reviewed MCP handoff context from `.drsai/mcp-context.json`.",
        "Use `/mcp exec <server> <tool> [json]` to queue a separate MCP tool execution approval; approved results return through reviewed `/mcp tool` context.",
        "Use `/mcp exec --reuse <server> <tool> [json]` when you want that approved tools/call to reuse the same bounded stdio session.",
        "Use `/mcp cancel <approval-id>` to cancel a queued MCP approval before its stdio runtime starts.",
        `Current context attachments: ${context.attachments.length}.`,
        "Only visible attachment chips and workspace instructions are sent to the backend.",
      ].join("\n"),
    };
  }

  const truncated = promptText.length > 12000;
  const visibleText = truncated ? promptText.slice(0, 12000) : promptText;
  const safeName = promptName.slice(0, 80) || "prompt";
  return {
    action: {
      type: "attach-selection",
      attachment: {
        kind: "selection",
        path: `mcp-prompt:${safeName}:${Date.now()}`,
        name: `MCP prompt: ${safeName}`,
        visibleText,
        note: truncated
          ? "Reviewed MCP prompt context from /mcp prompt. Truncated to 12000 characters."
          : "Reviewed MCP prompt context from /mcp prompt.",
      },
    },
    title: "MCP prompt context attached",
    content: [
      `MCP prompt \`${safeName}\` is queued as a visible context chip for the next natural-language message.`,
      truncated ? "The prompt was truncated to 12000 characters before attaching." : "The full MCP prompt text is visible to the next request.",
      "This does not connect to or execute an MCP server; it only injects reviewed prompt context.",
    ].join("\n"),
  };
}

function describeMentionCommand(args: string, context: ChatCommandContext): ChatCommandResult {
  const selectionMatch = args.match(/^selection\s+([\s\S]+)$/i);
  const selectedText = selectionMatch?.[1]?.trim() ?? "";
  if (!selectedText) {
    return describeContextCommand(
      "Mention context",
      "Mentioned files, folders, selections, browser pages, and terminal output become visible attachment chips.",
      context,
    );
  }

  const truncated = selectedText.length > 12000;
  const visibleText = truncated ? selectedText.slice(0, 12000) : selectedText;
  const preview = selectedText.replace(/\s+/g, " ").slice(0, 72);
  return {
    action: {
      type: "attach-selection",
      attachment: {
        kind: "selection",
        path: `selection:${Date.now()}`,
        name: preview ? `Selection: ${preview}${selectedText.length > 72 ? "..." : ""}` : "Selection",
        visibleText,
        note: truncated
          ? "Manual @selection context from /mention selection. Truncated to 12000 characters."
          : "Manual @selection context from /mention selection.",
      },
    },
    title: "Selection context attached",
    content: [
      "The selected text is queued as a visible context chip for the next natural-language message.",
      truncated ? "The selection was truncated to 12000 characters before attaching." : "The full selection text is visible to the next request.",
      "Future IDE/current-selection adapters can reuse this same selection attachment type.",
    ].join("\n"),
  };
}

function findModel(
  requested: string,
  models: MyDrSaiModelConfig[],
): MyDrSaiModelConfig | null {
  const normalized = normalizeCommandToken(requested);
  return (
    models.find((model) =>
      [model.alias, model.model, model.display_name]
        .filter((item): item is string => Boolean(item))
        .some((candidate) => normalizeCommandToken(candidate) === normalized),
    ) ?? null
  );
}

function findAgent(requested: string, agents: DesktopAgent[]): DesktopAgent | null {
  const normalized = normalizeCommandToken(requested);
  return (
    agents.find((agent) =>
      [agent.id, agent.name]
        .filter((item): item is string => Boolean(item))
        .some((candidate) => normalizeCommandToken(candidate) === normalized),
    ) ?? null
  );
}

function normalizeCommandToken(value: string): string {
  return value.trim().toLowerCase();
}

export function parseForkQueueItems(args: string): string[] {
  return parseForkQueueEntries(args).map((item) => item.intent);
}

export interface ForkQueueItem {
  intent: string;
  agentHint?: string;
}

export function parseForkQueueEntries(args: string): ForkQueueItem[] {
  const trimmed = args.trim();
  const queueMatch = trimmed.match(/^queue\s+([\s\S]+)$/i);
  if (!queueMatch?.[1]) return [];
  return queueMatch[1]
    .split(/\r?\n|[;|]/)
    .map((item) => parseForkQueueEntry(item))
    .filter((item): item is ForkQueueItem => Boolean(item?.intent))
    .slice(0, 8);
}

function parseForkQueueEntry(value: string): ForkQueueItem | null {
  const trimmed = value.replace(/^[-*]\s+/, "").trim();
  if (!trimmed) return null;
  const assignment = trimmed.match(/^@(.+?)(?::\s+|\s+-\s+|\s+)([\s\S]+)$/);
  if (!assignment?.[1] || !assignment[2]?.trim()) {
    return { intent: trimmed };
  }
  return {
    agentHint: assignment[1].trim().slice(0, 160),
    intent: assignment[2].trim(),
  };
}

function getModelLabel(model: MyDrSaiModelConfig): string {
  return model.display_name || model.alias || model.model || "Model";
}

function availableModelHint(models: MyDrSaiModelConfig[]): string {
  if (!models.length) return "No model catalog is currently loaded.";
  return `Available models: ${models
    .map((model) => `\`${model.alias || model.model || getModelLabel(model)}\``)
    .join(", ")}.`;
}

function availableAgentHint(agents: DesktopAgent[]): string {
  if (!agents.length) return "No agent catalog is currently loaded.";
  return `Available agents: ${agents
    .map((agent) => `\`${agent.id}\` (${agent.name})`)
    .join(", ")}.`;
}
