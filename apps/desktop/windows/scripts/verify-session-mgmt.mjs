/**
 * Session management (会话管理) feature audit.
 * Covers: top search, new task, session list, rename, archive, delete, in-session search.
 *
 * Run: node apps/desktop/windows/scripts/verify-session-mgmt.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const windowsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(windowsRoot, "../shared");

function read(...parts) {
  return readFileSync(join(...parts), "utf8");
}

const findings = [];
function bug(id, feature, severity, title, evidence, note = "") {
  findings.push({ kind: "bug", id, feature, severity, title, evidence, note });
}
function ok(id, feature, title, evidence) {
  findings.push({ kind: "ok", id, feature, severity: "info", title, evidence, note: "" });
}
function fixed(id, feature, title, evidence) {
  findings.push({ kind: "fixed", id, feature, severity: "info", title, evidence, note: "" });
}

const shell = read(shared, "renderer/src/components/WorkspaceShell.tsx");
const app = read(shared, "renderer/src/App.tsx");
const chat = read(shared, "renderer/src/components/ChatWorkspace.tsx");
const threads = read(shared, "main/threads.ts");
const archive = read(windowsRoot, "src/main/threadArchive.ts");
const index = read(windowsRoot, "src/main/index.ts");
const remote = read(windowsRoot, "src/main/remoteWorkspace.ts");

// 1. Top search / command palette
{
  const hasPalette =
    shell.includes("commandPaletteOpen") &&
    shell.includes("onSearchThreadMessages") &&
    shell.includes('aria-label={zh ? "搜索聊天或运行命令"');
  if (hasPalette) {
    ok("SM-SEARCH-OK", "顶部搜索", "命令面板入口与内容搜索接线存在", "WorkspaceShell titlebar-search + onSearchThreadMessages");
  }

  // Mixed remote+local: empty/partial remote array short-circuits local search
  const shortCircuit =
    /searchRemoteThreadMessages\(request\)\)\s*\|\|\s*searchThreadMessages\(request\)/.test(index);
  const remoteOnlyIds =
    remote.includes("remoteThreadWorkspaces.has(id)") &&
    /if \(ids\.length === 0\) return null/.test(remote);
  if (shortCircuit && remoteOnlyIds) {
    bug(
      "SM-SEARCH-01",
      "顶部搜索",
      "P1",
      "远程会话参与搜索时本地会话内容被跳过",
      "index.ts: (await searchRemoteThreadMessages(...)) || searchThreadMessages(...); remote 返回 [] 亦为真值，本地不会被搜",
      "混有 remoteThreadWorkspaces 中的 threadId 时，仅搜远程；无命中时本地命中也丢失",
    );
  }

  const contentHitNoMessageNav =
    /contentSearchResults\.map\(\(result\) => \[`thread:\$\{result\.threadId\}`/.test(shell) &&
    /run:\s*\(\)\s*=>\s*onThreadSelect\(thread\.id\)/.test(shell) &&
    !/onThreadSelect\(thread\.id,\s*.*messageId/.test(shell) &&
    !/scrollToMessage|focusMessage|messageId/.test(
      shell.slice(shell.indexOf("contentMatchByThread"), shell.indexOf("contentMatchByThread") + 800),
    );
  if (contentHitNoMessageNav) {
    bug(
      "SM-SEARCH-02",
      "顶部搜索",
      "P2",
      "内容命中只跳到会话，不定位到对应消息",
      "WorkspaceShell 内容搜索结果含 messageId，但 run() 仅 onThreadSelect(thread.id)",
    );
  }
}

// 2. New task
{
  const hasNew =
    shell.includes("onNewChat") &&
    (app.includes("async function handleNewChat") || app.includes("function handleNewChat"));
  if (hasNew) {
    ok("SM-NEW-OK", "新建任务", "侧栏/菜单新建任务入口存在", "onNewChat → handleNewChat");
  }
}

// 3. Session list
{
  const grouped =
    shell.includes("workspaceThreadsById") || shell.includes("workspaceThreads");
  const relativeTime = app.includes("formatThreadTime") || app.includes("timeLabel");
  if (grouped && relativeTime) {
    ok("SM-LIST-OK", "会话列表", "按工作区分组与相对时间展示存在", "workspaceThreads + formatThreadTime/timeLabel");
  }
}

// 4. Rename — historical crash
{
  const usesPrompt = /window\.prompt\(/.test(shell);
  const usesDialog =
    shell.includes("setRenameDialog") &&
    shell.includes("thread-rename-dialog") &&
    shell.includes("submitRenameDialog");
  if (!usesPrompt && usesDialog) {
    fixed(
      "SM-RENAME-FIXED",
      "重命名会话",
      "历史必崩 prompt() 已修复为应用内对话框",
      "WorkspaceShell setRenameDialog / thread-rename-dialog；无 window.prompt",
    );
  } else if (usesPrompt) {
    bug(
      "SM-RENAME-01",
      "重命名会话",
      "P0",
      "重命名仍调用 window.prompt 导致崩溃",
      "WorkspaceShell 仍含 window.prompt",
    );
  }

  if (usesDialog && /void onThreadUpdate\(threadId,\s*\{\s*title:\s*nextTitle\s*\}\)/.test(shell)) {
    bug(
      "SM-RENAME-02",
      "重命名会话",
      "P2",
      "重命名失败无用户提示",
      "submitRenameDialog 使用 void onThreadUpdate(...) 无 catch/alert",
      "右键菜单其他动作走 runThreadMenuAction 会 alert，重命名对话框路径静默失败",
    );
  }
}

// 5. Archive — historical Run not found
{
  const softMiss =
    archive.includes("isMissingRuntimeBindingError") &&
    /run not found/i.test(archive) &&
    /isMissingRuntimeBindingError\(error\)/.test(archive);
  if (softMiss) {
    fixed(
      "SM-ARCHIVE-FIXED",
      "归档会话",
      "历史 Run not found 已软处理，归档可成功",
      "threadArchive.ts isMissingRuntimeBindingError + soft return；verify-thread-archive 7 checks",
    );
  } else {
    bug(
      "SM-ARCHIVE-01",
      "归档会话",
      "P0",
      "归档仍将缺失 Runtime run 当作失败",
      "threadArchive.ts 缺少 isMissingRuntimeBindingError 软处理",
    );
  }
}

// 6. Delete
{
  const hasDelete =
    app.includes("handleDeleteThread") &&
    threads.includes("export async function deleteThread") &&
    (shell.includes("deleteConfirmThread") || shell.includes("delete-thread:") || shell.includes("requestAppDecision"));
  if (hasDelete) {
    ok("SM-DEL-OK", "删除会话", "删除确认对话框与 IPC 存在", "requestAppDecision/deleteConfirm + desktopApi.deleteThread");
  }
  if (hasDelete && !(shell.includes("deleteDesktopThread") && shell.includes('from "../deleteDesktopThread"'))) {
    bug(
      "SM-DEL-04",
      "删除会话",
      "P1",
      "删除落盘仍依赖可能未热更新的 App.tsx handleDeleteThread",
      "WorkspaceShell 未直接调用 deleteDesktopThread",
      "App.tsx 超过 Babel 500KB 限制时 HMR 会保留陈旧 handler，确认后 800ms 内弹出 thread-menu-action-failed",
    );
  }

  const deleteFnStart = app.indexOf("async function handleDeleteThread");
  const deleteFn = app.slice(deleteFnStart, deleteFnStart + 2800);
  const abortsOnDelete =
    /chat\.abort|abortAgentRun|abortChat|cancelChatTurn/.test(deleteFn);
  if (hasDelete && !abortsOnDelete) {
    bug(
      "SM-DEL-01",
      "删除会话",
      "P1",
      "删除进行中的会话不中止后端运行",
      "App.tsx handleDeleteThread 仅 deleteThread + 切新会话，无 chat.abort()/abortAgentRun",
      "对比：退出登录路径会 await chat.abort()",
    );
  }

  if (hasDelete && !(
    app.includes("deletedThreadIdsRef")
    && deleteFn.includes("deletedThreadIdsRef.current.add(threadId)")
    && app.includes("if (deletedThreadIdsRef.current.has(snapshot.threadId)) return;")
    && threads.includes("deletedThreadIds")
    && threads.includes("thread_deleted")
    && threads.includes("deleted-threads.json")
    && /serializeJsonMutation\(THREADS_FILE, async \(\) => \{[\s\S]*?deletedThreadIds\.has\(request\.id\)/.test(threads)
    && (
      /await (?:desktopApi|window\.openDrSai)\.deleteThread\(threadId\)/.test(deleteFn)
      || shell.includes("await deleteDesktopThread(thread.id)")
    )
    && /chat\.abort|abortAgentRun|abortChat/.test(deleteFn)
  )) {
    bug(
      "SM-DEL-03",
      "删除会话",
      "P1",
      "删除后异步 upsert 会把会话写回侧边栏",
      "handleDeleteThread 未抑制已删除 threadId 的 updateThread/catalog 回写",
      "删除后应标记 deletedThreadIdsRef，主进程 durable tombstone(deleted-threads.json) 在锁内拒绝 thread_deleted upsert，且 deleteThread 须先于 abort",
    );
  }

  const clearsSnapshots =
    /handleDeleteThread[\s\S]{0,1600}setThreadSnapshots/.test(app)
    || deleteFn.includes("setThreadSnapshots")
    || deleteFn.includes("threadSnapshotStore.delete");
  if (hasDelete && !clearsSnapshots) {
    bug(
      "SM-DEL-02",
      "删除会话",
      "P2",
      "删除后渲染层 threadSnapshots 未清理",
      "handleDeleteThread 未 setThreadSnapshots 删除对应 key；主进程磁盘快照已删",
      "孤儿快照可能残留 localStorage / 导出路径",
    );
  }
}

// 7. In-session message search
{
  const hasSearch =
    chat.includes("searchQuery") &&
    chat.includes("searchMatches") &&
    threads.includes("export async function searchThreadMessages");
  if (hasSearch) {
    ok("SM-INSEARCH-OK", "会话内消息搜索", "searchThreadMessages 与 ChatWorkspace 搜索 UI 存在", "ChatWorkspace searchOpen + threads.searchThreadMessages");
  }

  if (chat.includes("鍏抽棴鎼滅储")) {
    bug(
      "SM-INSEARCH-01",
      "会话内消息搜索",
      "P2",
      "关闭搜索按钮中文无障碍文案乱码",
      "ChatWorkspace.tsx aria-label/title「鍏抽棴鎼滅储」应为「关闭搜索」",
    );
  }

  const structuredSkip =
    /getVisibleChatText\(message\.content\)/.test(chat) &&
    chat.includes("message.structuredTurn") &&
    !/searchMatches[\s\S]{0,400}structuredTurn/.test(chat);
  if (structuredSkip) {
    bug(
      "SM-INSEARCH-02",
      "会话内消息搜索",
      "P2",
      "结构化助手回复无法被会话内搜索命中",
      "searchMatches 只扫 message.content，structuredTurn 渲染路径未纳入检索",
    );
  }
}

// Run behavioral archive verify when possible
{
  const archiveVerify = spawnSync(
    process.execPath,
    [join(windowsRoot, "../shared/test-kit/run-bundled-test.mjs"), "scripts/verify-thread-archive.mts"],
    { cwd: windowsRoot, encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  if (archiveVerify.status === 0) {
    ok("SM-ARCHIVE-RUNTIME", "归档会话", "行为验收通过", (archiveVerify.stdout || "").trim().split("\n").at(-1) || "verify-thread-archive passed");
  } else {
    bug(
      "SM-ARCHIVE-RUNTIME-FAIL",
      "归档会话",
      "P1",
      "verify-thread-archive 行为验收失败",
      (archiveVerify.stderr || archiveVerify.stdout || "exit " + archiveVerify.status).slice(0, 400),
    );
  }
}

const bugs = findings.filter((f) => f.kind === "bug");
const oks = findings.filter((f) => f.kind === "ok");
const fixedItems = findings.filter((f) => f.kind === "fixed");

console.log("=== OpenDrSai 会话管理功能测试报告 ===\n");
console.log(`通过: ${oks.length}`);
for (const item of oks) console.log(`  PASS  [${item.feature}] ${item.title}`);
console.log(`\n已修复(历史缺陷): ${fixedItems.length}`);
for (const item of fixedItems) {
  console.log(`  FIXED [${item.feature}] ${item.title}`);
  console.log(`        ${item.evidence}`);
}
console.log(`\n缺陷: ${bugs.length}`);
for (const item of bugs) {
  console.log(`  ${item.severity} ${item.id} [${item.feature}] ${item.title}`);
  console.log(`        证据: ${item.evidence}`);
  if (item.note) console.log(`        说明: ${item.note}`);
}

if (bugs.length) {
  console.log(`\n结果: FAIL (${bugs.length} open bugs; ${fixedItems.length} historical fixed)`);
  process.exit(1);
}
console.log("\n结果: PASS");
