import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const sharedApi = read("../shared/api/desktopApi.ts");
const threads = read("../shared/main/threads.ts");
const main = read("src/main/index.ts");
const app = read("../shared/renderer/src/App.tsx");
const chatAdapter = read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const forkConflictAnalysis = read("../shared/renderer/src/components/forkConflictAnalysis.ts");
const css = read("../shared/renderer/src/styles.css");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const preload = read("../shared/main/preload.ts");

const checks = [
  [
    "thread metadata is part of the shared DesktopThread model",
    sharedApi.includes("pinned?: boolean") &&
      sharedApi.includes("archived?: boolean") &&
      sharedApi.includes("unread?: boolean"),
  ],
  [
    "thread update request can persist pinned archived and unread state",
    sharedApi.includes("export interface UpdateThreadRequest") &&
      sharedApi.includes("pinned?: boolean") &&
      sharedApi.includes("archived?: boolean") &&
      sharedApi.includes("unread?: boolean"),
  ],
  [
    "shared api exposes persistent thread snapshots",
    sharedApi.includes("export interface DesktopThreadSnapshot") &&
      sharedApi.includes("getThreadSnapshot(threadId: string)") &&
      sharedApi.includes("updateThreadSnapshot(snapshot: DesktopThreadSnapshot)"),
  ],
  [
    "main process persists and reads thread snapshots",
    threads.includes("THREAD_SNAPSHOTS_FILE") &&
      threads.includes("export async function getThreadSnapshot") &&
      threads.includes("export async function updateThreadSnapshot"),
  ],
  [
    "thread snapshot ipc handlers are registered",
    main.includes("getThreadSnapshot,") &&
      main.includes('secureHandle("desktop:get-thread-snapshot"') &&
      main.includes('secureHandle("desktop:update-thread-snapshot"'),
  ],
  [
    "preload bridge exposes thread snapshot methods",
    preload.includes("getThreadSnapshot: (threadId: string)") &&
      preload.includes("updateThreadSnapshot: (snapshot: DesktopThreadSnapshot)"),
  ],
  [
    "main thread store preserves pinned archived unread values",
    threads.includes("pinned: request.pinned ?? existing?.pinned") &&
      threads.includes("archived: request.archived ?? existing?.archived") &&
      threads.includes("unread: request.unread ?? existing?.unread"),
  ],
  [
    "main thread list sorts pinned conversations first",
    threads.includes("function compareThreads") &&
      threads.includes("Boolean(left.pinned) !== Boolean(right.pinned)") &&
      threads.includes("return left.pinned ? -1 : 1"),
  ],
  [
    "renderer hides archived conversations from the default sidebar list but shows them in all sessions",
    app.includes('sessionScope === "all" ? true : !thread.archived'),
  ],
  [
    "renderer maps thread metadata into sidebar thread items",
    app.includes("pinned: thread.pinned") &&
      app.includes("archived: thread.archived") &&
      app.includes("unread: thread.unread") &&
      app.includes("workspacePath: thread.workspacePath"),
  ],
  [
    "selecting an unread conversation marks it read",
    app.includes("if (thread?.unread)") &&
      app.includes('handleThreadUpdate(threadId, { unread: false })'),
  ],
  [
    "selecting a conversation also restores its workspace context",
    app.includes("thread?.workspacePath") &&
      app.includes("setActiveWorkspaceId(nextWorkspace.id)") &&
      app.includes("getComparablePath(thread.workspacePath)"),
  ],
  [
    "selecting a conversation hydrates its persisted messages",
    app.includes("void hydrateThreadSnapshot(threadId)") &&
      app.includes("desktopApi.getThreadSnapshot(threadId)") &&
      app.includes("[threadId]: snapshot"),
  ],
  [
    "chat updates persist the conversation snapshot",
    app.includes("desktopApi.updateThreadSnapshot(snapshot)") &&
      app.includes("The local snapshot is still kept"),
  ],
  [
    "chat adapter refreshes displayed messages when the selected thread snapshot changes",
    chatAdapter.includes("setMessages(threadSnapshot?.messages?.length ? threadSnapshot.messages") &&
      chatAdapter.includes("[language, threadId, threadSnapshot]"),
  ],
  [
    "sidebar supports a right click context menu on conversations",
    shell.includes("onContextMenu={(event) => openThreadMenu(event, thread)}") &&
      shell.includes("thread-context-menu"),
  ],
  [
    "pin and unpin conversation action is wired",
    shell.includes("置顶对话") &&
      shell.includes("取消置顶对话") &&
      shell.includes("{ pinned: !threadMenu.thread.pinned }"),
  ],
  [
    "rename conversation action is wired",
    shell.includes("function renameThread") &&
      shell.includes("window.prompt") &&
      shell.includes("{ title: nextTitle.trim() }"),
  ],
  [
    "archive conversation action is wired",
    shell.includes("归档对话") &&
      shell.includes("取消归档对话") &&
      shell.includes("{ archived: !threadMenu.thread.archived }"),
  ],
  [
    "mark read and unread action is wired",
    shell.includes("标记为未读") &&
      shell.includes("标记为已读") &&
      shell.includes("{ unread: !threadMenu.thread.unread }"),
  ],
  [
    "share conversation action opens Doubao-style read-only share dialog",
    shell.includes("分享对话") &&
      shell.includes("function openShareDialog") &&
      shell.includes("thread-share-dialog") &&
      shell.includes("只能查看聊天记录") &&
      shell.includes("复制链接") &&
      shell.includes("打开预览") &&
      !shell.includes("打开文件位置") &&
      !shell.includes("参考豆包分享") &&
      !shell.includes("thread-share-banner") &&
      shell.includes("ChatMessageContent") &&
      shell.includes("getAssistantVisibleAnswer") &&
      shell.includes("复制成功") &&
      shell.includes("复制失败") &&
      shell.includes("showShareToast") &&
      shell.includes("createThreadShareClient") &&
      shell.includes("openThreadShareClient") &&
      shell.includes("copyThreadShareLinkClient"),
  ],
  [
    "shared api exposes thread share contract",
    sharedApi.includes("export interface CreateThreadShareRequest") &&
      sharedApi.includes("export interface DesktopThreadShareResult") &&
      sharedApi.includes("createThreadShare(request: CreateThreadShareRequest)") &&
      sharedApi.includes("openThreadShare(filePath: string)") &&
      sharedApi.includes("revealThreadShare(filePath: string)") &&
      sharedApi.includes("readOnly: true"),
  ],
  [
    "renderer share client falls back when preload bridge is stale",
    (() => {
      const client = read("src/renderer/src/threadShareClient.ts");
      return (
        client.includes("hasThreadShareBridge") &&
        client.includes("createThreadShareClient") &&
        client.includes('mode: "local"') &&
        client.includes("URL.createObjectURL")
      );
    })(),
  ],
  [
    "main process generates read-only share html without chat composer",
    (() => {
      const share = read("src/main/threadShare.ts");
      const html = read("../shared/api/threadShareHtml.ts");
      return (
        html.includes("只读分享") &&
        html.includes("无法发起新对话") &&
        html.includes("--app-accent: #8b5cf6") &&
        html.includes("brand-mark") &&
        share.includes("renderThreadShareHtml") &&
        share.includes("export async function createThreadShare") &&
        main.includes('secureHandle("desktop:create-thread-share"') &&
        main.includes('secureHandle("desktop:open-thread-share"') &&
        main.includes('secureHandle("desktop:reveal-thread-share"')
      );
    })(),
  ],
  [
    "preload and mock expose thread share methods",
    preload.includes("createThreadShare:") &&
      preload.includes("openThreadShare:") &&
      preload.includes("revealThreadShare:") &&
      mock.includes("createThreadShare:") &&
      mock.includes("openThreadShare:") &&
      mock.includes("revealThreadShare:") &&
      mock.includes("readOnly: true"),
  ],
  [
    "share dialog visual styles exist",
    css.includes(".thread-share-dialog") &&
      css.includes(".thread-share-banner") &&
      css.includes(".thread-share-messages") &&
      css.includes(".thread-share-primary"),
  ],
  [
    "open in file explorer action uses the existing open path callback",
    shell.includes("在资源管理器中打开") &&
      shell.includes("onOpenWorkspacePath(path)"),
  ],
  [
    "copy working directory action uses the clipboard",
    shell.includes("复制工作目录") &&
      shell.includes("copyText(getThreadWorkspacePath(threadMenu.thread))") &&
      shell.includes("getThreadWorkspacePath(threadMenu.thread)"),
  ],
  [
    "context menu visual styles and unread pinned markers exist",
    css.includes(".thread-context-menu") &&
      css.includes(".thread-unread-dot") &&
      css.includes(".thread-pinned-mark"),
  ],
  [
    "fork merge pending recovery actions are visible from the thread context menu",
    shell.includes("getForkRecoveryKind") &&
      shell.includes('lifecycleStatus !== "merge_pending"') &&
      shell.includes("Recovery needed") &&
      shell.includes("Open source workspace") &&
      shell.includes("Open fork worktree"),
  ],
  [
    "fork recovery checklist is copyable and preserves approval center boundaries",
    shell.includes("getForkRecoveryChecklist") &&
      shell.includes("Copy recovery checklist") &&
      shell.includes("Approval Center still gates the merge"),
  ],
  [
    "fork recovery exposes inline status detail and copyable diff commands",
    shell.includes("getForkRecoveryStatusItems") &&
      shell.includes("Fork recovery status detail") &&
      shell.includes("getForkRecoveryCommandSet") &&
      shell.includes("Copy conflict diff commands") &&
      shell.includes("git -C ${sourcePath} diff HEAD...${branch}"),
  ],
  [
    "fork recovery exposes an inline conflict workbench with per-file resolution planning",
    shell.includes("getForkConflictFiles") &&
    shell.includes("Inline conflict workbench") &&
      shell.includes("loadForkConflictContent") &&
      shell.includes("Load content merge editor") &&
      shell.includes("Merge base") &&
      shell.includes("True merge-base content preview") &&
      shell.includes("Source workspace") &&
      shell.includes("Fork branch") &&
      shell.includes("Manual resolved draft") &&
      shell.includes("stageForkConflictFile") &&
      shell.includes("Stage resolved file") &&
      shell.includes("writeForkConflictDraft") &&
      shell.includes("Write draft for approval") &&
      shell.includes("Use source version") &&
      shell.includes("Use fork version") &&
      shell.includes("parseForkConflictDraftHunks") &&
      shell.includes("Apply source side") &&
      shell.includes("Apply fork side") &&
      shell.includes("Keep both sides") &&
      shell.includes("Apply all source hunks") &&
      shell.includes("Semantic three-way merge preview") &&
      shell.includes("getForkConflictSemanticPreview") &&
      shell.includes("./forkConflictAnalysis") &&
      shell.includes("AST-aware structure diff") &&
      forkConflictAnalysis.includes("getForkConflictStructureSymbols") &&
      shell.includes("getForkConflictStructureDiff") &&
      forkConflictAnalysis.includes("Overlapping structural edits") &&
      forkConflictAnalysis.includes("Parser-backed scopes") &&
      forkConflictAnalysis.includes("FORK_CONFLICT_TEST_GRAPH") &&
      shell.includes("Hunk-level test suggestions") &&
      shell.includes("getForkConflictHunkTestSuggestions") &&
      shell.includes("getForkConflictRepoTestGraphSuggestions") &&
      shell.includes("Repo test graph matches") &&
      forkConflictAnalysis.includes("npm run verify:fork-worktree") &&
      shell.includes("Copy conflict resolution plan") &&
      shell.includes("getForkConflictResolutionPlan") &&
      shell.includes("resolve markers, preview diff, stage when reviewed") &&
      shell.includes("Approval Center still gates the merge"),
  ],
  [
    "fork recovery visual state is styled",
    css.includes(".thread-fork-recovery") &&
      css.includes(".thread-fork-recovery-status") &&
      css.includes("#fff8e8") &&
      css.includes("#f2c97a"),
  ],
  [
    "fork conflict workbench visual state is styled",
    css.includes(".thread-fork-conflict-workbench") &&
      css.includes(".thread-fork-conflict-preview") &&
      css.includes(".thread-fork-conflict-content-grid") &&
      css.includes(".thread-fork-conflict-draft") &&
      css.includes(".thread-fork-conflict-draft-controls") &&
      css.includes(".thread-fork-conflict-hunks") &&
      css.includes(".thread-fork-conflict-hunk-actions") &&
      css.includes(".thread-fork-conflict-semantic") &&
      css.includes(".thread-fork-conflict-structure") &&
      css.includes(".thread-fork-conflict-test-graph") &&
      css.includes(".thread-fork-conflict-hunk-tests") &&
      css.includes("#f7f9ff") &&
      css.includes("#b7c7f4"),
  ],
  [
    "fork conflict resolved draft write-back uses desktop api and approval center",
    sharedApi.includes("DesktopForkConflictDraftWriteRequest") &&
      sharedApi.includes("writeForkConflictDraft(") &&
      sharedApi.includes("WorkspaceGitFileAtRefRequest") &&
      sharedApi.includes("getWorkspaceGitFileAtRef(") &&
      app.includes("desktopApi.writeForkConflictDraft") &&
      app.includes("desktopApi.getWorkspaceGitFileAtRef") &&
      shell.includes("Manual draft write-back and staging both use the existing Approval Center workspace mutation path") &&
      mock.includes("writeForkConflictDraft") &&
      mock.includes("getWorkspaceGitFileAtRef") &&
      mock.includes("Write resolved conflict draft"),
  ],
  [
    "mock desktop api preserves thread metadata for renderer tests",
    mock.includes("pinned: request.pinned ?? existing?.pinned") &&
      mock.includes("archived: request.archived ?? existing?.archived") &&
      mock.includes("unread: request.unread ?? existing?.unread"),
  ],
  [
    "mock desktop api supports persisted thread snapshots",
    mock.includes("threadSnapshots: Record<string, DesktopThreadSnapshot>") &&
      mock.includes("getThreadSnapshot: async (threadId)") &&
      mock.includes("updateThreadSnapshot: async (snapshot)"),
  ],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("Thread context menu verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Thread context menu verification passed (${checks.length} checks).`);
