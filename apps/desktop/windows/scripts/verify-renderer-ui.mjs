import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const main = read("src/renderer/src/main.tsx");
const app = read("src/renderer/src/App.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const css = read("src/renderer/src/styles.css");
const agentRunWorkspace = read("src/renderer/src/components/AgentRunWorkspace.tsx");
const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
const navigation = read("src/renderer/src/navigation.ts");
const healthAdapter = read("src/renderer/src/adapters/useDesktopHealthAdapter.ts");
const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const packageJson = read("package.json");
const mojibakeVerifier = read("scripts/verify-no-mojibake.mjs");
const desktopApi = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const desktopMain = read("src/main/index.ts");
const threadsMain = read("src/main/threads.ts");
const filesContextPanel = read("src/renderer/src/components/files/FilesContextPanel.tsx");

function navItemEnabled(source, menuId) {
  const pattern = new RegExp(`id: MENU_IDS\\.${menuId}, enabled: (true|false)`);
  return pattern.exec(source)?.[1] === "true";
}

const checks = [
  ["renderer installs mock desktop API before React render", main.includes("installMockDesktopApi();")],
  ["renderer only installs mock desktop API in dev", main.includes("import.meta.env.DEV") && main.includes("BridgeUnavailable") && main.includes("hasDesktopApi()")],
  ["mock never overrides Electron preload API", mock.includes("if (window.openDrSai) return;")],
  ["mock covers install progress state", mock.includes("onInstallProgress") && mock.includes("Mock installation complete")],
  ["mock exposes install log path", mock.includes("logFile") && app.includes("日志文件") && app.includes("Log file")],
  ["renderer can cancel a running install", mock.includes("cancelInstall") && app.includes("取消安装") && app.includes("Cancel Install")],
  ["renderer can open install log through desktop API", mock.includes("openPath") && app.includes("打开日志") && app.includes("Open Log")],
  ["mock covers chat stream state", mock.includes("startChat") && mock.includes('type: "chunk"') && mock.includes('type: "done"')],
  ["renderer exposes agent run workspace", app.includes("AgentRunWorkspace") && app.includes("MENU_IDS.agentSquare") && agentRunWorkspace.includes("desktopApi.startAgentRun") && agentRunWorkspace.includes("desktopApi.onAgentRunEvent") && agentRunWorkspace.includes("desktopApi.abortAgentRun") && css.includes(".agent-run-workspace")],
  ["renderer exposes a direct agent task path", shell.includes("onNewAgentTask") && shell.includes("Agent task") && app.includes('kind: "agent_run"') && app.includes('activeThread?.kind === "agent_run"')],
  ["agent file events reveal change review", app.includes('setActiveRightTab("files")') && app.includes("setRightPanelCollapsed(false)") && app.includes("onAgentFileEvent")],
  ["agent change sets expose explicit accept and reject actions", filesContextPanel.includes("acceptWorkspaceCheckpoint") && filesContextPanel.includes("接受本次变更") && filesContextPanel.includes("拒绝并恢复运行前") && preload.includes("desktop:workspace-checkpoint-accept")],
  ["agent tasks fail closed on incomplete rollback baselines", agentRunWorkspace.includes("checkpoint.truncated") && agentRunWorkspace.includes("checkpoint.skippedFileCount") && agentRunWorkspace.includes("Agent 任务未启动")],
  ["chat workspace renders markdown safely through props", chatWorkspace.includes("ReactMarkdown") && chatWorkspace.includes("remarkGfm") && chatWorkspace.includes("onOpenExternal")],
  ["chat workspace renders structured tool timeline events", chatWorkspace.includes("ChatToolTimelineEvent") && chatWorkspace.includes("ToolTimeline") && chatWorkspace.includes("message-tool-timeline") && chatAdapter.includes('event.type === "tool_timeline"') && chatAdapter.includes("appendAssistantToolTimeline") && css.includes(".message-tool-event")],
  ["chat workspace uses readable Chinese labels", chatWorkspace.includes("发送") && chatWorkspace.includes("停止") && chatWorkspace.includes("正在连接本地网关")],
  ["mock covers update check state", mock.includes("checkForUpdates") && !mock.includes("downloadUpdate") && !mock.includes("installUpdate")],
  ["mock covers settings save state", mock.includes("saveApiKey") && mock.includes("Mock API key saved")],
  ["renderer settings omit API key and model configuration", app.includes("SettingsPanel") && !app.includes("保存 API Key") && !app.includes("Save API Key") && !app.includes('id="api-key-input"')],
  ["renderer surfaces action feedback", app.includes("actionMessage") && healthAdapter.includes("网关启动失败") && healthAdapter.includes("Gateway failed to start") && healthAdapter.includes("更新检查失败") && healthAdapter.includes("Update check failed")],
  ["renderer owns chat request id before starting IPC", chatAdapter.includes("const requestId = crypto.randomUUID()") && chatAdapter.includes("setActiveRequestId(requestId)") && chatAdapter.includes("requestId,")],
  ["renderer shows prerequisite command paths", app.includes("Python 路径") && app.includes("Python path") && app.includes("Git 路径") && app.includes("Git path")],
  ["renderer shows backend repair state", app.includes("后端目标版本") && app.includes("Backend target") && app.includes("需要修复") && app.includes("Repair required")],
  ["about dialog only exposes update check maintenance action", app.includes("检查更新") && app.includes("Check Updates") && !app.includes("Download Update") && !app.includes("Install Update") && !app.includes("Install / Repair") && !app.includes("Recover Gateway")],
  ["renderer wraps long chat content", css.includes("overflow-wrap: anywhere")],
  ["renderer styles markdown tables and code blocks", css.includes(".message-body table") && css.includes(".message-body pre")],
  ["about dialog disables update check while busy", app.includes("<button disabled={busy} onClick={onCheckUpdates}>")],
  ["renderer has shared navigation model", navigation.includes("current_session") && navigation.includes("agent_square") && navigation.includes("skills_square") && navigation.includes("getNavSections") && navigation.includes("getRightTabs") && app.includes('from "./navigation"') && shell.includes("navSections.filter")],
  ["renderer enables current desktop views", navItemEnabled(navigation, "currentSession") && navItemEnabled(navigation, "approvalCenter") && navItemEnabled(navigation, "channels") && navItemEnabled(navigation, "profile") && !navItemEnabled(navigation, "agentSquare") && !navItemEnabled(navigation, "skillsSquare") && !navItemEnabled(navigation, "plugins") && !navItemEnabled(navigation, "library")],
  ["renderer exposes current right-panel tabs", navigation.includes('["files", "browser", "terminal", "debug"] as RightTab[]')],
  ["renderer has separated workspace shell", app.includes("WorkspaceShell") && shell.includes("WorkspaceShellProps") && shell.includes("mainContent: React.ReactNode") && shell.includes("rightPanel: React.ReactNode") && !shell.includes('../desktopApi') && !shell.includes('./desktopApi')],
  ["chat composer orders agent model and thinking controls", chatWorkspace.includes("Agent: {activeAgentName}") && chatWorkspace.includes("模型：") && chatWorkspace.includes("推理：") && chatWorkspace.includes('useState<ThinkingEffort>("medium")') && chatAdapter.includes("thinking_effort")],
  ["renderer can collapse right panel", app.includes("rightPanelCollapsed") && shell.includes("titlebar-right-panel-toggle") && css.includes(".content-grid.right-collapsed")],
  ["titlebar owns centered chat and command search", shell.includes('className="titlebar-center"') && shell.includes('className="titlebar-search-shell"') && shell.includes('id="titlebar-search-results"') && css.includes(".titlebar-search-results")],
  ["sidebar search focuses shared titlebar search", shell.includes('onClick={openCommandPalette}') && shell.includes("commandPaletteInputRef.current?.focus()")],
  ["titlebar search preserves keyboard navigation and commands", shell.includes('event.key === "ArrowDown"') && shell.includes('event.key === "ArrowUp"') && shell.includes('event.key === "Enter"') && shell.includes('event.key.toLowerCase() === "k"') && shell.includes('shortcut: "Ctrl+N"')],
  ["legacy centered search overlay is removed", !shell.includes("command-palette-overlay") && !shell.includes("command-palette-input-row")],
  ["thread content search is exposed end to end", desktopApi.includes("searchThreadMessages") && preload.includes("desktop:search-thread-messages") && desktopMain.includes("desktop:search-thread-messages") && threadsMain.includes("searchThreadMessages")],
  ["thread content search excludes internal system messages", threadsMain.includes('message.role === "system"')],
  ["titlebar search queries all scoped thread content", app.includes("searchableThreads={searchableThreads}") && app.includes("desktopApi.searchThreadMessages") && shell.includes("onSearchThreadMessages(query, searchableThreadIds)")],
  ["content search renders snippets and highlights", shell.includes("command-palette-description") && shell.includes("highlightSearchText") && css.includes(".command-palette-description") && css.includes("mark")],
  ["renderer has responsive layout CSS", css.includes("@media (max-width: 1180px)") && css.includes("@media (max-width: 860px)")],
  ["renderer startup health is side-effect free", !healthAdapter.includes("autoInstallStarted") && !healthAdapter.includes("autoGatewayStarted") && healthAdapter.includes("window.setTimeout")],
  ["renderer has accessible icon navigation", shell.includes("aria-label={label}") && shell.includes("title={label}")],
  ["chat composer uses multiline textarea", chatWorkspace.includes("textarea") && chatWorkspace.includes("handleKeyDown") && chatWorkspace.includes("event.shiftKey")],
  ["mojibake verifier is wired into package scripts", packageJson.includes('"verify:mojibake": "node scripts/verify-no-mojibake.mjs"') && mojibakeVerifier.includes("mojibakePatterns")],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("Renderer UI verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Renderer UI verification passed (${checks.length} checks).`);
