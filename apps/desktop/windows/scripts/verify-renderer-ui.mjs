import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const main = read("../shared/renderer/src/main.tsx");
const app = read("../shared/renderer/src/App.tsx");
const loginScreen = read("../shared/renderer/src/auth/LoginScreen.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const css = read("../shared/renderer/src/styles.css");
const agentRunWorkspace = read("../shared/renderer/src/components/AgentRunWorkspace.tsx");
const chatWorkspace = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const chatMessageContent = read("../shared/renderer/src/components/ChatMessageContent.tsx");
const structuredMessageParts = read("../shared/renderer/src/components/StructuredMessageParts.tsx");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const navigation = read("../shared/renderer/src/navigation.ts");
const healthAdapter = read("../shared/renderer/src/adapters/useDesktopHealthAdapter.ts");
const chatAdapter = read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const packageJson = read("package.json");
const mojibakeVerifier = read("scripts/verify-no-mojibake.mjs");
const desktopApi = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const desktopMain = read("src/main/index.ts");
const threadsMain = read("../shared/main/threads.ts");
const workspacesMain = read("../shared/main/workspaces.ts");
const statusMain = read("src/main/status.ts");
const filesContextPanel = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const skillSquare = read("../shared/renderer/src/components/SkillSquareView.tsx");

function navItemEnabled(source, menuId) {
  const pattern = new RegExp(`id: MENU_IDS\\.${menuId}, enabled: (true|false)`);
  return pattern.exec(source)?.[1] === "true";
}

const checks = [
  ["session restoration mounts the main workspace before loading threads", app.includes("if (auth.loading)") && app.includes("<AuthenticatedApp") && app.includes("sessionRestoring") && app.includes("void refreshThreads()") && app.includes("!sessionRestoring &&") && !app.includes("<AuthSplash") && !loginScreen.includes("正在恢复会话") && !loginScreen.includes("Restoring session")],
  ["renderer installs mock desktop API before React render", main.includes("installMockDesktopApi();")],
  ["renderer only installs mock desktop API in dev", main.includes("import.meta.env.DEV") && main.includes("BridgeUnavailable") && main.includes("hasDesktopApi()")],
  ["mock never overrides Electron preload API", mock.includes("if (window.openDrSai) return;")],
  ["mock covers install progress state", mock.includes("onInstallProgress") && mock.includes("Mock installation complete")],
  ["mock exposes install log path", mock.includes("logFile") && app.includes("日志文件") && app.includes("Log file")],
  ["renderer can cancel a running install", mock.includes("cancelInstall") && app.includes("取消安装") && app.includes("Cancel Install")],
  ["renderer can open install log through desktop API", mock.includes("openPath") && app.includes("打开日志") && app.includes("Open Log")],
  ["mock covers chat stream state", mock.includes("startChat") && mock.includes('type: "chunk"') && mock.includes('type: "done"')],
  ["renderer exposes agent run workspace", app.includes("AgentRunWorkspace") && app.includes("MENU_IDS.agentSquare") && agentRunWorkspace.includes("desktopApi.startAgentRun") && agentRunWorkspace.includes("desktopApi.onAgentRunEvent") && agentRunWorkspace.includes("desktopApi.abortAgentRun") && css.includes(".agent-run-workspace")],
  ["renderer exposes Agent tasks from settings without a duplicate primary-sidebar action", app.includes('id: "agent-task"') && app.includes("onNewAgentTask") && !shell.includes("onNewAgentTask") && app.includes('kind: "agent_run"') && app.includes('activeThread?.kind === "agent_run"')],
  ["agent file events reveal change review", app.includes('setActiveRightTab("files")') && app.includes("setRightPanelCollapsed(false)") && app.includes("onAgentFileEvent")],
  ["agent change sets expose explicit accept and reject actions", filesContextPanel.includes("acceptWorkspaceCheckpoint") && filesContextPanel.includes("接受本次变更") && filesContextPanel.includes("拒绝并恢复运行前") && preload.includes("desktop:workspace-checkpoint-accept")],
  ["agent tasks fail closed on incomplete rollback baselines", agentRunWorkspace.includes("checkpoint.truncated") && agentRunWorkspace.includes("checkpoint.skippedFileCount") && agentRunWorkspace.includes("智能体任务未启动")],
  ["chat workspace renders markdown safely through props", chatWorkspace.includes("ChatMessageContent") && chatWorkspace.includes("onOpenExternal") && chatMessageContent.includes("ReactMarkdown") && chatMessageContent.includes("remarkGfm")],
  ["chat messages expose a top-right quick copy button", chatWorkspace.includes('data-testid="chat-message-copy"') && chatWorkspace.includes("copyMessageText(message.id, messageCopyText)") && chatWorkspace.includes("getMessageCopyText(message, assistantContent)") && chatWorkspace.includes("<Copy size={14}") && chatWorkspace.includes("<Check size={14}") && css.includes(".message-copy-button") && css.includes("position: absolute") && css.includes("top: 8px") && css.includes("right: 8px")],
  ["new chat composes brand workspace agent examples and composer", app.includes("workspaceName={effectiveWorkspace.name}") && chatWorkspace.includes('className="empty-chat-logo"') && chatWorkspace.includes("activeWorkspaceName") && chatWorkspace.includes("activeAgentName") && chatWorkspace.includes("getAgentEmptyChatPrompts") && chatWorkspace.includes('className={`sample-prompt-card') && css.includes("grid-template-columns: repeat(4, minmax(0, 1fr))")],
  ["new chat switches workspace and agent from searchable intro menus", app.includes("handleEmptyChatWorkspaceSelect") && app.includes("workspaceOptions={sortedWorkspaces}") && chatWorkspace.includes('introMenuOpen') && chatWorkspace.includes('placeholder={zh ? "搜索工作区"') && chatWorkspace.includes('placeholder={zh ? "搜索智能体"') && css.includes(".empty-chat-selector-menu")],
  ["composer model picker remains actionable and explains an empty catalog", !chatWorkspace.includes('disabled={!hasModelOptions}') && chatWorkspace.includes('No models available') && css.includes(".composer-meta-menu-empty")],
  ["agent picker status metadata is localized without mojibake", chatWorkspace.includes('return `${source} · ${status}`') && chatWorkspace.includes('zh ? "运行中" : "Running"') && !chatWorkspace.includes('`${source} 路 ${status}`')],
  ["chat workspace summarizes structured tool activity while retaining Debug detail", chatWorkspace.includes("message.structuredTurn.activities.length") && structuredMessageParts.includes("StructuredActivityTimeline") && structuredMessageParts.includes("data-activity-count") && structuredMessageParts.includes("在调试中查看详情") && !structuredMessageParts.includes("turn.activities.map(") && chatAdapter.includes('event.type === "tool_timeline"') && chatAdapter.includes("appendAssistantToolTimeline") && chatAdapter.includes("formatToolTimelineDebugLog") && css.includes(".structured-activity-compact")],
  ["restored threads consolidate assistant tool records from the same run", chatAdapter.includes("consolidateHydratedAssistantRuns(hydrated)") && chatAdapter.includes("readPersistedRunId") && chatAdapter.includes("mergeHydratedAssistantMessages")],
  ["chat workspace uses readable Chinese labels", chatWorkspace.includes("发送") && chatWorkspace.includes("停止") && chatWorkspace.includes("正在连接本地运行时")],
  ["mock covers complete runtime update state", mock.includes("checkForUpdates") && mock.includes("downloadUpdate") && mock.includes("installUpdate") && mock.includes("cancelUpdate")],
  ["main fallback update status keeps complete runtime update shape", statusMain.includes("fallbackUpdateStatus") && ["phase", "currentVersion", "mandatory", "releaseNotesUrl", "canDownload", "canInstall", "canCancel", "errorCode", "recovery"].every((field) => statusMain.includes(`${field}:`))],
  ["mock covers settings save state", mock.includes("saveApiKey") && mock.includes("Mock API key saved")],
  ["renderer settings omit API key and model configuration", app.includes("SettingsPanel") && !app.includes("保存 API Key") && !app.includes("Save API Key") && !app.includes('id="api-key-input"')],
  ["renderer surfaces action feedback", app.includes("actionMessage") && healthAdapter.includes("网关启动失败") && healthAdapter.includes("Gateway failed to start") && healthAdapter.includes("更新检查失败") && healthAdapter.includes("Update check failed")],
  ["renderer owns chat request id before starting IPC", chatAdapter.includes("const requestId = crypto.randomUUID()") && chatAdapter.includes("setActiveRequestId(requestId)") && chatAdapter.includes("requestId,")],
  ["renderer shows prerequisite command paths", app.includes("Python 路径") && app.includes("Python path") && app.includes("Git 路径") && app.includes("Git path")],
  ["renderer shows backend repair state", app.includes("后端目标版本") && app.includes("Backend target") && app.includes("需要修复") && app.includes("Repair required")],
  ["about dialog exposes runtime update actions", app.includes("检查更新") && app.includes("Check Updates") && app.includes("Restart and Update") && app.includes("Cancel Download") && !app.includes("Install / Repair") && !app.includes("Recover Gateway")],
  ["renderer wraps long chat content", css.includes("overflow-wrap: anywhere")],
  ["renderer styles markdown tables and code blocks", css.includes(".message-body table") && css.includes(".message-body pre")],
  ["about dialog disables update check while busy", app.includes("<button disabled={busy} onClick={onCheckUpdates}>")],
  ["renderer has shared navigation model", navigation.includes("current_session") && navigation.includes("agent_square") && navigation.includes("skills_square") && navigation.includes("getNavSections") && navigation.includes("getRightTabs") && app.includes('from "./navigation"') && shell.includes("navSections.filter")],
  ["renderer keeps primary sidebar focused on chat and square", navItemEnabled(navigation, "currentSession") && navItemEnabled(navigation, "agentSquare") && navItemEnabled(navigation, "skillsSquare") && !shell.includes("settingsItems.map") && !shell.includes('id: "command:settings"') && shell.includes("onNavChange(MENU_IDS.profile)") && !navItemEnabled(navigation, "approvalCenter") && !navItemEnabled(navigation, "usageAnalytics") && !navItemEnabled(navigation, "channels") && !navItemEnabled(navigation, "plugins") && !navItemEnabled(navigation, "library")],
  ["new task action stays visible and gains a divider while the sidebar scrolls", shell.includes('className="sidebar-primary-action"') && shell.includes('sidebarScrolled ? "is-scrolled" : ""') && shell.includes("event.currentTarget.scrollTop > 0") && css.includes(".sidebar-primary-action") && css.includes("position: sticky") && css.includes("top: 0") && css.includes("margin-bottom: -6px") && css.includes("border-bottom: 1px solid transparent") && css.includes(".sidebar-scroll.is-scrolled .sidebar-primary-action") && css.includes("padding-bottom: 4px")],
  ["new task stays local until the first message is published", app.includes("async function handleNewChat()") && app.includes("setActiveThreadId(createLocalThreadId())") && !app.match(/async function handleNewChat\(\)[\s\S]{0,500}desktopApi\.createThread/) && app.includes("threads.some((thread) => thread.id === activeThreadId)") && app.includes("existingThread?.boundAgentId ?? selectedChatAgentId")],
  ["primary sidebar restores the collapsible square group", navigation.includes('id: "agents"') && shell.includes('getEnabledNavItems(navSections, "agents")') && shell.includes("agentsOpen")],
  ["workspace names use regular text weight", shell.includes('className="workspace-item-name"') && !shell.includes("<strong>{workspace.name}</strong>") && css.includes(".workspace-item-name") && css.includes("font-weight: 400")],
  ["workspace tree nests recent tasks under each workspace", app.includes("workspaceThreads={workspaceThreads}") && shell.includes("workspaceThreadsById") && shell.includes("expandedWorkspaceIds") && shell.includes("workspace-thread-list") && shell.includes("threadsForWorkspace.slice(0, 5)") && shell.includes("显示全部") && !shell.includes("workspace-session-header") && css.includes(".workspace-tree-node")],
  ["workspace rows expand independently and reveal actions on interaction", !shell.includes('className="workspace-node-toggle"') && shell.includes("aria-expanded={expanded}") && shell.includes("expandedWorkspaceIds.has(workspace.id)") && shell.includes("const next = new Set(current)") && shell.includes("next.delete(workspace.id)") && shell.includes("next.add(workspace.id)") && css.includes("grid-template-columns: minmax(0, 1fr) auto auto") && css.includes(".workspace-row:hover .workspace-new-session-button") && css.includes(".workspace-row:focus-within .workspace-details-button")],
  ["workspace rename persists with visible save feedback", shell.includes("workspaceSavePending") && shell.includes("workspaceSaveError") && shell.includes("Workspace name cannot be empty") && shell.includes("closeWorkspaceDetails();") && css.includes(".workspace-details-error") && workspacesMain.includes("Persist the desktop name even while Runtime is unavailable") && workspacesMain.includes("workspaceUpdateQueue.then(() => performWorkspaceUpdate(request))") && !/listWorkspaces\(\)[\s\S]*?writeWorkspaces\(refreshed\)/.test(workspacesMain) && workspacesMain.includes("await writeWorkspaces([next")],
  ["square and workspace group titles use muted emphasized text", shell.includes('className="workspace-section-title sidebar-group-title"') && css.includes(".sidebar-group-title") && css.includes("color: var(--app-group-title)") && css.includes("font-weight: 650")],
  ["settings groups agent and integration tools", app.includes('type SettingsPane = "general"') && app.includes('id: "agent-task"') && app.includes('id: "approvals"') && app.includes('id: "analytics"') && app.includes('id: "channels"') && css.includes(".settings-navigation")],
  ["settings exposes real general and Agent preferences", app.includes("SESSION_SCOPE_STORAGE_KEY") && app.includes("DEFAULT_AGENT_STORAGE_KEY") && app.includes("DEFAULT_MODEL_STORAGE_KEY") && app.includes("THINKING_EFFORT_STORAGE_KEY") && app.includes('id: "agent-defaults"') && app.includes("onSessionScopeChange")],
  ["settings controls appearance and sidebar components", app.includes("APPEARANCE_STORAGE_KEY") && app.includes("SIDEBAR_COMPONENTS_STORAGE_KEY") && app.includes('window.matchMedia("(prefers-color-scheme: dark)")') && app.includes("onAppearanceChange") && app.includes("onSidebarComponentsChange") && app.includes("skills: false") && shell.includes("sidebarComponents.square") && shell.includes("sidebarComponents.agents") && shell.includes("sidebarComponents.skills") && css.includes(':root[data-theme="dark"]') && css.includes(".appearance-segment")],
  ["settings controls right sidebar components with debug hidden by default", app.includes("RIGHT_SIDEBAR_COMPONENTS_STORAGE_KEY") && app.includes("onRightSidebarComponentsChange") && app.includes("rightSidebarComponents[id]") && app.includes("debug: false") && app.includes("firstVisibleRightTab") && app.includes("setRightPanelCollapsed(true)")],
  ["settings exposes integration and system actions", app.includes('id: "integrations"') && app.includes("onOpenBrowserPanel") && app.includes("onCheckUpdates") && app.includes("onOpenPath") && css.includes(".settings-integration-row")],
  ["renderer exposes current right-panel tabs", navigation.includes('["files", "browser", "terminal", "debug"] as RightTab[]')],
  ["renderer has separated workspace shell", app.includes("WorkspaceShell") && shell.includes("WorkspaceShellProps") && shell.includes("mainContent: React.ReactNode") && shell.includes("rightPanel: React.ReactNode") && shell.includes("export function WorkspaceShell")],
  ["chat composer orders agent model and thinking controls", chatWorkspace.includes('{zh ? "智能体" : "Agent"}: {activeAgentName}') && chatWorkspace.includes("模型：") && chatWorkspace.includes("推理：") && chatWorkspace.includes("defaultThinkingEffort") && chatWorkspace.includes("setThinkingEffort(defaultThinkingEffort)") && chatAdapter.includes("thinking_effort")],
  ["renderer can collapse right panel", app.includes("rightPanelCollapsed") && shell.includes("titlebar-right-panel-toggle") && css.includes(".content-grid.right-collapsed")],
  ["titlebar owns centered chat and command search", shell.includes('className="titlebar-center"') && shell.includes('className="titlebar-search-shell"') && shell.includes('id="titlebar-search-results"') && css.includes(".titlebar-search-results")],
  ["search is owned by the titlebar without a duplicate sidebar action", shell.includes('onFocus={openCommandPalette}') && !shell.includes('label={zh ? "搜索" : "Search"}') && shell.includes("commandPaletteInputRef.current?.focus()")],
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
  ["background queue shows progress completed steps and decisions", skillSquare.includes("background-task-progress") && skillSquare.includes("Completed:") && skillSquare.includes("Needs you:") && css.includes(".background-task-decisions")],
  ["file picker reports user-visible name type size and readiness", desktopApi.includes("PickedFileDescriptor") && desktopMain.includes("describePickedFiles") && chatWorkspace.includes('data-import-status') && chatWorkspace.includes('data-file-category') && chatWorkspace.includes('data-size-bytes') && chatWorkspace.includes("formatPickedFileMeta")],
  ["failed imports are isolated from usable context", chatWorkspace.includes('blockedReason: file.message || file.status') && chatWorkspace.includes('.filter((attachment) => !attachment.blockedReason)') && css.includes('.composer-attachment-chip.import-failed')],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("Renderer UI verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Renderer UI verification passed (${checks.length} checks).`);
