import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const checks = [
  {
    file: "src/shared/desktopApi.ts",
    markers: [
      "WorkspaceContextOverview",
      "WorkspaceFilePreview",
      "WorkspaceGitDiffResult",
      "getWorkspaceContextOverview(workspacePath: string)",
      "listWorkspaceFiles(request: WorkspaceFileTreeRequest)",
      "previewWorkspaceFile(request: WorkspaceFilePreviewRequest)",
      "getWorkspaceGitDiff(request: WorkspaceGitDiffRequest)",
    ],
  },
  {
    file: "src/main/index.ts",
    markers: [
      "desktop:workspace-context-overview",
      "desktop:workspace-files",
      "desktop:workspace-file-preview",
      "desktop:workspace-git-diff",
    ],
  },
  {
    file: "src/preload/index.ts",
    markers: [
      "desktop:workspace-context-overview",
      "desktop:workspace-files",
      "desktop:workspace-file-preview",
      "desktop:workspace-git-diff",
    ],
  },
  {
    file: "src/main/workspaceContext.ts",
    markers: [
      "readInstructionChain",
      "getGitChangedFiles",
      "classifyPreviewKind",
      "kind === \"large\"",
      "ensureInside",
      "parseDelimitedRows",
    ],
  },
  {
    file: "src/renderer/src/components/WorkspaceContextPanel.tsx",
    markers: [
      "WorkspaceContextPanel",
      "WorkspaceFilePreviewPane",
      "files-sidebar-panel",
      "files-tree-row",
      "onPreviewFile",
      "preview.kind === \"image\"",
      "preview.kind === \"table\"",
      "Selected from Files panel",
    ],
  },
  {
    file: "src/renderer/src/App.tsx",
    markers: [
      "workspaceContextAttachments",
      "workspaceFilePreview",
      "externalChatAttachments",
      "activeRightTab === \"files\"",
      "WorkspaceContextPanel",
      "WorkspaceFilePreviewPane",
      "setWorkspaceContextAttachments([])",
    ],
  },
  {
    file: "src/renderer/src/mockDesktopApi.ts",
    markers: [
      "createMockWorkspaceOverview",
      "createMockWorkspaceFiles",
      "createMockWorkspacePreview",
      "createMockWorkspaceDiff",
      "previewKind: \"table\"",
      "previewKind: \"image\"",
      "previewKind: \"pdf\"",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const content = readFileSync(join(root, check.file), "utf8");
  for (const marker of check.markers) {
    if (!content.includes(marker)) {
      failures.push(`${check.file} is missing marker: ${marker}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Workspace context verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Workspace context verification passed.");
