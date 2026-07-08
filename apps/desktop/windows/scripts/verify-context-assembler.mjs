import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Context assembler verification failed: ${message}`);
    process.exit(1);
  }
}

const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const chatMain = read("src/main/chat.ts");
const workspaceContext = read("src/main/workspaceContext.ts");
const myDrSaiConfig = read("src/main/myDrSaiConfig.ts");
const preload = read("src/preload/index.ts");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const sharedApi = read("src/shared/desktopApi.ts");
const app = read("src/renderer/src/App.tsx");
const styles = read("src/renderer/src/styles.css");
const packageJson = read("package.json");

assert(
  chatWorkspace.includes("workspaceInstructions?: WorkspaceInstructionSummary[]"),
  "ChatWorkspace does not accept workspace instructions",
);
assert(
  chatWorkspace.includes("queuedContextAttachments"),
  "composer does not assemble local and external attachments before submit",
);
assert(
  chatWorkspace.includes("createContextPreviewItems"),
  "context preview item builder is missing",
);
assert(
  chatWorkspace.includes('selection: "Selection"') &&
    chatWorkspace.includes("ClipboardList") &&
    chatWorkspace.includes("selection: 100"),
  "@selection attachments are not included in the visible context preview and budget estimate",
);
assert(
  sharedApi.includes('"terminal" | "selection"'),
  "shared chat attachment type does not support @selection context",
);
assert(
  sharedApi.includes("WorkspaceFolderSummaryRequest") &&
    sharedApi.includes("WorkspaceFolderSummaryResult") &&
    sharedApi.includes("summarizeWorkspaceFolder"),
  "shared API does not expose bounded @folder summary context",
);
assert(
  workspaceContext.includes("summarizeWorkspaceFolder") &&
    workspaceContext.includes("DEFAULT_FOLDER_SUMMARY_ENTRIES") &&
    workspaceContext.includes("MAX_FOLDER_SUMMARY_FILE_BYTES") &&
    workspaceContext.includes("sampledFiles") &&
    workspaceContext.includes("NOISY_DIRS"),
  "main-process workspace context does not build a bounded folder summary",
);
assert(
  preload.includes("desktop:workspace-folder-summary") &&
    mock.includes("createMockWorkspaceFolderSummary") &&
    mock.includes("summarizeWorkspaceFolder"),
  "preload or mock bridge does not expose folder summary context",
);
assert(
  chatWorkspace.includes("desktopApi.summarizeWorkspaceFolder") &&
    chatWorkspace.includes("visibleText: summary.summary") &&
    chatWorkspace.includes("summary.estimatedTokens"),
  "composer does not convert @folder attachments into reviewed summary context",
);
assert(
  chatWorkspace.includes("parseInlineContextMentions") &&
    chatWorkspace.includes("@file") &&
    chatWorkspace.includes("@folder") &&
    chatWorkspace.includes("resolveInlineMentionPath") &&
    chatWorkspace.includes("summarizeInlineFolderAttachment") &&
    chatWorkspace.indexOf("resolvedInlineMentionAttachments") < chatWorkspace.indexOf("await onSubmit"),
  "composer does not parse inline @file/@folder mentions before submit",
);
assert(
  chatMain.includes('attachment.kind !== "folder"') &&
    chatMain.includes("Folder summary:") &&
    chatMain.includes("folder-summary-missing"),
  "main-process chat context assembly does not inline reviewed @folder summaries",
);
assert(
  chatMain.includes('attachment.kind !== "selection"') &&
    chatMain.includes("Selected text:") &&
    chatMain.includes("empty-${attachment.kind}-context"),
  "main-process chat context assembly does not validate and inline @selection attachments",
);
assert(
  chatWorkspace.includes("CONTEXT_TOKEN_BUDGET") &&
    chatWorkspace.includes("estimateContextBudget") &&
    chatWorkspace.includes("estimateBackendSerializedContextTokens") &&
    chatWorkspace.includes("serializeAttachmentForBackendEstimate") &&
    chatWorkspace.includes("CONTEXT_SYSTEM_PREAMBLE_TOKENS") &&
    chatWorkspace.includes("formatApproxTokens"),
  "context token budget estimation is missing",
);
assert(
  chatWorkspace.includes("Visible page text and structure:") &&
    chatWorkspace.includes("Terminal output:") &&
    chatWorkspace.includes("Selected text:") &&
    chatWorkspace.includes("Folder summary:") &&
    chatWorkspace.includes("Workspace instruction:") &&
    chatWorkspace.includes("cjkChars") &&
    chatWorkspace.includes("asciiWords") &&
    chatWorkspace.includes("punctuation"),
  "context token estimate is not aligned with backend serialized attachment and instruction prompts",
);
assert(
  chatWorkspace.includes("activeModelConfig") &&
    chatWorkspace.includes("findSelectedModelConfig") &&
    chatWorkspace.includes("getModelTokenLimit") &&
    chatWorkspace.includes("getTokenizerCalibration") &&
    chatWorkspace.includes("tokenizer_calibration") &&
    chatWorkspace.includes("rawEstimatedTokens") &&
    chatWorkspace.includes("Tokenizer-calibrated") &&
    chatWorkspace.includes("calibrationDrift") &&
    chatWorkspace.includes("formatCalibrationDrift") &&
    chatWorkspace.includes("driftPercent") &&
    chatWorkspace.includes("calibration drift") &&
    chatWorkspace.includes("single calibration sample") &&
    chatWorkspace.includes("token_limit") &&
    chatWorkspace.includes("max_tokens") &&
    chatWorkspace.includes("CONTEXT_OUTPUT_RESERVE_TOKENS") &&
    chatWorkspace.includes("FALLBACK_CONTEXT_TOKEN_BUDGET") &&
    chatWorkspace.includes("reservedOutputTokens") &&
    chatWorkspace.includes("Model limit"),
  "context token budget is not aligned with selected model limits and output reserve",
);
assert(
  sharedApi.includes("MyDrSaiTokenizerCalibrationSample") &&
    sharedApi.includes("tokenizer_calibration?: MyDrSaiTokenizerCalibrationSample[]"),
  "shared model config does not expose tokenizer calibration samples",
);
assert(
  myDrSaiConfig.includes("normalizeTokenizerCalibration") &&
    myDrSaiConfig.includes("MAX_TOKENIZER_CALIBRATION_SAMPLES") &&
    myDrSaiConfig.includes("MAX_TOKENIZER_CALIBRATION_SAMPLE_CHARS") &&
    myDrSaiConfig.includes('TOKENIZER_CALIBRATION_FILE = ".drsai/tokenizer-calibration.json"') &&
    myDrSaiConfig.includes("applyWorkspaceTokenizerCalibration") &&
    myDrSaiConfig.includes("readWorkspaceTokenizerCalibration") &&
    myDrSaiConfig.includes("isWorkspaceLocalPath") &&
    myDrSaiConfig.includes("Math.floor(tokens)") &&
    myDrSaiConfig.includes("tokenizer_calibration: normalizeTokenizerCalibration"),
  "main-process model catalog does not bound, normalize, and merge workspace tokenizer calibration samples",
);
assert(
  preload.includes("desktop:get-my-drsai-config") &&
    preload.includes("workspacePath?: string") &&
    app.includes("desktopApi.getMyDrSaiConfig(effectiveWorkspacePath)") &&
    app.includes("[effectiveWorkspacePath, health?.gatewayReady]"),
  "workspace-local tokenizer calibration samples are not routed through the desktop bridge",
);
assert(
  mock.includes("tokenizer_calibration") &&
    mock.includes("Workspace tokenizer calibration sample pack") &&
    mock.includes("Attachment preview: README.md") &&
    mock.includes("Workspace instruction: AGENTS.md"),
  "mock model catalog does not exercise tokenizer calibration samples",
);
assert(
  chatWorkspace.includes("context-assembly-preview"),
  "context assembly preview markup is missing",
);
assert(
  chatWorkspace.includes("context-budget-meter") &&
    chatWorkspace.includes("Estimated prompt context budget") &&
    chatWorkspace.includes("contextBudget.source"),
  "model-aware context budget preview markup is missing",
);
assert(
  chatWorkspace.includes("Only these visible sources and workspace instructions are sent"),
  "context boundary copy is missing",
);
assert(
  chatWorkspace.indexOf("queuedContextAttachments") < chatWorkspace.indexOf("await onSubmit"),
  "context attachments should be assembled before submit",
);
assert(
  app.includes("workspaceInstructions={effectiveWorkspaceInstructions}"),
  "App does not pass active workspace instructions into ChatWorkspace",
);
assert(
  app.includes("workspacePath={effectiveWorkspacePath}"),
  "App does not pass the active workspace path into ChatWorkspace for inline mentions",
);
assert(
  styles.includes(".context-assembly-preview") &&
    styles.includes(".context-assembly-preview-item") &&
    styles.includes(".context-budget-meter") &&
    styles.includes(".context-budget-meter small"),
  "context assembly preview styles are missing",
);
assert(
  packageJson.includes('"verify:context-assembler"'),
  "package script is not registered",
);

console.log("Context assembler verification passed.");
