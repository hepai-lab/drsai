import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const view = readFileSync(join(root, "../shared/renderer/src/components/AgentSquareView.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
assert(view.includes('className="agent-square-heading"') && view.includes('className="agent-square-stats"'), "Agent Square is missing the product heading or availability summary");
assert(view.includes('zh ? "智能体广场" : "Agent Square"'), "Agent Square does not use the product-facing page title");
assert(view.includes('platformStatus.state !== "loading"') && view.includes('!loading && !refreshing'), "Agent Square still inserts loading or premature empty-state rows while the catalog refreshes");
assert(!view.includes('"Loading agents..."') && !view.includes('"正在读取智能体目录..."'), "Agent Square still renders a dedicated loading row");
assert(view.includes("filtersActive") && view.includes("clearFilters"), "Agent Square filters cannot be cleared as one operation");
assert(view.includes('className="agent-card-tags"') && view.includes("remainingCapabilities"), "Agent cards do not expose a compact capability summary");
assert(view.includes('is-selected') && view.includes('is-unavailable'), "Agent cards do not distinguish selection and availability states");
assert(styles.includes("/* Agent Square product surface */") && styles.includes("@media (max-width: 700px)"), "Agent Square visual hierarchy or narrow-window layout is missing");
assert(styles.includes("var(--app-accent)") && styles.includes("var(--app-text-primary)"), "Agent Square styling does not follow shared theme tokens");
assert(view.includes("getAgentDescription(agent, zh)"), "agent descriptions are not selected by the active UI language");
assert(view.includes("localizedDescription?.zh") && view.includes("localizedDescription?.en"), "localized descriptions are not searchable in both languages");
assert(view.includes("JSON.parse(text)") && view.includes("zhText || en"), "legacy JSON-string descriptions are not localized before Main restarts");
assert(!view.includes("一键启动"), "Agent Square must not imply that an already-running platform agent needs to be started");
assert(view.includes('zh ? "开始使用" : "Use agent"'), "Agent Square does not present the platform action as using the agent");
assert(!view.includes('className="agent-mode-pill"'), "Agent cards must not expose backend execution modes");
assert(!view.includes("agent-default-button") && !view.includes("Set as default agent"), "the unsupported default-agent control is still visible");
assert(!view.includes("Recently used") && !view.includes("recordAgentUsage"), "the non-durable recent-usage feature is still visible");
assert(!view.includes('className="agent-url"') && !view.includes('zh ? "运行模式"'), "technical URL or backend mode is still user-facing");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const preload = readFileSync(join(root, "../shared/main/preload.ts"), "utf8");
const shared = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const adapter = readFileSync(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const chat = readFileSync(join(root, "../shared/main/chat.ts"), "utf8");
const agents = readFileSync(join(root, "../shared/main/agents.ts"), "utf8");
const threads = readFileSync(join(root, "../shared/main/threads.ts"), "utf8");
const workspace = readFileSync(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const openAiBrandIcon = readFileSync(join(root, "../shared/renderer/src/components/OpenAiBrandIcon.tsx"), "utf8");
const telemetry = readFileSync(join(root, "../shared/main/agentTelemetry.ts"), "utf8");
const config = readFileSync(join(root, "../shared/main/myDrSaiConfig.ts"), "utf8");

assert(view.includes('["official", "mine"]') && view.includes("const localAgents"), "C1 catalog grouping is missing");
assert(view.includes('<Cloud size={14} />') && view.includes('zh ? "平台智能体" : "Platform agents"'), "platform agents section is missing its cloud identity or concise label");
assert(view.includes('agent.catalogVisibility !== "when_available" || agent.available === true'), "enabled third-party integrations are not projected into Agent Square");
assert(!view.includes('filter((agent) => agent.id !== "my-codex")'), "Codex is still unconditionally hidden from Agent Square");
assert(view.includes('value={availability}') && view.includes('value={sort}'), "C2 availability filter or sorting is missing");
assert(view.includes("agent.capabilities") && view.includes("getCapabilityLabel"), "C3 user-facing capability labels are missing");
assert(view.includes("const logo = agent.source === \"local\" ? drsaiLogo : agent.logo") && view.includes("logo && !failed") && view.includes("onError={() => setFailed(true)}"), "C4 local/remote logo selection and fallback are missing");
assert(view.includes('agent.id === "my-codex"') && view.includes("<OpenAiBrandIcon"), "Codex cards do not use the OpenAI brand icon");
assert(view.includes('" codex-logo"') && styles.includes(".agent-logo.codex-logo"), "Codex logo still inherits the generic framed agent-logo treatment");
assert(view.includes("OpenAI 官方编程智能体") && view.includes("OpenDrSai Agent 协议（OAEP）") && view.includes("getAgentOwner(agent, zh)"), "Codex card does not provide stable localized product copy, protocol context, and OpenAI attribution");
assert(view.includes("isSaiDoctor(right)") && view.includes('agent.name.trim() === "赛博士"'), "recommended sorting does not prioritize 赛博士");
assert(!view.includes("function AgentFeaturedCard") && view.includes('data-testid="my-drsai-configure"'), "local OpenDrSai and Codex do not share the standard card layout or preserve configuration access");
assert(workspace.includes('agent?.id === "my-codex"') && workspace.includes("<OpenAiBrandIcon"), "Codex selectors do not use the OpenAI brand icon");
assert(app.includes('{ id: "codex", label: "Codex", icon: OpenAiBrandIcon }'), "Codex settings still use a generic icon");
assert(openAiBrandIcon.includes('viewBox="0 0 24 24"') && openAiBrandIcon.includes('fill="currentColor"'), "the OpenAI icon is not rendered as a theme-safe inline SVG");
assert(!openAiBrandIcon.includes("maskImage") && !openAiBrandIcon.includes("WebkitMaskImage"), "the OpenAI icon still relies on the Electron-incompatible external SVG mask");
assert(view.includes("AgentDetailDialog") && view.includes("Example tasks"), "C5 detail dialog is missing");
assert(view.includes("getAgentCatalogSnapshot") && view.includes("preferCache: true") && view.includes("refresh: true"), "cache-first background refresh is not wired");
assert(view.includes("AgentConfigDialog") && view.includes('event.key === "Escape"'), "configuration/details dialogs are not separated or Escape-accessible");
assert(preload.includes('ipcRenderer.invoke("desktop:get-agent-catalog-snapshot"'), "atomic catalog snapshot IPC is missing");
assert(shared.includes("agentId?: string;") && adapter.includes("agentId: options?.agentId?.trim()"), "D1 explicit agentId is missing from chat requests");
assert(chat.includes("listConfiguredAgents()") && chat.includes("localAgent?.agent_name") && chat.includes('isCodexBackend ? "codex@1" : "opendrsai@1"'), "D3 configured local Runtime routing is missing");
assert(chat.includes("getPlatformAgentChatUrl(platformDescriptor.platformId)") && chat.includes("readSse(webContents"), "D4 platform routing does not reuse the SSE reader");
assert(
  chat.includes("model: platformDescriptor.platformId"),
  "D4 DDF execution does not route chat by the selected platform agent ID",
);
assert(
  agents.includes('`${ACTIVE_PLATFORM.baseUrl}/chat/completions`'),
  "D4 DDF execution does not use the active platform base_url",
);
assert(chat.includes("if (!platformDescriptor)") && chat.includes("await runRuntimeBackendChat("), "local agents do not use the Runtime branch");
assert(chat.includes("Only HAI Platform Agents reach this branch"), "platform chat is not isolated from the local Runtime branch");
assert(agents.includes('capabilities.has("chat")') && agents.includes('capabilities.has("streaming")'), "per-agent chat capability gate is missing");
assert(threads.includes("boundAgentId") && threads.includes("boundAgentName"), "D2 thread agent binding is missing");
assert(app.includes("changesBoundAgent") && app.includes("requestAppDecision") && app.includes("Start a new conversation"), "D5 switch protection is missing");
assert(app.includes("hasRuntimeBinding") && app.includes("(hasConversation || hasRuntimeBinding) && changesBoundAgent"), "D5 persisted Runtime Session agent-switch protection is missing");
assert(
  app.includes("persistInBackground: true") && app.includes("Keep navigation responsive"),
  "starting an agent chat still blocks navigation on thread persistence",
);
assert(
  workspace.includes('data-testid="composer-input"')
    && workspace.includes("composerFocusRequest")
    && workspace.includes("textareaRef.current?.focus({ preventScroll: true })")
    && app.includes("setComposerFocusRequest((current) => current + 1)"),
  "starting an agent chat does not focus the empty composer",
);
assert(workspace.includes("chat-agent-input-request") && workspace.includes("respondChatInput"), "E5 native input request UI is missing");
assert(chat.includes('platformTarget.mode !== "ddf"') && chat.includes("parseAgentInputRequestSseFrame"), "D6 DDF-aware stop/input SSE handling is missing");
assert(telemetry.includes("User messages, URLs, tokens and config are not accepted") && !telemetry.includes("messages:"), "F4 privacy-safe telemetry boundary is missing");
assert(chat.includes('event: "execution_completed"') && chat.includes('"execution_failed"'), "F4 execution telemetry is missing");
assert(agents.includes("OPENDRSAI_PLATFORM_AGENTS_ENABLED") && agents.includes("OPENDRSAI_PLATFORM_AGENT_CHAT_ENABLED"), "G3 rollout/rollback flags are missing");
assert(agents.includes("LOCAL_OPENDRSAI_AGENT_NAME"), "the local agent display name is not sourced from the OpenDrSai contract");
assert(agents.includes('catalogGroup: "local"') && agents.includes('catalogVisibility: "when_available"') && agents.includes('available: executable'), "Codex is not cataloged as an enabled local integration");
assert(view.includes('data-testid="opendrsai-effective-identity"'), "the signed-in HepAI identity is not shown in the OpenDrSai configuration panel");
assert(!view.includes("draft.user_id") && !view.includes("config.user_id"), "the legacy CLI user_id is still editable or displayed in Desktop");
assert(!config.includes('["user_id", "defult_config_name"'), "the legacy CLI user_id is still writable through Desktop config IPC");

console.log("Agent square usability verification passed (cache-first catalog, simplified cards, dialogs and per-agent execution gate).");
