import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const monorepoRoot = resolve(root, "../../..");
const sourceRoots = [
  "src/main",
  "src/preload",
  "src/renderer/src",
  "src/shared",
  "docs",
  "../../../cores/python/packages/drsai/src",
  "../../../cores/python/packages/drsai_ext/src",
  "../../../apps/webui/backend/src/drsai_ui",
  "../../../apps/android/app/src/main/java",
];
const configSourceFiles = [
  "package.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.web.json",
  "electron-builder.yml",
  "electron.vite.config.ts",
];
const outputPath = join(root, "src/renderer/src/components/forkConflictGeneratedImportIndex.ts");
const sourceExtensions = new Set([
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
  ".css",
  ".scss",
  ".less",
  ".md",
  ".mdx",
  ".py",
  ".pyi",
  ".java",
  ".kt",
  ".kts",
]);
const moduleExtensions = [
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
  ".java",
  ".kt",
  ".kts",
];
const configReferencePrefixes = [
  "apps/",
  "bootstrapper/",
  "docs/",
  "editor-integrations/",
  "resources/",
  "scripts/",
  "src/",
  "tests/",
];
const pythonPackageRoots = [
  { prefix: "drsai", root: "cores/python/packages/drsai/src/drsai" },
  { prefix: "drsai_ext", root: "cores/python/packages/drsai_ext/src/drsai_ext" },
  { prefix: "drsai_ui", root: "apps/webui/backend/src/drsai_ui" },
];
const jvmPackageRoots = [
  { prefix: "ai.drsai.remote", root: "apps/android/app/src/main/java/ai/drsai/remote" },
];

function toRepoPath(path) {
  const packageRelative = relative(root, path).replace(/\\/g, "/");
  if (!packageRelative.startsWith("..")) return packageRelative;
  return relative(monorepoRoot, path).replace(/\\/g, "/");
}

function normalizeRepoPath(value) {
  const segments = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

function getExtension(path) {
  const match = path.match(/(\.[A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function getModuleKey(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  if (!normalized) return null;
  return normalized
    .replace(/\/index\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|scss|less|md|mdx)$/i, "")
    .replace(/\/__init__\.(py|pyi)$/i, "")
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|scss|less|md|mdx|py|pyi|java|kt|kts|ya?ml|toml|ps1|cmd)$/i, "")
    .toLowerCase();
}

function resolveRepoPath(repoPath) {
  const normalized = repoPath.replace(/\\/g, "/");
  if (normalized.startsWith("cores/") || normalized.startsWith("apps/webui/")) {
    return join(monorepoRoot, normalized);
  }
  return join(root, normalized);
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (sourceExtensions.has(getExtension(entry.name)) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectSourceFiles() {
  const rootFiles = configSourceFiles.map((file) => join(root, file)).filter((file) => existsSync(file));
  return [
    ...rootFiles,
    ...sourceRoots.flatMap((sourceRoot) => {
      const absoluteRoot = join(root, sourceRoot);
      if (!existsSync(absoluteRoot)) return [];
      const files = walk(absoluteRoot);
      if (sourceRoot.startsWith("../../../")) {
        return files.filter((file) => /\.(py|pyi|java|kt|kts)$/i.test(file));
      }
      return files;
    }),
  ].filter((file) => resolve(file) !== resolve(outputPath));
}

function isConfigReferenceSource(importerRepoPath) {
  const normalized = importerRepoPath.toLowerCase();
  return (
    normalized === "package.json" ||
    /\.(json|jsonc|ya?ml|toml)$/.test(normalized)
  );
}

function collectPackageEntryEdges(content, importerRepoPath) {
  if (importerRepoPath.toLowerCase() !== "package.json") return [];
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const edges = [];
  const addSpecifier = (value) => {
    if (typeof value !== "string") return;
    const specifier = value.trim().split(/[?#]/, 1)[0];
    if (!specifier || /^(?:https?:|data:|[a-z0-9+.-]+:)/i.test(specifier)) return;
    if (
      specifier.startsWith("./") ||
      configReferencePrefixes.some((prefix) => specifier.startsWith(prefix))
    ) {
      edges.push({ specifier, kind: "package-entry" });
    }
  };
  const visit = (value) => {
    if (typeof value === "string") {
      addSpecifier(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const key of [
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
  ]) {
    visit(parsed[key]);
  }
  return Array.from(new Map(edges.map((edge) => [`${edge.kind}\0${edge.specifier}`, edge])).values());
}

function parsePythonImportList(value) {
  return value
    .split(",")
    .map((item) => item.trim().replace(/\s+as\s+[A-Za-z_][\w]*$/i, ""))
    .map((item) => item.match(/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/)?.[0] ?? "")
    .filter(Boolean);
}

function resolvePythonRelativeSpecifier(moduleName, importedNames, importerRepoPath) {
  const dotMatch = moduleName.match(/^(\.+)(.*)$/);
  if (!dotMatch) return [];
  const dotCount = dotMatch[1].length;
  const remainder = dotMatch[2].replace(/^\./, "");
  const segments = dirname(importerRepoPath).replace(/\\/g, "/").split("/");
  for (let index = 1; index < dotCount; index += 1) segments.pop();
  const base = segments.join("/");
  if (remainder) return [`${base}/${remainder.replace(/\./g, "/")}`];
  return importedNames
    .filter((name) => !name.startsWith("*") && /^[A-Za-z_][\w]*$/.test(name))
    .map((name) => `${base}/${name}`);
}

function collectPythonImportEdges(content, importerRepoPath) {
  if (!/\.(py|pyi)$/i.test(importerRepoPath)) return [];
  const edges = [];
  const addSpecifier = (specifier) => {
    const normalized = specifier.trim().replace(/\./g, "/");
    if (normalized) edges.push({ specifier: normalized, kind: "python-import" });
  };
  for (const match of content.matchAll(/^\s*import\s+([A-Za-z_][\w.]*[\w\s.,]*(?:\s+as\s+[A-Za-z_][\w]*)?)/gm)) {
    for (const specifier of parsePythonImportList(match[1] ?? "")) addSpecifier(specifier);
  }
  for (const match of content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm)) {
    const moduleName = String(match[1] ?? "").trim();
    const importedNames = parsePythonImportList(String(match[2] ?? ""));
    if (!moduleName || moduleName === "__future__") continue;
    if (moduleName.startsWith(".")) {
      for (const specifier of resolvePythonRelativeSpecifier(moduleName, importedNames, importerRepoPath)) {
        edges.push({ specifier, kind: "python-import" });
      }
      continue;
    }
    addSpecifier(moduleName);
  }
  return Array.from(new Map(edges.map((edge) => [`${edge.kind}\0${edge.specifier}`, edge])).values());
}

function collectJvmImportEdges(content, importerRepoPath) {
  if (!/\.(java|kt|kts)$/i.test(importerRepoPath)) return [];
  const edges = [];
  const addSpecifier = (value) => {
    const specifier = value
      .trim()
      .replace(/^static\s+/i, "")
      .replace(/\s+as\s+[A-Za-z_][\w]*$/i, "")
      .replace(/\.\*$/, "");
    if (/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+$/.test(specifier)) {
      edges.push({ specifier, kind: "jvm-import" });
    }
  };
  for (const match of content.matchAll(/^\s*import\s+([A-Za-z_][\w.]*(?:\.\*)?(?:\s+as\s+[A-Za-z_][\w]*)?)/gm)) {
    addSpecifier(match[1] ?? "");
  }
  return Array.from(new Map(edges.map((edge) => [`${edge.kind}\0${edge.specifier}`, edge])).values());
}

function collectImportEdges(content, importerRepoPath) {
  const edges = [
    ...collectPackageEntryEdges(content, importerRepoPath),
    ...collectPythonImportEdges(content, importerRepoPath),
    ...collectJvmImportEdges(content, importerRepoPath),
  ];
  const patterns = [
    {
      kind: "import",
      pattern: /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
    },
    {
      kind: "re-export",
      pattern: /\bexport\s+(?:type\s+)?(?:\*|[^'";]+?)\s+from\s+["']([^"']+)["']/g,
    },
    {
      kind: "require",
      pattern: /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    },
    {
      kind: "dynamic-import",
      pattern: /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    },
    {
      kind: "stylesheet-import",
      pattern: /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/g,
    },
    {
      kind: "stylesheet-import",
      pattern: /@import\s+url\(\s*([^"')\s]+)\s*\)/g,
    },
    {
      kind: "stylesheet-import",
      pattern: /\burl\(\s*["']?([^"')\s]+)["']?\s*\)/g,
    },
    {
      kind: "markdown-link",
      pattern: /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    },
  ];
  if (isConfigReferenceSource(importerRepoPath)) {
    patterns.push({
      kind: "config-reference",
      pattern:
        /(?:^|[\s"'=:,\[\]{}])((?:\.{1,2}\/|apps\/|bootstrapper\/|docs\/|editor-integrations\/|resources\/|scripts\/|src\/|tests\/)[A-Za-z0-9_./,@ -]+\.(?:jsonc|json|tsx|ts|jsx|js|mjs|cjs|scss|css|less|mdx|md|pyi|py|yaml|yml|toml|ps1|cmd))(?=$|[\s"'`,)\]}])/g,
    });
  }
  for (const { kind, pattern } of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = String(match[1] ?? "").trim().split(/[?#]/, 1)[0];
      if (/^(?:data:|https?:|#|var\()/i.test(specifier)) continue;
      if (specifier) edges.push({ specifier, kind });
    }
  }
  return Array.from(new Map(edges.map((edge) => [`${edge.kind}\0${edge.specifier}`, edge])).values());
}

function collectAstExportSymbols(content, importerRepoPath) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(importerRepoPath)) return [];
  const scriptKind = /\.(tsx|jsx)$/i.test(importerRepoPath)
    ? ts.ScriptKind.TSX
    : /\.(js|jsx|mjs|cjs)$/i.test(importerRepoPath)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(importerRepoPath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols = new Map();
  const addSymbol = (name, kind) => {
    if (!name) return;
    symbols.set(String(name), { name: String(name), kind });
  };
  const hasExportModifier = (node) =>
    Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const hasDefaultModifier = (node) =>
    Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      hasExportModifier(node)
    ) {
      addSymbol(node.name?.text ?? (hasDefaultModifier(node) ? "default" : ""), ts.SyntaxKind[node.kind]);
      if (hasDefaultModifier(node)) addSymbol("default", "DefaultExport");
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addSymbol(declaration.name.text, "VariableDeclaration");
      }
    }
    if (ts.isExportAssignment(node)) {
      addSymbol("default", "ExportAssignment");
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) {
        addSymbol("*", "ExportAll");
      } else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          addSymbol(element.name.text, "ExportSpecifier");
        }
      } else if (ts.isNamespaceExport(node.exportClause)) {
        addSymbol(node.exportClause.name.text, "NamespaceExport");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Array.from(symbols.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function getTypeScriptScriptKind(importerRepoPath) {
  if (/\.(tsx)$/i.test(importerRepoPath)) return ts.ScriptKind.TSX;
  if (/\.(jsx)$/i.test(importerRepoPath)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/i.test(importerRepoPath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function collectTypeScriptSemanticDiagnosticMap() {
  const diagnosticsByModule = new Map();
  for (const configName of ["tsconfig.node.json", "tsconfig.web.json"]) {
    const configPath = join(root, configName);
    if (!existsSync(configPath)) continue;
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) continue;
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: {
        ...parsed.options,
        noEmit: true,
      },
    });
    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      const repoPath = toRepoPath(sourceFile.fileName);
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(repoPath)) continue;
      const moduleKey = getModuleKey(repoPath);
      if (!moduleKey) continue;
      const semanticDiagnostics = program.getSemanticDiagnostics(sourceFile).slice(0, 4).map((diagnostic) => {
        const start = typeof diagnostic.start === "number" ? diagnostic.start : 0;
        const position = sourceFile.getLineAndCharacterOfPosition(start);
        return {
          code: diagnostic.code,
          line: position.line + 1,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        };
      });
      if (!diagnosticsByModule.has(moduleKey)) diagnosticsByModule.set(moduleKey, []);
      const existing = diagnosticsByModule.get(moduleKey);
      for (const diagnostic of semanticDiagnostics) {
        const key = `${diagnostic.code}\0${diagnostic.line}\0${diagnostic.message}`;
        if (existing.some((item) => `${item.code}\0${item.line}\0${item.message}` === key)) continue;
        existing.push(diagnostic);
      }
    }
  }
  return diagnosticsByModule;
}

function collectCompilerDiagnosticHints(content, importerRepoPath, semanticDiagnosticsByModule) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(importerRepoPath)) return null;
  const scriptKind = getTypeScriptScriptKind(importerRepoPath);
  const sourceFile = ts.createSourceFile(importerRepoPath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const syntaxDiagnostics = sourceFile.parseDiagnostics.slice(0, 4).map((diagnostic) => {
    const start = typeof diagnostic.start === "number" ? diagnostic.start : 0;
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      code: diagnostic.code,
      line: position.line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    };
  });
  return {
    module: getModuleKey(importerRepoPath),
    path: importerRepoPath,
    scriptKind: ts.ScriptKind[scriptKind],
    syntaxDiagnostics,
    semanticDiagnostics: (semanticDiagnosticsByModule.get(getModuleKey(importerRepoPath)) ?? []).slice(0, 4),
    commands: commandsForImporter(importerRepoPath),
  };
}

function resolveSpecifierBase(specifier, importerRepoPath) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return normalizeRepoPath(`${dirname(importerRepoPath).replace(/\\/g, "/")}/${specifier}`);
  }
  if (specifier.startsWith("@shared/")) {
    return normalizeRepoPath(`src/shared/${specifier.slice("@shared/".length)}`);
  }
  if (specifier.startsWith("@renderer/")) {
    return normalizeRepoPath(`src/renderer/src/${specifier.slice("@renderer/".length)}`);
  }
  if (specifier.startsWith("src/")) {
    return normalizeRepoPath(specifier);
  }
  if (configReferencePrefixes.some((prefix) => specifier.startsWith(prefix))) {
    return normalizeRepoPath(specifier);
  }
  for (const { prefix, root } of pythonPackageRoots) {
    if (specifier === prefix) return normalizeRepoPath(root);
    const packagePrefix = `${prefix}/`;
    if (specifier.startsWith(packagePrefix)) {
      return normalizeRepoPath(`${root}/${specifier.slice(packagePrefix.length)}`);
    }
  }
  for (const { prefix, root } of jvmPackageRoots) {
    if (specifier === prefix) return normalizeRepoPath(root);
    const packagePrefix = `${prefix}.`;
    if (specifier.startsWith(packagePrefix)) {
      return normalizeRepoPath(`${root}/${specifier.slice(packagePrefix.length).replace(/\./g, "/")}`);
    }
  }
  return null;
}

function resolveLocalModuleKey(specifier, importerRepoPath) {
  const base = resolveSpecifierBase(specifier, importerRepoPath);
  if (!base) return null;
  const absoluteBase = resolveRepoPath(base);
  const directExtension = getExtension(base);
  if (directExtension && existsSync(absoluteBase)) {
    return getModuleKey(base);
  }
  for (const extension of moduleExtensions) {
    if (existsSync(`${absoluteBase}${extension}`)) return getModuleKey(`${base}${extension}`);
  }
  for (const extension of moduleExtensions) {
    const indexPath = `${base}/index${extension}`;
    if (existsSync(resolveRepoPath(indexPath))) return getModuleKey(indexPath);
  }
  return getModuleKey(base);
}

function commandsForImporter(importerPath) {
  const commands = new Set();
  const normalized = importerPath.toLowerCase();
  if (normalized.startsWith("src/renderer/")) {
    commands.add("npm run typecheck:web");
  }
  if (normalized.startsWith("src/main/") || normalized.startsWith("src/preload/")) {
    commands.add("npm run typecheck:node");
  }
  if (normalized.startsWith("src/shared/")) {
    commands.add("npm run typecheck:node");
    commands.add("npm run typecheck:web");
  }
  if (/approvalcenter|executionpolicy/.test(normalized)) {
    commands.add("npm run verify:approval-center");
    commands.add("npm run verify:execution-policy");
  }
  if (/channeladapters|channelsview/.test(normalized)) commands.add("npm run verify:channel-adapters");
  if (/mcplivebridge|mcpcontext|mcp/.test(normalized)) commands.add("npm run verify:mcp-live-bridge");
  if (/forkworktrees|forkconflictanalysis|workspaceshell/.test(normalized)) commands.add("npm run verify:fork-worktree");
  if (/workflowmarketplace|workflowruns|backgroundtasks|scheduledtasks|skillsquareview/.test(normalized)) {
    commands.add("npm run verify:workflow-marketplace");
  }
  if (/chatcommands|chatworkspace|usedesktopchatadapter/.test(normalized)) commands.add("npm run verify:chat-commands");
  if (/\.(css|scss|less)$/i.test(normalized)) commands.add("npm run verify:ui");
  if (/\.(md|mdx)$/i.test(normalized)) commands.add("Preview the referencing Markdown document.");
  if (/\.(py|pyi)$/i.test(normalized)) commands.add("Run the closest Python unit test or import smoke for this package.");
  if (/^apps\/android\//.test(normalized) || /\.(java|kt|kts)$/i.test(normalized)) {
    commands.add("Run the closest Android Gradle compile or unit test when the Android toolchain is available.");
  }
  if (/^(package\.json|tsconfig|electron-builder|electron\.vite)/.test(normalized)) commands.add("npm run verify");
  if (/chatbar-capability-checklist|smart-chat-bar-roadmap/.test(normalized)) commands.add("npm run verify:chatbar-checklist");
  if (commands.size === 0) commands.add("npm run typecheck");
  return Array.from(commands).slice(0, 5);
}

const index = new Map();
const astExportIndex = [];
const compilerDiagnosticIndex = [];
const semanticDiagnosticsByModule = collectTypeScriptSemanticDiagnosticMap();

for (const file of collectSourceFiles()) {
  const importerPath = toRepoPath(file);
  const content = readFileSync(file, "utf8");
  const astExports = collectAstExportSymbols(content, importerPath);
  const astModuleKey = getModuleKey(importerPath);
  if (astModuleKey && astExports.length > 0) {
    astExportIndex.push({
      module: astModuleKey,
      path: importerPath,
      symbols: astExports,
      commands: commandsForImporter(importerPath),
    });
  }
  const compilerDiagnostics = collectCompilerDiagnosticHints(content, importerPath, semanticDiagnosticsByModule);
  if (compilerDiagnostics?.module) {
    compilerDiagnosticIndex.push(compilerDiagnostics);
  }
  for (const { specifier, kind } of collectImportEdges(content, importerPath)) {
    const changedModule = resolveLocalModuleKey(specifier, importerPath);
    if (!changedModule) continue;
    if (!index.has(changedModule)) index.set(changedModule, []);
    index.get(changedModule).push({
      path: importerPath,
      specifier,
      kind,
      commands: commandsForImporter(importerPath),
    });
  }
}

const entries = Array.from(index.entries())
  .map(([changedModule, importers]) => ({
    changedModule,
    importers: Array.from(
      new Map(importers.map((importer) => [`${importer.path}\0${importer.specifier}\0${importer.kind}`, importer])).values(),
    ).sort((left, right) => left.path.localeCompare(right.path)),
  }))
  .sort((left, right) => left.changedModule.localeCompare(right.changedModule));

const astExportEntries = astExportIndex.sort((left, right) => left.module.localeCompare(right.module));
const compilerDiagnosticEntries = compilerDiagnosticIndex.sort((left, right) => left.module.localeCompare(right.module));

const output = `// Generated by scripts/generate-fork-import-index.mjs. Do not edit by hand.
export interface ForkConflictGeneratedRepositoryImporter {
  readonly path: string;
  readonly specifier: string;
  readonly kind: "import" | "re-export" | "require" | "dynamic-import" | "stylesheet-import" | "markdown-link" | "config-reference" | "package-entry" | "python-import" | "jvm-import";
  readonly commands: readonly string[];
}

export interface ForkConflictGeneratedRepositoryImportEntry {
  readonly changedModule: string;
  readonly importers: readonly ForkConflictGeneratedRepositoryImporter[];
}

export interface ForkConflictGeneratedAstExportSymbol {
  readonly name: string;
  readonly kind: string;
}

export interface ForkConflictGeneratedAstExportEntry {
  readonly module: string;
  readonly path: string;
  readonly symbols: readonly ForkConflictGeneratedAstExportSymbol[];
  readonly commands: readonly string[];
}

export interface ForkConflictGeneratedCompilerDiagnostic {
  readonly code: number;
  readonly line: number;
  readonly message: string;
}

export interface ForkConflictGeneratedCompilerDiagnosticEntry {
  readonly module: string;
  readonly path: string;
  readonly scriptKind: string;
  readonly syntaxDiagnostics: readonly ForkConflictGeneratedCompilerDiagnostic[];
  readonly semanticDiagnostics: readonly ForkConflictGeneratedCompilerDiagnostic[];
  readonly commands: readonly string[];
}

export const FORK_CONFLICT_GENERATED_REPOSITORY_IMPORT_INDEX = ${JSON.stringify(entries, null, 2)} as const satisfies readonly ForkConflictGeneratedRepositoryImportEntry[];

export const FORK_CONFLICT_GENERATED_AST_EXPORT_INDEX = ${JSON.stringify(astExportEntries, null, 2)} as const satisfies readonly ForkConflictGeneratedAstExportEntry[];

export const FORK_CONFLICT_GENERATED_COMPILER_DIAGNOSTIC_INDEX = ${JSON.stringify(compilerDiagnosticEntries, null, 2)} as const satisfies readonly ForkConflictGeneratedCompilerDiagnosticEntry[];
`;

writeFileSync(outputPath, output, "utf8");
console.log(`Generated ${entries.length} fork conflict import index entries at ${toRepoPath(outputPath)}.`);
