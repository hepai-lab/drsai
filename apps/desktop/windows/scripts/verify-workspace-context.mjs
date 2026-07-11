import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const e2eSmoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");

const checks = [
  {
    file: "src/shared/desktopApi.ts",
    markers: [
      "WorkspaceContextOverview",
      "WorkspaceFilePreview",
      "WorkspaceGitDiffResult",
      "fileHash?: string",
      "diffHash?: string",
      "mode?: \"auto\" | \"head\" | \"tail\" | \"outline\"",
      "staged?: boolean",
      "WorkspaceRevertFileRequest",
      "WorkspaceRevertFileResult",
      "WorkspaceStageFileRequest",
      "WorkspaceStageFileResult",
      "WorkspaceHunkActionRequest",
      "WorkspaceHunkActionResult",
      "AgentRunFileEvent",
      "type: \"start\" | \"chunk\" | \"file_event\"",
      "| \"notebook\"",
      "metadata?: Record<string, string | number | boolean | null>",
      "getWorkspaceContextOverview(workspacePath: string)",
      "listWorkspaceFiles(request: WorkspaceFileTreeRequest)",
      "previewWorkspaceFile(request: WorkspaceFilePreviewRequest)",
      "getWorkspaceGitDiff(request: WorkspaceGitDiffRequest)",
      "revertWorkspaceFile(request: WorkspaceRevertFileRequest)",
      "stageWorkspaceFile(request: WorkspaceStageFileRequest)",
      "stageWorkspaceHunk(request: WorkspaceHunkActionRequest)",
      "revertWorkspaceHunk(request: WorkspaceHunkActionRequest)",
    ],
  },
  {
    file: "src/main/index.ts",
    markers: [
      "desktop:workspace-context-overview",
      "desktop:workspace-files",
      "desktop:workspace-file-preview",
      "desktop:workspace-git-diff",
      "desktop:workspace-revert-file",
      "desktop:workspace-stage-file",
      "desktop:workspace-stage-hunk",
      "desktop:workspace-revert-hunk",
    ],
  },
  {
    file: "src/preload/index.ts",
    markers: [
      "desktop:workspace-context-overview",
      "desktop:workspace-files",
      "desktop:workspace-file-preview",
      "desktop:workspace-git-diff",
      "desktop:workspace-revert-file",
      "desktop:workspace-stage-file",
      "desktop:workspace-stage-hunk",
      "desktop:workspace-revert-hunk",
    ],
  },
  {
    file: "src/main/workspaceContext.ts",
    markers: [
      "readInstructionChain",
      "getGitChangedFiles",
      "classifyPreviewKind",
      "kind === \"large\"",
      "readFileTail",
      "hashFile",
      "extractPdfText",
      "extractOfficeText",
      "extractZipEntries",
      "inflateRawSync",
      "selectOfficeXmlParts",
      "decodeXmlEntities",
      "createTextOutline",
      "request.staged",
      "revertWorkspaceFile",
      "stageWorkspaceFile",
      "stageWorkspaceHunk",
      "revertWorkspaceHunk",
      "prepareHunkAction",
      "ensurePatchOnlyTargets",
      "runGitWithInput",
      "expectedDiffHash",
      "hashString(currentDiff)",
      "add",
      "restore",
      "ensureInside",
      "parseDelimitedRows",
      "createNotebookCellPreview",
      "createNotebookOutline",
      "readImageMetadata",
      "readImageDimensions",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/FilePreviewer.tsx",
    markers: [
      "NotebookPreviewer",
      "preview.kind === \"notebook\"",
      "ImagePreviewer",
      "MetadataPreviewer",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/NotebookPreviewer.tsx",
    markers: [
      "NotebookPreviewer",
      "Notebook cells",
      "files-preview-notebook",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/ImagePreviewer.tsx",
    markers: [
      "MetadataList",
      "preview.metadata",
    ],
  },
  {
    file: "src/main/sseParser.ts",
    markers: [
      "parseAgentRunSseFileEvents",
      "file_event",
      "file_events",
      "metadata?.file_events",
      "normalizeFileEvents",
    ],
  },
  {
    file: "src/main/agentRuns.ts",
    markers: [
      "parseAgentRunSseFileEvents",
      "type: \"file_event\"",
      "fileEvent",
      "readWorkspaceFileSnapshot",
      "emitWorkspaceSnapshotEvents",
      "desktop-git-snapshot",
      "git\", args",
    ],
  },
  {
    file: "src/renderer/src/components/files/FilesContextPanel.tsx",
    markers: [
      "FilesContextPanel",
      "files-context-header",
      "files-context-preview",
      "files-context-tree-pane",
      "files-context-groups",
      "FilesSectionGroup",
      "Context Prep",
      "Change Review",
      "Agent Trace",
      "Repo Insight",
      "ContextBasket",
      "InstructionChainPreview",
      "GitDiffPreview",
      "AgentFileActivityPanel",
      "FileConflictPanel",
      "ContextSnapshotPanel",
      "ArtifactsPanel",
      "contextSnapshots",
      "recordSnapshot",
      "PatchReviewPanel",
      "RepoMapPanel",
      "setDiffPreview",
      "selectedForContext",
      "attachSelectedContextNodes",
      "createDirectoryAttachment",
      "previewWithMode",
      "openSelectedWithSystem",
      "attachSelectedStagedDiff",
      "attachWorkspaceDiff",
      "previewWorkspaceFile",
      "previewRequestPathRef",
      "setPreview(null)",
      "autoExpand={Boolean(query.trim())}",
      "openSelectedWithSystem",
      "Selected from Files context",
      "confirmUntrustedContextShare",
      "confirmLargeDirectoryContext",
      "workspaceTrusted",
    ],
  },
  {
    file: "src/renderer/src/components/files/AgentFileActivityPanel.tsx",
    markers: [
      "AgentFileActivityPanel",
      "AgentFileTraceEvent",
      "createTraceEventsFromAttachments",
      "createAgentRunContextTraceEvents",
      "agent_run_context_sent",
      "createTraceEventFromAgentFileEvent",
      "agent_file_read",
      "agent_file_write",
      "agent_file_delete",
      "agent_artifact",
      "snapshotId",
      "hashAttachment",
      "attachment.fileHash",
      "stale",
      "currentAttachments",
      "scopeId",
      "runId",
      "source",
      "explicit user authorization",
      "Real agent read/write traces",
    ],
  },
  {
    file: "src/renderer/src/components/files/FileConflictPanel.tsx",
    markers: [
      "FileConflictPanel",
      "collectConflicts",
      "agent_file_write",
      "agent_file_delete",
      "agent_artifact",
      "extractRunId",
    ],
  },
  {
    file: "src/renderer/src/components/AgentRunWorkspace.tsx",
    markers: [
      "fileContextAttachments",
      "onAgentFileEvent",
      "event.type === \"file_event\"",
      "serializeAgentRunFileContext",
      "files: fileContextAttachments.map(serializeAgentRunFileContext)",
      "file_context_count",
      "file_context_paths",
      "onFileContextSent",
    ],
  },
  {
    file: "src/renderer/src/components/files/ContextSnapshotPanel.tsx",
    markers: [
      "ContextSnapshotPanel",
      "ContextSnapshot",
      "createContextSnapshot",
      "instructionHashes",
      "diffHash",
      "stale",
      "hashAttachment",
      "fileHash",
    ],
  },
  {
    file: "src/renderer/src/components/files/ArtifactsPanel.tsx",
    markers: [
      "ArtifactsPanel",
      "collectArtifacts",
      "AgentFileTraceEvent",
      "agent_artifact",
      "gitStatus === \"added\"",
      "gitStatus === \"untracked\"",
      "createSyntheticArtifactNode",
      "onPreview",
      "onOpen",
    ],
  },
  {
    file: "src/renderer/src/components/files/PatchReviewPanel.tsx",
    markers: [
      "PatchReviewPanel",
      "parseDiffHunks",
      "HunkDecision",
      "revertWorkspaceFile",
      "stageWorkspaceFile",
      "stageWorkspaceHunk",
      "revertWorkspaceHunk",
      "expectedDiffHash",
      "DiffHunk",
      "hunk.patch",
      "Approve and stage file",
      "Safe revert file",
      "approved",
      "rejected",
      "review only",
    ],
  },
  {
    file: "src/renderer/src/components/files/RepoMapPanel.tsx",
    markers: [
      "RepoMapPanel",
      "collectRepoStats",
      "extractDependencies",
      "preview?.outline",
      "Current Symbols",
      "Light Dependencies",
      "hotspots",
      "flattenNodes",
    ],
  },
  {
    file: "src/renderer/src/components/files/DirectoryContextPreview.tsx",
    markers: [
      "DirectoryContextPreview",
      "files-directory-preview",
      "Attach folder",
      "Manifest truncated",
    ],
  },
  {
    file: "src/renderer/src/components/files/GitDiffPreview.tsx",
    markers: [
      "GitDiffPreview",
      "files-diff-preview",
      "WorkspaceGitDiffResult",
      "diff.truncated",
    ],
  },
  {
    file: "src/renderer/src/components/files/ContextBasket.tsx",
    markers: [
      "ContextBasket",
      "files-context-basket",
      "attachments.filter",
      "onChange([])",
      "moveAttachment",
      "ArrowUp",
      "ArrowDown",
      "estimateContextSize",
    ],
  },
  {
    file: "src/renderer/src/components/files/FilePreview.tsx",
    markers: [
      "FilePreviewErrorBoundary",
      "componentDidCatch",
      "resetKey",
      "./file_previewer/FilePreviewer",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/FilePreviewer.tsx",
    markers: [
      "FilePreviewer",
      "preview.kind === \"image\"",
      "preview.kind === \"table\"",
      "preview.kind === \"markdown\"",
      "preview.kind === \"html\"",
      "preview.kind === \"config\"",
      "preview.kind === \"pdf\"",
      "preview.kind === \"office\"",
      "preview.kind === \"media\"",
      "preview.outline?.length",
      "MetadataPreviewer",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/PdfPreviewer.tsx",
    markers: [
      "files-preview-pdf-safe",
      "Inline PDF rendering is disabled",
      "formatBytes",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/MarkdownPreviewer.tsx",
    markers: [
      "ReactMarkdown",
      "remarkGfm",
      "mode",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/TablePreviewer.tsx",
    markers: [
      "pageRows",
      "preview.columns",
      "preview.rows",
      "Dataset schema",
      "inferDatasetSchema",
      "inferDatasetColumnType",
    ],
  },
  {
    file: "src/renderer/src/components/files/file_previewer/StructuredPreviewer.tsx",
    markers: [
      "StructuredPreviewer",
      "parseStructuredContent",
      "StructuredNode",
    ],
  },
  {
    file: "src/renderer/src/components/files/FilesTree.tsx",
    markers: [
      "FilesTree",
      "autoExpand",
      "files-tree-row",
      "expandedPaths",
      "new Set()",
      "toggleExpanded",
      "handleRowClick",
      "collectDirectoryPaths",
      "files-tree-toggle",
      "selectedForContext",
      "onToggleContext",
      "files-tree-name",
      "gitStatus",
    ],
  },
  {
    file: "src/renderer/src/components/files/InstructionChainPreview.tsx",
    markers: [
      "InstructionChainPreview",
      "files-instruction-chain",
      "WorkspaceInstructionSummary",
      "Workspace instruction selected from Files context",
      "instruction.truncated",
    ],
  },
  {
    file: "src/renderer/src/App.tsx",
    markers: [
      "workspaceContextAttachments",
      "workspaceContextAttachmentsByThread",
      "workspaceFileTraceByThread",
      "externalChatAttachments",
      "createAgentRunContextTraceEvents",
      "createTraceEventFromAgentFileEvent",
      "fileContextAttachments={workspaceContextAttachments}",
      "onAgentFileEvent",
      "onFileContextSent",
      "activeRightTab === \"files\"",
      "FilesContextPanel",
      "scopeId={activeThreadId}",
      "setActiveThreadWorkspaceContextAttachments([])",
    ],
  },
  {
    file: "src/renderer/src/mockDesktopApi.ts",
    markers: [
      "createMockWorkspaceOverview",
      "createMockWorkspaceFiles",
      "createMockWorkspacePreview",
      "createMockWorkspaceDiff",
      "revertWorkspaceFile",
      "stageWorkspaceFile",
      "stageWorkspaceHunk",
      "revertWorkspaceHunk",
      "type: \"file_event\"",
      "fileHash",
      "diffHash",
      "Mock extracted PDF text preview",
      "Mock extracted Office text preview",
      "mode === \"outline\"",
      "staged",
      "previewKind: \"table\"",
      "previewKind: \"image\"",
      "previewKind: \"pdf\"",
      "previewKind: \"notebook\"",
      "metadata: { format: \"SVG\"",
      "Notebook cell preview generated",
    ],
  },
];

for (const marker of [
  "prepareWorkspaceReviewFixture",
  "fileAcceptRequiresApproval",
  "fileAcceptStagesReviewedDiff",
  "fileRejectRequiresApproval",
  "fileRejectClearsReviewedDiff",
  "reviewPathTraversalRejected",
  "staleReviewedDiffRejected",
  "nonGitBaselineCaptured",
  "nonGitChangeDetected",
  "nonGitRestoreRequiresApproval",
  "nonGitRestoreRestoresDisk",
]) {
  if (!e2eSmoke.includes(marker)) {
    console.error(`Workspace context verification failed: packaged runtime coverage omits ${marker}`);
    process.exit(1);
  }
}

const failures = [];

for (const check of checks) {
  const content = readFileSync(join(root, check.file), "utf8");
  for (const marker of check.markers) {
    if (!content.includes(marker)) {
      failures.push(`${check.file} is missing marker: ${marker}`);
    }
  }
}

const appContent = readFileSync(join(root, "src/renderer/src/App.tsx"), "utf8");
const forbiddenAppMarkers = [
  "WorkspaceFilePreviewPane",
  "workspaceFilePreview",
  "onPreviewFile",
  "components/WorkspaceContextPanel",
];
for (const marker of forbiddenAppMarkers) {
  if (appContent.includes(marker)) {
    failures.push(`src/renderer/src/App.tsx must not contain marker: ${marker}`);
  }
}

const filesContextContent = readFileSync(
  join(root, "src/renderer/src/components/files/FilesContextPanel.tsx"),
  "utf8",
);
for (const marker of [
  "files-context-header",
  "files-context-preview",
  "files-context-tree-pane",
]) {
  if (!filesContextContent.includes(marker)) {
    failures.push(`FilesContextPanel is missing internal Files layout marker: ${marker}`);
  }
}

const shellContent = readFileSync(
  join(root, "src/renderer/src/components/WorkspaceShell.tsx"),
  "utf8",
);
for (const marker of [
  "context-right-panel",
  'activeRightTab === "browser" ? "browser-right-panel"',
]) {
  if (!shellContent.includes(marker)) {
    failures.push(`WorkspaceShell is missing right context layout marker: ${marker}`);
  }
}

const stylesContent = readFileSync(join(root, "src/renderer/src/styles.css"), "utf8");
for (const marker of [
  ".right-panel.context-right-panel",
  ".context-right-panel .right-tabs",
  ".context-right-panel .files-context-panel",
  ".context-right-panel .terminal-side-panel",
  "flex: 1 1 0",
  "height: auto",
  "overflow: hidden",
]) {
  if (!stylesContent.includes(marker)) {
    failures.push(`styles.css is missing right context layout marker: ${marker}`);
  }
}
const contextPanelLayoutRule =
  stylesContent.match(
    /\.context-right-panel \.workspace-context-panel,[\s\S]*?\.context-right-panel \.side-placeholder\s*\{[\s\S]*?\}/,
  )?.[0] ?? "";
if (/height:\s*100%/.test(contextPanelLayoutRule)) {
  failures.push("right context child panels must not use height: 100%; use flex remaining space instead");
}

if (failures.length > 0) {
  console.error("Workspace context verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Workspace context verification passed.");
