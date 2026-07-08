import {
  FORK_CONFLICT_GENERATED_AST_EXPORT_INDEX,
  FORK_CONFLICT_GENERATED_COMPILER_DIAGNOSTIC_INDEX,
  FORK_CONFLICT_GENERATED_REPOSITORY_IMPORT_INDEX,
} from "./forkConflictGeneratedImportIndex";

export interface ForkConflictDraftHunk {
  id: string;
  index: number;
  startLine: number;
  endLine: number;
  sourceLabel: string;
  forkLabel: string;
  sourceText: string;
  forkText: string;
}

export interface ForkConflictSemanticPreview {
  baseRef: string;
  fileKind: string;
  sourceSignal: string;
  forkSignal: string;
  draftSignal: string;
  risk: "low" | "medium" | "high";
  reviewItems: string[];
  structureItems: string[];
  testGraphMatches: string[];
  testSuggestions: string[];
}

export interface ForkConflictStructureSymbol {
  key: string;
  label: string;
  signature: string;
  line: number;
  parser: string;
  scope?: string;
}

export interface ForkConflictStructureDiff {
  items: string[];
  hasOverlappingStructuralEdits: boolean;
}

interface TestGraphRule {
  id: string;
  match: RegExp;
  commands: string[];
}

interface ReverseDependencyRule {
  id: string;
  changedPath: RegExp;
  dependents: Array<{
    label: string;
    commands: string[];
  }>;
}

interface RepositoryImportIndexRule {
  id: string;
  changedModule: RegExp;
  importers: Array<{
    label: string;
    path: string;
    commands: string[];
  }>;
}

interface ForkConflictContentSet {
  baseContent?: string;
  sourceContent?: string;
  forkContent?: string;
  draft?: string;
}

interface ForkConflictExportDelta {
  sourceChanged: string[];
  forkChanged: string[];
  draftChanged: string[];
}

interface ForkConflictLiveAstExportSymbol {
  name: string;
  kind: string;
}

interface ForkConflictGeneratedCompilerDiagnosticView {
  code: number;
  line: number;
}

interface ForkConflictLiveDraftDiagnosticHint {
  kind: string;
  line: number;
  column: number;
  detail: string;
}

const FORK_CONFLICT_TEST_GRAPH: TestGraphRule[] = [
  {
    id: "verification-script",
    match: /scripts\/verify-([a-z0-9-]+)\.mjs$/,
    commands: ["npm run verify:$1"],
  },
  {
    id: "renderer",
    match: /src\/renderer\//,
    commands: ["npm run typecheck:web"],
  },
  {
    id: "main-preload-shared",
    match: /src\/(main|preload|shared)\//,
    commands: ["npm run typecheck:node"],
  },
  {
    id: "shared-renderer-contract",
    match: /src\/shared\//,
    commands: ["npm run typecheck:web"],
  },
  {
    id: "workspace-context",
    match: /(workspacecontext|workspace-context)/,
    commands: ["npm run verify:workspace-context"],
  },
  {
    id: "workspace-checkpoints",
    match: /(workspacecheckpoints|workspace-checkpoints)/,
    commands: ["npm run verify:workspace-checkpoints"],
  },
  {
    id: "approval-policy",
    match: /(executionpolicy|approvalcenter|approval-center)/,
    commands: ["npm run verify:execution-policy", "npm run verify:approval-center"],
  },
  {
    id: "fork-worktree",
    match: /(forkworktrees|fork-worktree|fork|workspaceshell)/,
    commands: ["npm run verify:fork-worktree", "npm run verify:thread-menu"],
  },
  {
    id: "chatbar",
    match: /(chatcommands|chatworkspace|usedesktopchatadapter)/,
    commands: ["npm run verify:chat-commands"],
  },
  {
    id: "workflow-marketplace",
    match: /(workflowmarketplace|workflowruns|workflow-marketplace)/,
    commands: ["npm run verify:workflow-marketplace"],
  },
  {
    id: "background-tasks",
    match: /(backgroundtasks|background-tasks)/,
    commands: ["npm run verify:background-tasks"],
  },
  {
    id: "scheduled-tasks",
    match: /(scheduledtasks|scheduled-tasks)/,
    commands: ["npm run verify:scheduled-tasks"],
  },
  {
    id: "channels",
    match: /(channeladapters|channel-adapters|channelsview)/,
    commands: ["npm run verify:channel-adapters"],
  },
  {
    id: "ide-context",
    match: /(idecontext|ide-context|editor-integrations\/)/,
    commands: ["npm run verify:ide-context", "npm run verify:ide-producers"],
  },
  {
    id: "package-contract",
    match: /package\.json$/,
    commands: ["npm run verify"],
  },
  {
    id: "smart-chat-roadmap",
    match: /docs\/smart-chat-bar-roadmap\.md$/,
    commands: ["npm run verify:chat-commands", "npm run verify:fork-worktree"],
  },
  {
    id: "python-test-file",
    match: /^(tests\/.*\.py)$/,
    commands: ["python -m pytest $1"],
  },
  {
    id: "python-core-package",
    match: /^cores\/python\/packages\/(drsai|drsai_ext)\//,
    commands: ["python -m pytest tests", "python -c \"import $1\""],
  },
  {
    id: "python-webui-backend",
    match: /^apps\/webui\/backend\//,
    commands: ["python -m pytest apps/webui/backend"],
  },
];

const FORK_CONFLICT_IMPORT_TEST_GRAPH: TestGraphRule[] = [
  {
    id: "react-renderer-import",
    match: /^(react|react-dom|lucide-react|@vitejs\/|\.{1,2}\/|src\/renderer\/)/,
    commands: ["npm run typecheck:web", "npm run verify:ui"],
  },
  {
    id: "shared-contract-import",
    match: /^(@shared\/|src\/shared\/|\.\.\/shared\/|\.\.\/\.\.\/shared\/)/,
    commands: ["npm run typecheck:node", "npm run typecheck:web"],
  },
  {
    id: "main-runtime-import",
    match: /^(electron|node:|src\/main\/|\.\.\/main\/|\.\.\/\.\.\/main\/)/,
    commands: ["npm run typecheck:node"],
  },
  {
    id: "workflow-import",
    match: /(workflow|backgroundtasks|scheduledtasks|projectmemory|projectskills)/i,
    commands: ["npm run verify:workflow-marketplace", "npm run verify:background-tasks"],
  },
  {
    id: "channel-import",
    match: /(channeladapters|channelsview|connector|slack|github|calendar|docs)/i,
    commands: ["npm run verify:channel-adapters"],
  },
  {
    id: "mcp-import",
    match: /(mcpcontext|mcplivebridge|mcp)/i,
    commands: ["npm run verify:mcp-live-bridge", "npm run verify:approval-center"],
  },
  {
    id: "python-local-import",
    match: /^(drsai|drsai_ext|drsai_ui)(?:\.|$)/,
    commands: ["Run the closest Python unit test or import smoke for this package."],
  },
];

const FORK_CONFLICT_REVERSE_DEPENDENCY_INDEX: ReverseDependencyRule[] = [
  {
    id: "shared-desktop-api-contract",
    changedPath: /src\/shared\/desktopapi\.ts$/,
    dependents: [
      {
        label: "main IPC, preload bridge, mock bridge, and renderer adapters",
        commands: ["npm run typecheck:node", "npm run typecheck:web", "npm run verify:chat-commands"],
      },
      {
        label: "approval, fork, channel, MCP, workflow, memory, and checkpoint surfaces",
        commands: [
          "npm run verify:approval-center",
          "npm run verify:fork-worktree",
          "npm run verify:channel-adapters",
          "npm run verify:mcp-live-bridge",
        ],
      },
    ],
  },
  {
    id: "main-ipc-boundary",
    changedPath: /src\/main\/index\.ts$/,
    dependents: [
      {
        label: "preload bridge and renderer desktop API callers",
        commands: ["npm run typecheck:node", "npm run typecheck:web"],
      },
      {
        label: "approval-gated runtime feature verifiers",
        commands: ["npm run verify:approval-center", "npm run verify:execution-policy", "npm run verify:fork-worktree"],
      },
    ],
  },
  {
    id: "preload-bridge",
    changedPath: /src\/preload\/index\.ts$/,
    dependents: [
      {
        label: "renderer desktop API contract and browser mock fallback",
        commands: ["npm run typecheck:web", "npm run verify:ui"],
      },
    ],
  },
  {
    id: "renderer-mock-bridge",
    changedPath: /src\/renderer\/src\/mockdesktopapi\.ts$/,
    dependents: [
      {
        label: "browser visual checks and renderer contract tests",
        commands: ["npm run typecheck:web", "npm run verify:ui"],
      },
    ],
  },
  {
    id: "channel-adapter-runtime",
    changedPath: /(?:src\/main\/channeladapters\.ts|src\/renderer\/src\/components\/channelsview\.tsx)$/,
    dependents: [
      {
        label: "Channels UI, shared adapter contract, inbound queue, and outbound ledger",
        commands: ["npm run verify:channel-adapters", "npm run typecheck:node", "npm run typecheck:web"],
      },
    ],
  },
  {
    id: "mcp-live-runtime",
    changedPath: /(?:src\/main\/mcplivebridge\.ts|src\/main\/mcpcontext\.ts)$/,
    dependents: [
      {
        label: "Approval Center MCP panels and slash command MCP imports",
        commands: ["npm run verify:mcp-live-bridge", "npm run verify:approval-center", "npm run verify:chat-commands"],
      },
    ],
  },
  {
    id: "fork-runtime",
    changedPath: /(?:src\/main\/forkworktrees\.ts|src\/renderer\/src\/components\/forkconflictanalysis\.ts)$/,
    dependents: [
      {
        label: "fork queue dispatch, thread menu lifecycle, and conflict workbench",
        commands: ["npm run verify:fork-worktree", "npm run verify:thread-menu", "npm run typecheck:web"],
      },
    ],
  },
  {
    id: "workflow-runtime",
    changedPath: /(?:src\/main\/workflow(?:marketplace|runs)\.ts|src\/main\/backgroundtasks\.ts|src\/main\/scheduledtasks\.ts)$/,
    dependents: [
      {
        label: "Skills Square workflows, background queue, and scheduler worker",
        commands: ["npm run verify:workflow-marketplace", "npm run verify:background-tasks", "npm run verify:scheduled-tasks"],
      },
    ],
  },
  {
    id: "shared-module-generic",
    changedPath: /src\/shared\//,
    dependents: [
      {
        label: "main, preload, and renderer TypeScript consumers",
        commands: ["npm run typecheck:node", "npm run typecheck:web"],
      },
    ],
  },
  {
    id: "renderer-component-generic",
    changedPath: /src\/renderer\/src\/components\//,
    dependents: [
      {
        label: "App shell, workspace navigation, and renderer UI invariants",
        commands: ["npm run typecheck:web", "npm run verify:ui"],
      },
    ],
  },
  {
    id: "main-module-generic",
    changedPath: /src\/main\//,
    dependents: [
      {
        label: "desktop main-process type boundary",
        commands: ["npm run typecheck:node"],
      },
    ],
  },
];

const FORK_CONFLICT_REPOSITORY_IMPORT_INDEX: RepositoryImportIndexRule[] = [
  {
    id: "desktop-api-import-index",
    changedModule: /^src\/shared\/desktopapi$/,
    importers: [
      {
        label: "Electron main IPC imports the shared desktop API contract",
        path: "src/main/index.ts",
        commands: ["npm run typecheck:node", "npm run verify:approval-center"],
      },
      {
        label: "preload and browser mock bridges mirror the shared desktop API",
        path: "src/preload/index.ts, src/renderer/src/mockDesktopApi.ts",
        commands: ["npm run typecheck:node", "npm run typecheck:web", "npm run verify:ui"],
      },
      {
        label: "renderer chat, channel, approval, and workspace surfaces call DesktopApi methods",
        path: "src/renderer/src",
        commands: ["npm run typecheck:web", "npm run verify:chat-commands", "npm run verify:channel-adapters"],
      },
    ],
  },
  {
    id: "execution-policy-import-index",
    changedModule: /^src\/shared\/executionpolicy$/,
    importers: [
      {
        label: "main approval and execution gates consume the shared policy",
        path: "src/main/index.ts",
        commands: ["npm run typecheck:node", "npm run verify:execution-policy", "npm run verify:approval-center"],
      },
      {
        label: "Approval Center renderer explains policy decisions",
        path: "src/renderer/src/components/ApprovalCenterView.tsx",
        commands: ["npm run typecheck:web", "npm run verify:approval-center"],
      },
    ],
  },
  {
    id: "channel-adapter-import-index",
    changedModule: /^src\/main\/channeladapters$/,
    importers: [
      {
        label: "main IPC routes channel imports, outbound drafts, and auth preparation",
        path: "src/main/index.ts",
        commands: ["npm run typecheck:node", "npm run verify:channel-adapters"],
      },
      {
        label: "shared/preload/mock/Channels UI consume the adapter contract",
        path: "src/shared/desktopApi.ts, src/preload/index.ts, src/renderer/src/components/ChannelsView.tsx",
        commands: ["npm run typecheck:web", "npm run verify:channel-adapters"],
      },
    ],
  },
  {
    id: "mcp-runtime-import-index",
    changedModule: /^src\/main\/(?:mcplivebridge|mcpcontext)$/,
    importers: [
      {
        label: "main Approval Center and slash command MCP routes consume the MCP runtime",
        path: "src/main/index.ts",
        commands: ["npm run typecheck:node", "npm run verify:mcp-live-bridge"],
      },
      {
        label: "Approval Center MCP panels and chat command verifier depend on MCP audit contracts",
        path: "src/renderer/src/components/ApprovalCenterView.tsx, src/renderer/src/adapters/useDesktopChatAdapter.ts",
        commands: ["npm run typecheck:web", "npm run verify:approval-center", "npm run verify:chat-commands"],
      },
    ],
  },
  {
    id: "fork-conflict-analysis-import-index",
    changedModule: /^src\/renderer\/src\/components\/forkconflictanalysis$/,
    importers: [
      {
        label: "WorkspaceShell conflict workbench renders semantic, hunk, and test graph output",
        path: "src/renderer/src/components/WorkspaceShell.tsx",
        commands: ["npm run typecheck:web", "npm run verify:fork-worktree", "npm run verify:thread-menu"],
      },
    ],
  },
  {
    id: "workflow-runtime-import-index",
    changedModule: /^src\/main\/(?:workflowmarketplace|workflowruns|backgroundtasks|scheduledtasks)$/,
    importers: [
      {
        label: "main workflow, background, and scheduler IPC routes share runtime contracts",
        path: "src/main/index.ts",
        commands: ["npm run typecheck:node", "npm run verify:workflow-marketplace"],
      },
      {
        label: "Skills Square and background task panels consume workflow run state",
        path: "src/renderer/src/components/SkillSquareView.tsx",
        commands: ["npm run typecheck:web", "npm run verify:background-tasks", "npm run verify:scheduled-tasks"],
      },
    ],
  },
  {
    id: "workspace-checkpoint-import-index",
    changedModule: /^src\/main\/workspacecheckpoints$/,
    importers: [
      {
        label: "Approval Center and Files panels consume checkpoint preview/restore contracts",
        path: "src/renderer/src/components/ApprovalCenterView.tsx, src/renderer/src/components/files/FilesContextPanel.tsx",
        commands: ["npm run typecheck:web", "npm run verify:workspace-checkpoints", "npm run verify:approval-center"],
      },
    ],
  },
];

const PACKAGE_SCRIPT_TEST_NAME = /^(typecheck(?::.+)?|test(?::.+)?|verify(?::.+)?|build(?::.+)?)$/;
const LOCAL_MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".ps1",
  ".cmd",
  ".css",
  ".scss",
  ".less",
  ".md",
  ".mdx",
  ".py",
  ".pyi",
];
const CONFIG_REFERENCE_ROOT_PREFIXES = [
  "apps/",
  "bootstrapper/",
  "docs/",
  "editor-integrations/",
  "resources/",
  "scripts/",
  "src/",
  "tests/",
];
const PYTHON_PACKAGE_ROOTS = [
  { prefix: "drsai", root: "cores/python/packages/drsai/src/drsai" },
  { prefix: "drsai_ext", root: "cores/python/packages/drsai_ext/src/drsai_ext" },
  { prefix: "drsai_ui", root: "apps/webui/backend/src/drsai_ui" },
];

export function splitConflictDraftLines(draft: string): string[] {
  return draft.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line, index, lines) =>
    index < lines.length - 1 || line.length > 0,
  ) ?? [];
}

export function parseForkConflictDraftHunks(draft: string): ForkConflictDraftHunk[] {
  const lines = splitConflictDraftLines(draft);
  const hunks: ForkConflictDraftHunk[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const startLine = lines[cursor];
    if (!startLine.trimStart().startsWith("<<<<<<<")) {
      cursor += 1;
      continue;
    }
    let separator = -1;
    let end = -1;
    for (let index = cursor + 1; index < lines.length; index += 1) {
      const trimmed = lines[index].trimStart();
      if (separator < 0 && trimmed.startsWith("=======")) {
        separator = index;
        continue;
      }
      if (separator >= 0 && trimmed.startsWith(">>>>>>>")) {
        end = index;
        break;
      }
    }
    if (separator < 0 || end < 0) {
      cursor += 1;
      continue;
    }
    hunks.push({
      id: `${cursor}:${end}`,
      index: hunks.length + 1,
      startLine: cursor + 1,
      endLine: end + 1,
      sourceLabel: startLine.replace(/^<<<<<<<\s*/, "").trim() || "source",
      forkLabel: lines[end].replace(/^>>>>>>>\s*/, "").trim() || "fork",
      sourceText: lines.slice(cursor + 1, separator).join(""),
      forkText: lines.slice(separator + 1, end).join(""),
    });
    cursor = end + 1;
  }
  return hunks;
}

export function getLineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\n|\r/).length;
}

export function getConflictMarkerCount(text: string): number {
  return text
    .split(/\r\n|\n|\r/)
    .filter((line) =>
      line.trimStart().startsWith("<<<<<<<") ||
      line.trimStart().startsWith("=======") ||
      line.trimStart().startsWith(">>>>>>>"),
    ).length;
}

export function getForkConflictFileKind(path: string): string {
  const lowerPath = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerPath)) return "TypeScript/JavaScript";
  if (/\.(py|pyi)$/.test(lowerPath)) return "Python";
  if (/\.(css|scss|less)$/.test(lowerPath)) return "Stylesheet";
  if (/\.(md|mdx)$/.test(lowerPath)) return "Documentation";
  if (/\.(json|jsonc|ya?ml|toml)$/.test(lowerPath)) return "Configuration";
  return "Source file";
}

function truncateForkConflictSignature(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function addForkConflictStructureSymbol(
  symbols: ForkConflictStructureSymbol[],
  seen: Set<string>,
  kind: string,
  name: string,
  signature: string,
  line: number,
  parser: string,
  scope?: string,
): void {
  const safeName = name.trim();
  if (!safeName) return;
  const key = `${kind}:${safeName.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  symbols.push({
    key,
    label: `${kind} ${safeName}`,
    signature: truncateForkConflictSignature(signature.trim().replace(/\s+/g, " ")),
    line,
    parser,
    scope,
  });
}

function getBraceDepth(line: string): number {
  let depth = 0;
  let quoted: string | null = null;
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quoted) {
      if (character === quoted) quoted = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quoted = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
  }
  return depth;
}

function getIndentLevel(line: string): number {
  return line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
}

export function getForkConflictStructureSymbols(path: string, text: string): ForkConflictStructureSymbol[] {
  if (!text.trim()) return [];
  const lowerPath = path.toLowerCase();
  const lines = text.split(/\r\n|\n|\r/);
  const symbols: ForkConflictStructureSymbol[] = [];
  const seen = new Set<string>();
  const scopeStack: Array<{ name: string; depth: number; indent: number }> = [];
  let braceDepth = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNumber = index + 1;
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      braceDepth = Math.max(0, braceDepth + getBraceDepth(line));
      return;
    }

    const indent = getIndentLevel(line);
    while (scopeStack.length && scopeStack[scopeStack.length - 1].indent >= indent && /\.(py|pyi)$/.test(lowerPath)) {
      scopeStack.pop();
    }
    while (scopeStack.length && scopeStack[scopeStack.length - 1].depth > braceDepth && /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less)$/.test(lowerPath)) {
      scopeStack.pop();
    }
    const scope = scopeStack.length ? scopeStack.map((item) => item.name).join(".") : undefined;

    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerPath)) {
      const declaration = trimmed.match(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
      );
      if (declaration) {
        addForkConflictStructureSymbol(symbols, seen, declaration[1], declaration[2], trimmed, lineNumber, "brace-parser", scope);
        if (declaration[1] === "class" || declaration[1] === "function") {
          scopeStack.push({ name: declaration[2], depth: braceDepth + 1, indent });
        }
        braceDepth = Math.max(0, braceDepth + getBraceDepth(line));
        return;
      }
      const variable = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:[:=]|\()/);
      if (variable) {
        addForkConflictStructureSymbol(symbols, seen, "binding", variable[1], trimmed, lineNumber, "brace-parser", scope);
        braceDepth = Math.max(0, braceDepth + getBraceDepth(line));
        return;
      }
    }

    if (/\.(py|pyi)$/.test(lowerPath)) {
      const pythonDeclaration = trimmed.match(/^(async\s+def|def|class)\s+([A-Za-z_][\w]*)/);
      if (pythonDeclaration) {
        addForkConflictStructureSymbol(
          symbols,
          seen,
          pythonDeclaration[1].replace(/\s+/g, " "),
          pythonDeclaration[2],
          trimmed,
          lineNumber,
          "indent-parser",
          scope,
        );
        scopeStack.push({ name: pythonDeclaration[2], depth: 0, indent });
        return;
      }
    }

    if (/\.(css|scss|less)$/.test(lowerPath) && trimmed.includes("{") && !trimmed.startsWith("@")) {
      const selector = trimmed.slice(0, trimmed.indexOf("{")).trim();
      if (selector) {
        addForkConflictStructureSymbol(symbols, seen, "selector", selector, trimmed, lineNumber, "brace-parser", scope);
        scopeStack.push({ name: selector, depth: braceDepth + 1, indent });
        braceDepth = Math.max(0, braceDepth + getBraceDepth(line));
        return;
      }
    }

    if (/\.(md|mdx)$/.test(lowerPath)) {
      const heading = trimmed.match(/^(#{1,6})\s+(.+)/);
      if (heading) {
        addForkConflictStructureSymbol(symbols, seen, `heading${heading[1].length}`, heading[2], trimmed, lineNumber, "markdown-parser");
        return;
      }
    }

    if (/\.(json|jsonc|ya?ml|toml)$/.test(lowerPath)) {
      const configKey = trimmed.match(/^["']?([A-Za-z0-9_.-]+)["']?\s*[:=]/);
      if (configKey) {
        addForkConflictStructureSymbol(symbols, seen, "key", configKey[1], trimmed, lineNumber, "config-parser", scope);
      }
    }

    braceDepth = Math.max(0, braceDepth + getBraceDepth(line));
  });

  return symbols.slice(0, 24);
}

function describeForkConflictStructureDelta(
  label: string,
  baseSymbols: ForkConflictStructureSymbol[],
  targetSymbols: ForkConflictStructureSymbol[],
): { label: string; changedKeys: Set<string> } {
  const baseByKey = new Map(baseSymbols.map((symbol) => [symbol.key, symbol]));
  const targetByKey = new Map(targetSymbols.map((symbol) => [symbol.key, symbol]));
  const added = targetSymbols.filter((symbol) => !baseByKey.has(symbol.key));
  const removed = baseSymbols.filter((symbol) => !targetByKey.has(symbol.key));
  const changed = targetSymbols.filter((symbol) => {
    const baseSymbol = baseByKey.get(symbol.key);
    return baseSymbol && baseSymbol.signature !== symbol.signature;
  });
  const changedKeys = new Set([...added, ...removed, ...changed].map((symbol) => symbol.key));
  return {
    label: `${label}: ${added.length} added, ${removed.length} removed, ${changed.length} signature changes`,
    changedKeys,
  };
}

function formatForkConflictStructureLabels(
  symbols: ForkConflictStructureSymbol[],
  keys: Set<string>,
): string {
  const labels = symbols
    .filter((symbol) => keys.has(symbol.key))
    .map((symbol) => `${symbol.label} (line ${symbol.line}${symbol.scope ? `, scope ${symbol.scope}` : ""})`);
  return labels.length > 0 ? labels.slice(0, 5).join("; ") : "none";
}

export function getForkConflictStructureDiff(
  path: string,
  baseContent: string,
  sourceContent: string,
  forkContent: string,
  draft: string,
): ForkConflictStructureDiff {
  const baseSymbols = getForkConflictStructureSymbols(path, baseContent);
  const sourceSymbols = getForkConflictStructureSymbols(path, sourceContent);
  const forkSymbols = getForkConflictStructureSymbols(path, forkContent);
  const draftSymbols = getForkConflictStructureSymbols(path, draft);
  const sourceDelta = describeForkConflictStructureDelta("Source structure", baseSymbols, sourceSymbols);
  const forkDelta = describeForkConflictStructureDelta("Fork structure", baseSymbols, forkSymbols);
  const draftDelta = describeForkConflictStructureDelta("Resolved draft structure", baseSymbols, draftSymbols);
  const overlappingKeys = new Set(
    [...sourceDelta.changedKeys].filter((key) => forkDelta.changedKeys.has(key)),
  );
  const hasOverlappingStructuralEdits = overlappingKeys.size > 0;
  const parsers = Array.from(new Set([...baseSymbols, ...sourceSymbols, ...forkSymbols, ...draftSymbols].map((symbol) => symbol.parser)));
  return {
    hasOverlappingStructuralEdits,
    items: [
      `AST-aware structure diff: ${sourceDelta.label}; ${forkDelta.label}; ${draftDelta.label}`,
      hasOverlappingStructuralEdits
        ? `Overlapping structural edits: ${formatForkConflictStructureLabels([...sourceSymbols, ...forkSymbols], overlappingKeys)}`
        : "No overlapping structural symbol edits detected.",
      `Tracked structure symbols: base ${baseSymbols.length}, source ${sourceSymbols.length}, fork ${forkSymbols.length}, draft ${draftSymbols.length}`,
      `Parser-backed scopes: ${parsers.length ? parsers.join(", ") : "no supported parser matched"}`,
    ],
  };
}

function collectForkConflictContents(contents?: ForkConflictContentSet): string[] {
  if (!contents) return [];
  return [
    contents.baseContent,
    contents.sourceContent,
    contents.forkContent,
    contents.draft,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function collectForkConflictImportSpecifiers(contents?: ForkConflictContentSet): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[^'";]+?\s+from\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const content of collectForkConflictContents(contents)) {
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (specifier) specifiers.push(specifier);
    }
    specifiers.push(...collectForkConflictStylesheetImportSpecifiers(content));
    specifiers.push(...collectForkConflictMarkdownLinkSpecifiers(content));
    specifiers.push(...collectForkConflictConfigReferenceSpecifiers(content));
    specifiers.push(...collectForkConflictPackageEntrySpecifiers(content));
    specifiers.push(...collectForkConflictPythonImportSpecifiers(content));
  }
  return Array.from(new Set(specifiers)).slice(0, 24);
}

function collectForkConflictConfigReferenceSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const pathPattern =
    /(?:^|[\s"'=:,\[\]{}])((?:\.{1,2}\/|apps\/|bootstrapper\/|docs\/|editor-integrations\/|resources\/|scripts\/|src\/|tests\/)[A-Za-z0-9_./,@ -]+\.(?:jsonc|json|tsx|ts|jsx|js|mjs|cjs|scss|css|less|mdx|md|pyi|py|yaml|yml|toml|ps1|cmd))(?=$|[\s"'`,)\]}])/g;
  for (const match of content.matchAll(pathPattern)) {
    const specifier = (match[1] ?? "").trim().replace(/^[("'`]+|[)"'`,]+$/g, "").split(/[?#]/, 1)[0];
    if (!specifier || /^(?:https?:|data:)/i.test(specifier)) continue;
    specifiers.push(specifier);
  }
  return specifiers.slice(0, 16);
}

function collectForkConflictPackageEntrySpecifiers(content: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const specifiers: string[] = [];
  const addSpecifier = (value: unknown): void => {
    if (typeof value !== "string") return;
    const specifier = value.trim().split(/[?#]/, 1)[0];
    if (!specifier || /^(?:https?:|data:|[a-z0-9+.-]+:)/i.test(specifier)) return;
    if (specifier.startsWith("./") || CONFIG_REFERENCE_ROOT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
      specifiers.push(specifier);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      addSpecifier(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  [
    "main",
    "module",
    "types",
    "typings",
    "source",
    "style",
    "styles",
    "sass",
    "less",
    "browser",
    "bin",
    "exports",
    "imports",
    "files",
  ].forEach((key) => visit(parsed[key]));
  return Array.from(new Set(specifiers)).slice(0, 16);
}

function collectForkConflictMarkdownLinkSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const markdownLinkPattern = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of content.matchAll(markdownLinkPattern)) {
    const specifier = (match[1] ?? "").trim().split(/[?#]/, 1)[0];
    if (!specifier || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(specifier)) continue;
    specifiers.push(specifier);
  }
  return specifiers.slice(0, 12);
}

function collectForkConflictStylesheetImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const stylesheetPatterns = [
    /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/g,
    /@import\s+url\(\s*([^"')\s]+)\s*\)/g,
    /\burl\(\s*["']?([^"')\s]+)["']?\s*\)/g,
  ];
  for (const pattern of stylesheetPatterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = (match[1] ?? "").trim();
      if (!specifier || /^(?:data:|https?:|#|var\()/i.test(specifier)) continue;
      specifiers.push(specifier.split(/[?#]/, 1)[0]);
    }
  }
  return specifiers.slice(0, 12);
}

function collectForkConflictPythonImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const fromPattern = /^\s*from\s+([A-Za-z_][\w.]*|\.+[A-Za-z_][\w.]*)\s+import\s+([^#\n]+)/gm;
  const importPattern = /^\s*import\s+([^#\n]+)/gm;
  for (const match of content.matchAll(fromPattern)) {
    const moduleName = match[1]?.trim();
    if (!moduleName) continue;
    specifiers.push(moduleName);
    const importedNames = parseForkConflictPythonImportedNames(match[2] ?? "");
    if (moduleName.startsWith(".") || PYTHON_PACKAGE_ROOTS.some((root) => root.prefix === moduleName)) {
      const normalizedModule = moduleName.replace(/\.$/, "");
      for (const importedName of importedNames) {
        specifiers.push(`${normalizedModule}.${importedName}`);
      }
    }
  }
  for (const match of content.matchAll(importPattern)) {
    for (const moduleName of parseForkConflictPythonImportList(match[1] ?? "")) {
      specifiers.push(moduleName);
    }
  }
  return specifiers;
}

function parseForkConflictPythonImportedNames(value: string): string[] {
  return value
    .replace(/[()]/g, "")
    .split(",")
    .map((item) => item.trim().split(/\s+as\s+/i)[0]?.trim() ?? "")
    .filter((item) => /^[A-Za-z_][\w]*$/.test(item))
    .slice(0, 12);
}

function parseForkConflictPythonImportList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().split(/\s+as\s+/i)[0]?.trim() ?? "")
    .filter((item) => /^[A-Za-z_][\w.]*$/.test(item))
    .slice(0, 12);
}

function normalizeForkConflictRepoPath(value: string): string | null {
  const segments: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

function getForkConflictDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function addForkConflictModuleCandidate(candidates: Set<string>, value: string): void {
  const normalized = normalizeForkConflictRepoPath(value);
  if (!normalized) return;
  candidates.add(normalized);
  if (/\.[a-z0-9]+$/i.test(normalized)) return;
  for (const extension of LOCAL_MODULE_EXTENSIONS) {
    candidates.add(`${normalized}${extension}`);
  }
  for (const extension of LOCAL_MODULE_EXTENSIONS) {
    candidates.add(`${normalized}/index${extension}`);
  }
}

function addForkConflictPythonModuleCandidate(candidates: Set<string>, value: string): void {
  const normalized = normalizeForkConflictRepoPath(value);
  if (!normalized) return;
  candidates.add(normalized);
  if (/\.(py|pyi)$/i.test(normalized)) return;
  candidates.add(`${normalized}.py`);
  candidates.add(`${normalized}.pyi`);
  candidates.add(`${normalized}/__init__.py`);
  candidates.add(`${normalized}/__init__.pyi`);
}

function addForkConflictPythonRelativeCandidate(candidates: Set<string>, path: string, specifier: string): void {
  if (!/\.(py|pyi)$/i.test(path)) return;
  const dotMatch = specifier.match(/^(\.+)(.*)$/);
  if (!dotMatch) return;
  const dotCount = dotMatch[1].length;
  const moduleSuffix = dotMatch[2].replace(/\./g, "/");
  let baseDirectory = getForkConflictDirectory(path);
  for (let index = 1; index < dotCount; index += 1) {
    baseDirectory = getForkConflictDirectory(baseDirectory);
  }
  addForkConflictPythonModuleCandidate(
    candidates,
    moduleSuffix ? `${baseDirectory}/${moduleSuffix}` : baseDirectory,
  );
}

function addForkConflictPythonPackageCandidate(candidates: Set<string>, specifier: string): void {
  for (const packageRoot of PYTHON_PACKAGE_ROOTS) {
    if (specifier !== packageRoot.prefix && !specifier.startsWith(`${packageRoot.prefix}.`)) continue;
    const moduleSuffix = specifier.slice(packageRoot.prefix.length).replace(/^\./, "").replace(/\./g, "/");
    addForkConflictPythonModuleCandidate(
      candidates,
      moduleSuffix ? `${packageRoot.root}/${moduleSuffix}` : packageRoot.root,
    );
  }
}

function collectForkConflictRepositoryPathCandidates(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const candidates = new Set<string>();
  const sourceDirectory = getForkConflictDirectory(path);
  for (const specifier of collectForkConflictImportSpecifiers(contents)) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      addForkConflictModuleCandidate(candidates, `${sourceDirectory}/${specifier}`);
      continue;
    }
    if (specifier.startsWith("src/")) {
      addForkConflictModuleCandidate(candidates, specifier);
      continue;
    }
    if (CONFIG_REFERENCE_ROOT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
      addForkConflictModuleCandidate(candidates, specifier);
      continue;
    }
    if (specifier.startsWith("@shared/")) {
      addForkConflictModuleCandidate(candidates, `src/shared/${specifier.slice("@shared/".length)}`);
      continue;
    }
    if (specifier.startsWith("@renderer/")) {
      addForkConflictModuleCandidate(candidates, `src/renderer/src/${specifier.slice("@renderer/".length)}`);
      continue;
    }
    if (specifier.startsWith("~/")) {
      addForkConflictModuleCandidate(candidates, specifier.slice("~/".length));
      continue;
    }
    if (specifier.startsWith(".")) {
      addForkConflictPythonRelativeCandidate(candidates, path, specifier);
      continue;
    }
    addForkConflictPythonPackageCandidate(candidates, specifier);
  }
  return Array.from(candidates).slice(0, 48);
}

function getForkConflictModuleKey(path: string): string | null {
  const normalized = normalizeForkConflictRepoPath(path);
  if (!normalized) return null;
  const withoutIndex = normalized
    .replace(/\/index\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|less|md|mdx)$/i, "")
    .replace(/\.(jsonc|ya?ml|toml|ps1|cmd)$/i, "")
    .replace(/\/__init__\.(py|pyi)$/i, "");
  const withoutExtension = withoutIndex.replace(/\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|scss|less|md|mdx|py|pyi|ya?ml|toml|ps1|cmd)$/i, "");
  return withoutExtension.toLowerCase();
}

function getForkConflictImportIndexLookupKeys(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const keys = new Set<string>();
  const directKey = getForkConflictModuleKey(path);
  if (directKey) keys.add(directKey);
  for (const candidate of collectForkConflictRepositoryPathCandidates(path, contents)) {
    const candidateKey = getForkConflictModuleKey(candidate);
    if (candidateKey) keys.add(candidateKey);
  }
  return Array.from(keys).slice(0, 64);
}

function addForkConflictLiveAstExportSymbol(
  symbols: Map<string, ForkConflictLiveAstExportSymbol>,
  name: string | undefined,
  kind: string,
): void {
  const safeName = (name ?? "").trim();
  if (!safeName || !/^(?:[A-Za-z_$][\w$]*|\*)$/.test(safeName)) return;
  symbols.set(safeName, { name: safeName, kind });
}

function collectForkConflictLiveAstExportSymbols(path: string, text: string): ForkConflictLiveAstExportSymbol[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return [];
  const symbols = new Map<string, ForkConflictLiveAstExportSymbol>();
  const declarationPattern =
    /\bexport\s+(default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  const variablePattern = /\bexport\s+(?:declare\s+)?(const|let|var)\s+([^;\n]+)/g;
  const namespaceExportPattern = /\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g;
  const exportAllPattern = /\bexport\s+\*\s+from\s+["'][^"']+["']/g;
  const namedExportPattern = /\bexport\s+(?:type\s+)?\{([^}]+)\}/g;
  const defaultExportPattern = /\bexport\s+default\b/g;
  const commonJsPropertyPattern = /\bexports\.([A-Za-z_$][\w$]*)\s*=/g;
  const commonJsObjectPattern = /\bmodule\.exports\s*=\s*\{([^}]+)\}/g;
  const kindName: Record<string, string> = {
    class: "ClassDeclaration",
    const: "VariableDeclaration",
    enum: "EnumDeclaration",
    function: "FunctionDeclaration",
    interface: "InterfaceDeclaration",
    let: "VariableDeclaration",
    type: "TypeAliasDeclaration",
    var: "VariableDeclaration",
  };

  for (const match of text.matchAll(declarationPattern)) {
    const kind = kindName[match[2] ?? ""] ?? "ExportDeclaration";
    addForkConflictLiveAstExportSymbol(symbols, match[3], kind);
    if (match[1]) addForkConflictLiveAstExportSymbol(symbols, "default", "DefaultExport");
  }
  for (const match of text.matchAll(variablePattern)) {
    const declarations = (match[2] ?? "").split(",");
    for (const declaration of declarations) {
      const name = declaration.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
      addForkConflictLiveAstExportSymbol(symbols, name, "VariableDeclaration");
    }
  }
  for (const match of text.matchAll(namespaceExportPattern)) {
    addForkConflictLiveAstExportSymbol(symbols, match[1], "NamespaceExport");
  }
  if (exportAllPattern.test(text)) {
    addForkConflictLiveAstExportSymbol(symbols, "*", "ExportAll");
  }
  for (const match of text.matchAll(namedExportPattern)) {
    const names = (match[1] ?? "")
      .split(",")
      .map((item) => item.trim().replace(/^type\s+/, ""))
      .filter(Boolean);
    for (const name of names) {
      const exportedName = name.split(/\s+as\s+/i).pop()?.trim();
      addForkConflictLiveAstExportSymbol(symbols, exportedName, "ExportSpecifier");
    }
  }
  if (defaultExportPattern.test(text)) addForkConflictLiveAstExportSymbol(symbols, "default", "DefaultExport");
  for (const match of text.matchAll(commonJsPropertyPattern)) {
    addForkConflictLiveAstExportSymbol(symbols, match[1], "CommonJsExport");
  }
  for (const match of text.matchAll(commonJsObjectPattern)) {
    for (const propertyMatch of (match[1] ?? "").matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::|,|$)/g)) {
      addForkConflictLiveAstExportSymbol(symbols, propertyMatch[1], "CommonJsExport");
    }
  }
  return Array.from(symbols.values()).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 48);
}

function collectForkConflictExportSymbols(path: string, text: string): string[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|pyi)$/.test(path.toLowerCase())) return [];
  const symbols = new Set<string>();
  for (const symbol of collectForkConflictLiveAstExportSymbols(path, text)) {
    symbols.add(symbol.name);
  }
  const exportDeclarationPattern =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g;
  const defaultExportPattern = /\bexport\s+default\b/g;
  for (const match of text.matchAll(exportDeclarationPattern)) {
    if (match[1]) symbols.add(match[1]);
  }
  for (const match of text.matchAll(namedExportPattern)) {
    const names = (match[1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const name of names) {
      const exportedName = name.split(/\s+as\s+/i).pop()?.trim();
      if (exportedName && /^[A-Za-z_$][\w$]*$/.test(exportedName)) symbols.add(exportedName);
    }
  }
  if (defaultExportPattern.test(text)) symbols.add("default");
  if (/\.(py|pyi)$/.test(path.toLowerCase())) {
    for (const match of text.matchAll(/__all__\s*=\s*\[([^\]]+)\]/g)) {
      for (const nameMatch of match[1].matchAll(/["']([^"']+)["']/g)) {
        symbols.add(nameMatch[1]);
      }
    }
  }
  return Array.from(symbols).sort().slice(0, 32);
}

function formatForkConflictLiveAstExportSymbol(symbol: ForkConflictLiveAstExportSymbol): string {
  return `${symbol.name}:${symbol.kind}`;
}

function getForkConflictLiveAstExportDelta(path: string, contents?: ForkConflictContentSet): ForkConflictExportDelta {
  const base = new Map(
    collectForkConflictLiveAstExportSymbols(path, contents?.baseContent ?? "").map((symbol) => [symbol.name, symbol.kind]),
  );
  const changedFromBase = (content?: string): string[] => {
    const target = collectForkConflictLiveAstExportSymbols(path, content ?? "");
    const targetMap = new Map(target.map((symbol) => [symbol.name, symbol.kind]));
    const changed = target
      .filter((symbol) => base.get(symbol.name) !== symbol.kind)
      .map(formatForkConflictLiveAstExportSymbol);
    const removed = [...base.entries()]
      .filter(([name]) => !targetMap.has(name))
      .map(([name, kind]) => `removed:${name}:${kind}`);
    return [...changed, ...removed].slice(0, 8);
  };
  return {
    sourceChanged: changedFromBase(contents?.sourceContent),
    forkChanged: changedFromBase(contents?.forkContent),
    draftChanged: changedFromBase(contents?.draft),
  };
}

function getForkConflictExportDelta(path: string, contents?: ForkConflictContentSet): ForkConflictExportDelta {
  const base = new Set(collectForkConflictExportSymbols(path, contents?.baseContent ?? ""));
  const changedFromBase = (content?: string): string[] => {
    const target = new Set(collectForkConflictExportSymbols(path, content ?? ""));
    const added = [...target].filter((symbol) => !base.has(symbol));
    const removed = [...base].filter((symbol) => !target.has(symbol)).map((symbol) => `removed:${symbol}`);
    return [...added, ...removed].slice(0, 8);
  };
  return {
    sourceChanged: changedFromBase(contents?.sourceContent),
    forkChanged: changedFromBase(contents?.forkContent),
    draftChanged: changedFromBase(contents?.draft),
  };
}

function collectForkConflictLiveDraftDiagnosticHints(
  path: string,
  contents?: ForkConflictContentSet,
): ForkConflictLiveDraftDiagnosticHint[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return [];
  const draft = contents?.draft;
  if (draft === undefined) return [];
  const hints: ForkConflictLiveDraftDiagnosticHint[] = [];
  const conflictMarkerLine = draft.split(/\r\n|\n|\r/).findIndex((line) =>
    /^(<<<<<<<|=======|>>>>>>>)/.test(line.trimStart()),
  );
  if (conflictMarkerLine >= 0) {
    hints.push({
      kind: "ConflictMarker",
      line: conflictMarkerLine + 1,
      column: 1,
      detail: "draft still contains merge conflict marker syntax",
    });
  }

  const stack: Array<{ char: string; line: number; column: number }> = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closing = new Set(Object.values(pairs));
  let quote: "'" | '"' | "`" | null = null;
  let quoteLine = 1;
  let quoteColumn = 1;
  let escaped = false;
  let line = 1;
  let column = 0;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < draft.length; index += 1) {
    const character = draft[index];
    const next = draft[index + 1] ?? "";
    if (character === "\r") continue;
    if (character === "\n") {
      if (quote && quote !== "`") {
        hints.push({
          kind: "UnterminatedString",
          line: quoteLine,
          column: quoteColumn,
          detail: "string literal reaches a newline before closing",
        });
        quote = null;
      }
      line += 1;
      column = 0;
      lineComment = false;
      escaped = false;
      continue;
    }
    column += 1;
    if (lineComment) continue;
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
        column += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      column += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      column += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      quoteLine = line;
      quoteColumn = column;
      escaped = false;
      continue;
    }
    if (pairs[character]) {
      stack.push({ char: character, line, column });
      continue;
    }
    if (closing.has(character)) {
      const open = stack.pop();
      if (!open || pairs[open.char] !== character) {
        hints.push({
          kind: "UnmatchedDelimiter",
          line,
          column,
          detail: `unmatched closing ${character}`,
        });
        continue;
      }
    }
  }
  if (quote) {
    hints.push({
      kind: quote === "`" ? "UnterminatedTemplate" : "UnterminatedString",
      line: quoteLine,
      column: quoteColumn,
      detail: quote === "`" ? "template literal is not closed" : "string literal is not closed",
    });
  }
  if (blockComment) {
    hints.push({
      kind: "UnterminatedBlockComment",
      line,
      column: Math.max(1, column),
      detail: "block comment is not closed",
    });
  }
  for (const open of stack.slice(-3)) {
    hints.push({
      kind: "UnclosedDelimiter",
      line: open.line,
      column: open.column,
      detail: `unclosed ${open.char}`,
    });
  }
  return hints.slice(0, 6);
}

export function getForkConflictLiveDraftCompilerDiagnosticTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const hints = collectForkConflictLiveDraftDiagnosticHints(path, contents);
  if (hints.length === 0) return [];
  const summary = hints
    .map((hint) => `${hint.kind}@${hint.line}:${hint.column}`)
    .slice(0, 4)
    .join(", ");
  return getForkConflictExportSurfaceCommands(path).map(
    (command) => `Live draft compiler diagnostic preflight (${summary}): ${command}`,
  );
}

function getForkConflictExportSurfaceCommands(path: string): string[] {
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const commands = new Set<string>();
  if (/src\/shared\//.test(normalizedPath)) {
    commands.add("npm run typecheck:node");
    commands.add("npm run typecheck:web");
  }
  if (/src\/shared\/desktopapi\.ts$/.test(normalizedPath)) {
    commands.add("npm run verify:approval-center");
    commands.add("npm run verify:chat-commands");
  }
  if (/src\/renderer\//.test(normalizedPath)) {
    commands.add("npm run typecheck:web");
    commands.add("npm run verify:ui");
  }
  if (/src\/main\//.test(normalizedPath)) {
    commands.add("npm run typecheck:node");
  }
  if (/(channeladapters|channelsview|connector)/.test(normalizedPath)) {
    commands.add("npm run verify:channel-adapters");
  }
  if (/(mcplivebridge|mcpcontext|mcp)/.test(normalizedPath)) {
    commands.add("npm run verify:mcp-live-bridge");
  }
  if (/(forkworktrees|forkconflictanalysis|workspacecontext)/.test(normalizedPath)) {
    commands.add("npm run verify:fork-worktree");
  }
  if (/(workflowmarketplace|workflowruns|backgroundtasks|scheduledtasks)/.test(normalizedPath)) {
    commands.add("npm run verify:workflow-marketplace");
  }
  if (commands.size === 0 && collectForkConflictExportSymbols(path, "").length === 0) {
    commands.add(/\.(py|pyi)$/i.test(path) ? "Run the closest Python import smoke." : "Run the nearest import/typecheck smoke.");
  }
  return Array.from(commands).slice(0, 6);
}

export function getForkConflictExportSurfaceTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const delta = getForkConflictExportDelta(path, contents);
  const changedSymbols = Array.from(
    new Set([...delta.sourceChanged, ...delta.forkChanged, ...delta.draftChanged]),
  ).slice(0, 8);
  if (changedSymbols.length === 0) return [];
  return getForkConflictExportSurfaceCommands(path).map(
    (command) => `Export surface graph (${changedSymbols.join(", ")}): ${command}`,
  );
}

export function getForkConflictLiveAstExportDeltaTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return [];
  const delta = getForkConflictLiveAstExportDelta(path, contents);
  const changedSymbols = Array.from(
    new Set([...delta.sourceChanged, ...delta.forkChanged, ...delta.draftChanged]),
  ).slice(0, 8);
  if (changedSymbols.length === 0) return [];
  return getForkConflictExportSurfaceCommands(path).map(
    (command) => `Live export AST delta (${changedSymbols.join(", ")}): ${command}`,
  );
}

export function getForkConflictCompilerAstExportTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return [];
  const changedSymbols = new Set(
    [
      ...getForkConflictLiveAstExportDelta(path, contents).sourceChanged,
      ...getForkConflictLiveAstExportDelta(path, contents).forkChanged,
      ...getForkConflictLiveAstExportDelta(path, contents).draftChanged,
      ...getForkConflictExportDelta(path, contents).sourceChanged,
      ...getForkConflictExportDelta(path, contents).forkChanged,
      ...getForkConflictExportDelta(path, contents).draftChanged,
    ]
      .map((symbol) => symbol.replace(/^removed:/, ""))
      .map((symbol) => symbol.split(":", 1)[0])
      .filter(Boolean),
  );
  if (changedSymbols.size === 0) return [];
  const lookupKeys = new Set(getForkConflictImportIndexLookupKeys(path, contents));
  const suggestions: string[] = [];
  for (const entry of FORK_CONFLICT_GENERATED_AST_EXPORT_INDEX) {
    if (!lookupKeys.has(entry.module)) continue;
    const matchingSymbols = entry.symbols
      .filter((symbol) => {
        const symbolName = String(symbol.name);
        return changedSymbols.has(symbolName) || symbolName === "*" || changedSymbols.has("default");
      })
      .map((symbol) => `${String(symbol.name)}:${String(symbol.kind)}`)
      .slice(0, 6);
    if (matchingSymbols.length === 0) continue;
    for (const command of entry.commands) {
      suggestions.push(
        `Compiler AST export graph (${entry.path}; ${matchingSymbols.join(", ")}): ${command}`,
      );
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 6);
}

export function getForkConflictCompilerDiagnosticTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return [];
  const lookupKeys = new Set(getForkConflictImportIndexLookupKeys(path, contents));
  if (lookupKeys.size === 0) return [];
  const suggestions: string[] = [];
  for (const entry of FORK_CONFLICT_GENERATED_COMPILER_DIAGNOSTIC_INDEX) {
    if (!lookupKeys.has(entry.module)) continue;
    const diagnostics = (entry.syntaxDiagnostics as readonly ForkConflictGeneratedCompilerDiagnosticView[])
      .map((diagnostic) => `TS${diagnostic.code}@${diagnostic.line}`)
      .slice(0, 3);
    const diagnosticSummary =
      diagnostics.length > 0
        ? `syntax diagnostics ${diagnostics.join(", ")}`
        : `generated ${entry.scriptKind} compiler coverage`;
    for (const command of entry.commands) {
      suggestions.push(`Compiler diagnostics graph (${entry.path}; ${diagnosticSummary}): ${command}`);
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 6);
}

function getForkConflictRuleCommands(path: string): string[] {
  const lowerPath = path.replace(/\\/g, "/").toLowerCase();
  const suggestions: string[] = [];
  for (const rule of FORK_CONFLICT_TEST_GRAPH) {
    const match = lowerPath.match(rule.match);
    if (!match) continue;
    for (const command of rule.commands) {
      suggestions.push(command.replace(/\$(\d+)/g, (_, index) => match[Number(index)] || ""));
    }
  }
  return suggestions;
}

export function getForkConflictRepositoryDependencyTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const suggestions: string[] = [];
  for (const candidate of collectForkConflictRepositoryPathCandidates(path, contents)) {
    for (const command of getForkConflictRuleCommands(candidate)) {
      suggestions.push(`Repository dependency graph (${candidate}): ${command}`);
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 6);
}

function collectPackageScriptCommands(path: string, contents?: ForkConflictContentSet): string[] {
  if (!/package\.json$/i.test(path)) return [];
  const commands: string[] = [];
  for (const content of collectForkConflictContents(contents)) {
    try {
      const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
      if (!parsed.scripts || typeof parsed.scripts !== "object") continue;
      for (const [scriptName, scriptCommand] of Object.entries(parsed.scripts)) {
        if (!PACKAGE_SCRIPT_TEST_NAME.test(scriptName)) continue;
        if (typeof scriptCommand !== "string" || !scriptCommand.trim()) continue;
        commands.push(`npm run ${scriptName}`);
      }
    } catch {
      continue;
    }
  }
  return Array.from(new Set(commands)).slice(0, 6);
}

function collectPackageEntryCommands(path: string, contents?: ForkConflictContentSet): string[] {
  if (!/package\.json$/i.test(path)) return [];
  const suggestions: string[] = [];
  for (const content of collectForkConflictContents(contents)) {
    for (const specifier of collectForkConflictPackageEntrySpecifiers(content)) {
      const candidate = specifier.startsWith("./") ? specifier.slice(2) : specifier;
      for (const command of getForkConflictRuleCommands(candidate)) {
        suggestions.push(`Package entry graph (${specifier}): ${command}`);
      }
      if (suggestions.length === 0 && /\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(candidate)) {
        suggestions.push(`Package entry graph (${specifier}): npm run typecheck`);
      }
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 6);
}

export function getForkConflictDependencyTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const suggestions: string[] = [];
  suggestions.push(...getForkConflictRepositoryDependencyTestGraphSuggestions(path, contents));
  suggestions.push(...getForkConflictReverseDependencyTestGraphSuggestions(path));
  suggestions.push(...getForkConflictGeneratedRepositoryImportIndexSuggestions(path, contents));
  suggestions.push(...getForkConflictRepositoryImportIndexSuggestions(path, contents));
  suggestions.push(...getForkConflictLiveAstExportDeltaTestGraphSuggestions(path, contents));
  suggestions.push(...getForkConflictCompilerAstExportTestGraphSuggestions(path, contents));
  suggestions.push(...getForkConflictLiveDraftCompilerDiagnosticTestGraphSuggestions(path, contents));
  suggestions.push(...getForkConflictCompilerDiagnosticTestGraphSuggestions(path, contents));
  suggestions.push(...getForkConflictExportSurfaceTestGraphSuggestions(path, contents));
  for (const specifier of collectForkConflictImportSpecifiers(contents)) {
    for (const rule of FORK_CONFLICT_IMPORT_TEST_GRAPH) {
      if (!rule.match.test(specifier)) continue;
      for (const command of rule.commands) {
        suggestions.push(`Import dependency graph (${specifier}): ${command}`);
      }
    }
  }
  for (const command of collectPackageScriptCommands(path, contents)) {
    suggestions.push(`Package script graph: ${command}`);
  }
  suggestions.push(...collectPackageEntryCommands(path, contents));
  return Array.from(new Set(suggestions)).slice(0, 8);
}

export function getForkConflictReverseDependencyTestGraphSuggestions(path: string): string[] {
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  const suggestions: string[] = [];
  for (const rule of FORK_CONFLICT_REVERSE_DEPENDENCY_INDEX) {
    if (!rule.changedPath.test(normalizedPath)) continue;
    for (const dependent of rule.dependents) {
      for (const command of dependent.commands) {
        suggestions.push(`Reverse dependency index (${dependent.label}): ${command}`);
      }
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 8);
}

export function getForkConflictRepositoryImportIndexSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const lookupKeys = getForkConflictImportIndexLookupKeys(path, contents);
  if (lookupKeys.length === 0) return [];
  const suggestions: string[] = [];
  for (const rule of FORK_CONFLICT_REPOSITORY_IMPORT_INDEX) {
    if (!lookupKeys.some((key) => rule.changedModule.test(key))) continue;
    for (const importer of rule.importers) {
      for (const command of importer.commands) {
        suggestions.push(`Repository import index (${importer.label}; ${importer.path}): ${command}`);
      }
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 8);
}

export function getForkConflictGeneratedRepositoryImportIndexSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const lookupKeys = new Set(getForkConflictImportIndexLookupKeys(path, contents));
  if (lookupKeys.size === 0) return [];
  const suggestions: string[] = [];
  for (const entry of FORK_CONFLICT_GENERATED_REPOSITORY_IMPORT_INDEX) {
    if (!lookupKeys.has(entry.changedModule)) continue;
    for (const importer of entry.importers) {
      const importerKind = String(importer.kind);
      const action =
        importerKind === "re-export"
          ? "re-exports"
          : importerKind === "require"
            ? "requires"
            : importerKind === "dynamic-import"
              ? "dynamically imports"
              : importerKind === "stylesheet-import"
                ? "references from stylesheet"
                : importerKind === "markdown-link"
                  ? "links from Markdown"
              : importerKind === "config-reference"
                ? "references from config"
                : importerKind === "package-entry"
                  ? "exposes as package entry"
                : importerKind === "python-import"
                  ? "imports from Python"
                : "imports";
      for (const command of importer.commands) {
        suggestions.push(
          `Generated repository import index (${importer.path} ${action} ${entry.changedModule} via ${importer.specifier}): ${command}`,
        );
      }
    }
  }
  return Array.from(new Set(suggestions)).slice(0, 8);
}

export function getForkConflictRepoTestGraphSuggestions(
  path: string,
  contents?: ForkConflictContentSet,
): string[] {
  const suggestions = getForkConflictRuleCommands(path);
  const repoSuggestions = suggestions.map((command) => `Repo test graph: ${command}`);
  return Array.from(
    new Set([
      ...repoSuggestions,
      ...getForkConflictDependencyTestGraphSuggestions(path, contents),
    ]),
  ).slice(0, 12);
}

export function getForkConflictTestSuggestions(path: string, unresolvedMarkers: number): string[] {
  const lowerPath = path.toLowerCase();
  const suggestions = [
    unresolvedMarkers > 0
      ? "Search the resolved file for conflict markers before staging."
      : "Run the smallest test or typecheck that covers this file before merge-back.",
  ];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerPath)) {
    suggestions.push("Run the Windows desktop renderer or node verification that imports this module.");
  } else if (/\.(py|pyi)$/.test(lowerPath)) {
    suggestions.push("Run the closest Python unit test or import smoke for this package.");
  } else if (/\.(css|scss|less)$/.test(lowerPath)) {
    suggestions.push("Run the UI verification and manually inspect the affected responsive surface.");
  } else if (/\.(json|jsonc|ya?ml|toml)$/.test(lowerPath)) {
    suggestions.push("Run a config parse/build command so malformed syntax fails before staging.");
  } else if (/\.(md|mdx)$/.test(lowerPath)) {
    suggestions.push("Preview the document and check that conflict resolution did not remove required steps.");
  }
  suggestions.push("After staging all resolved files, rerun the fork merge-back verification or relevant workflow test.");
  return suggestions;
}

export function getForkConflictHunkTestSuggestions(path: string, hunk: ForkConflictDraftHunk): string[] {
  const combined = `${hunk.sourceText}\n${hunk.forkText}`.toLowerCase();
  const suggestions = [
    ...getForkConflictRepoTestGraphSuggestions(path).slice(0, 2),
    ...getForkConflictTestSuggestions(path, 0).slice(0, 2),
  ];
  if (combined.includes("test(") || combined.includes("describe(") || combined.includes("assert") || combined.includes("pytest")) {
    suggestions.unshift("This hunk touches test code; run the exact test file after choosing a side.");
  }
  if (
    combined.includes("import ") ||
    combined.includes("export ") ||
    combined.includes("from ") ||
    combined.includes("@import") ||
    combined.includes("url(") ||
    CONFIG_REFERENCE_ROOT_PREFIXES.some((prefix) => combined.includes(prefix))
  ) {
    suggestions.unshift("This hunk changes module boundaries; run typecheck or import validation.");
  }
  if (combined.includes("permission") || combined.includes("approval") || combined.includes("policy")) {
    suggestions.unshift("This hunk touches approval or policy behavior; run the matching approval/policy verification.");
  }
  return Array.from(new Set(suggestions)).slice(0, 3);
}
