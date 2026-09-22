import { aggregateDirectModels, directModelRoute, directTokenBudget, replaceDirectModel, type DirectModelEntry } from "./providerDirectSetup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, AudioLines, Bot, ChevronDown, ChevronUp, Copy, FileText, Globe2, History, Image as ImageIcon,
  MessageSquare, PackageOpen, Pencil, Plug, RefreshCw, Settings, ShieldCheck,
  Smartphone, Terminal as TerminalIcon, Trash2, Type, Video, Volume2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AuthUser, CodexBackendLogin, CodexBackendStatus, DesktopAgent,
  DesktopDataCleanupPreview, DesktopDataCleanupScope, DesktopHealth,
  DesktopIdeContextSnapshot, DesktopMobileAssociation, DesktopMobilePairingReadiness,
  DesktopMobileRemoteDiagnostics, DesktopVoiceRuntimeStatus, DesktopDuplexVoiceReadiness,
  DesktopVoiceInteractionMode,
  DesktopThread, AgentModelSelection, AgentModelCapabilityStatus, AgentSkillPolicy,
  AgentSkillPreview, AgentKnowledgePolicy, AgentKnowledgePreview, AgentToolPolicy,
  AgentToolPreview, MyDrSaiModelConfig, MyDrSaiModelApiProtocol,
  MyDrSaiModelCapability, MyDrSaiModelModality, MyDrSaiProviderModelConfig,
  ModelOwnership,
  MyDrSaiAgentModelPolicy, MyDrSaiModelConnection, MyDrSaiProviderPreset,
  MyDrSaiConfig, RuntimeModelOperation, WorkspaceProject,
} from "@shared/desktopApi";
import type { DesktopPlatformDescriptor } from "@shared/platform";
import { desktopApi } from "../desktopApi";
import { PerceptorSettingsPanel } from "./PerceptorSettingsPanel";
import { OpenAiBrandIcon, openAiLogo } from "./OpenAiBrandIcon";
import { CodexIntegrationSettings } from "./CodexIntegrationSettings";
import { AgentLogo } from "./AgentSquareView";
import { mobilePairingErrorText } from "./MobilePairingDialog";
import {
  mobileAssociationScopeEditorState,
  type MobileAssociationScopeEditorState,
} from "./mobileAssociationScopeEditor";
import { requestAppDecision, showAppNotice } from "./AppDecisionDialog";
import type { ModelSettingsDraftController } from "../containers/ModelSettingsContainer";
import type { ThinkingEffort } from "./ChatWorkspace";
import { describeUserFacingError } from "../userFacingErrors";
import { userFacingFailureMessage } from "../userFacingLanguage";
import { normalizeRuntimeErrorEnvelope } from "../../../api/errorEnvelope";
import {
  isSelectableModelAvailability,
  modelCatalogRecoveryCopy,
  supportsFullAgentPrimaryRuntime,
  supportsImageGenerationModel,
  classifyModelFamily,
  modelFamilyLabel,
  orderModelEntriesByFamily,
  type ModelFamily,
  type OrderedModelEntry,
} from "../modelCatalogRecovery";
import { knownVoiceModelCapabilities, mergeKnownVoiceModalities } from "../modelVoiceCapabilities";
import { getAgentModelOptions } from "../agentModelOptions";
import { formatUpdateStatus } from "../statusFormatting";
import type { WorkspaceSortMode } from "../workspaceOrdering";
import { resolveAvailableVoiceName, useVoicePreferences } from "../voice/useVoicePreferences";
import {
  getDuplexVoiceReadinessActions,
  type DuplexVoiceReadinessActionId,
} from "../voice/duplex/readinessActions";
import type { AppLanguage } from "../navigation";

type AppearanceMode = "light" | "dark" | "system";
type AgentConfigurationTab = "opendrsai" | "codex" | "platform";
type AgentCapabilityModelRole =
  | "image_understanding_model" | "image_generation_model" | "text_to_speech_model"
  | "realtime_voice_model" | "speech_to_text_model";
interface AgentModelPolicyDraft {
  primary_model: AgentModelSelection;
  image_understanding_model: AgentModelSelection | null;
  image_generation_model: AgentModelSelection | null;
  text_to_speech_model: AgentModelSelection | null;
  realtime_voice_model: AgentModelSelection | null;
  speech_to_text_model: AgentModelSelection | null;
  reasoning_effort: ThinkingEffort | null;
}
interface AgentConfigurationPreference {
  model?: string;
  modelRef?: { provider_id: string; model_id: string };
  imageModel?: string;
  thinkingEffort?: ThinkingEffort;
}
function getAgentConfigurationTab(agent: DesktopAgent): AgentConfigurationTab {
  if (agent.id === "my-codex") return "codex";
  if (agent.source === "remote") return "platform";
  return "opendrsai";
}
interface SidebarComponentVisibility { square: boolean; agents: boolean; skills: boolean; }
interface RightSidebarComponentVisibility {
  files: boolean;
  diagnostics: boolean;
}
const DEFAULT_AGENT_TEXT_MODEL = "deepseek-v4-pro";
const LAST_THREAD_STORAGE_KEY = "opendrsai.lastThread";
const AWAY_STARTED_AT_STORAGE_KEY = "opendrsai.awayStartedAt";

const MODEL_CENTER_RUNTIME_STATUS = {
  available: { zh: "可用", en: "Available", tone: "success" },
  configured_unverified: { zh: "已配置·未验证", en: "Configured · unverified", tone: "neutral" },
  unavailable: { zh: "不可用", en: "Unavailable", tone: "muted" },
  stale: { zh: "状态过期", en: "Status stale", tone: "warning" },
  offline: { zh: "服务离线", en: "Service offline", tone: "warning" },
  unauthorized: { zh: "认证失败", en: "Authentication failed", tone: "danger" },
  error: { zh: "异常", en: "Error", tone: "danger" },
} as const;

function modelCenterRuntimeStatus(status: string | null | undefined, zh: boolean): { label: string; tone: string } {
  const item = MODEL_CENTER_RUNTIME_STATUS[status as keyof typeof MODEL_CENTER_RUNTIME_STATUS]
    ?? MODEL_CENTER_RUNTIME_STATUS.unavailable;
  return { label: zh ? item.zh : item.en, tone: item.tone };
}

function modelCenterConnection(baseUrl: string): { host: string; title: string } {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported URL");
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return { host: parsed.host, title: parsed.toString().replace(/\/$/, "") };
  } catch {
    const masked = baseUrl
      .replace(/([?&](?:key|token|secret|password)=)[^&#\s]*/gi, "$1••••")
      .replace(/:\/\/[^/@\s]+@/g, "://••••@")
      .trim();
    const short = masked.length > 32 ? `${masked.slice(0, 29)}…` : masked;
    return { host: short || "—", title: short || "—" };
  }
}

function modelCenterModalityLabel(modality: MyDrSaiModelModality, zh: boolean): string {
  const labels: Record<MyDrSaiModelModality, [string, string]> = {
    text: ["文本", "Text"], image: ["图像", "Image"], audio: ["音频", "Audio"], video: ["视频", "Video"],
  };
  return labels[modality] ? labels[modality][zh ? 0 : 1] : modality;
}

function modelCenterAgentReason(reason: string, zh: boolean): string {
  if (!zh) return reason;
  return reason
    .replace("missing chat capability", "缺少对话能力")
    .replace("missing tool_calling capability", "缺少工具调用能力")
    .replace("missing text input modality", "缺少文本输入模态")
    .replace("missing text output modality", "缺少文本输出模态")
    .replaceAll("; ", "；");
}

export type SettingsPane = "general" | "voice" | "agent-defaults" | "model-providers" | "perceptors" | "executors" | "memories" | "agent-task" | "approvals" | "analytics" | "integrations" | "codex" | "remote-workspace" | "channels" | "archived-sessions" | "other";

/** Settings panes that are still rendered in the navigation but have no working
 * implementation behind them. They stay visible so the surface stays honest
 * about what exists, but they are disabled instead of opening a pane that fails
 * at mount (Agent configuration has not shipped its feature yet; Perceptors
 * 404s against the Desktop Runtime; Executors and Memories are placeholders
 * for the next stage). Remove an entry here once its backend
 * and pane content actually ship. */
export const UNAVAILABLE_SETTINGS_PANES: Partial<Record<SettingsPane, { zh: string; en: string }>> = {
  "agent-defaults": {
    zh: "智能体配置功能尚未实现，暂时不可用。",
    en: "Agent configuration is not implemented yet and is temporarily unavailable.",
  },
  perceptors: {
    zh: "桌面运行时尚未提供感知器接口（GET /v1/config/perceptors 返回 404）。",
    en: "The desktop runtime does not expose the Perceptor API yet (GET /v1/config/perceptors returns 404).",
  },
  executors: {
    zh: "执行器注册表将在下一阶段开放。",
    en: "Executor registry is coming next.",
  },
  memories: {
    zh: "记忆器注册表将在下一阶段开放。",
    en: "Memory registry is coming next.",
  },
};

/** Whether the Desktop Runtime serves the Perceptor registry. Probing a route
 * the runtime does not serve costs a rejected ipcMain handler, and Electron logs
 * every rejected handler even when the renderer catches the rejection — so no
 * call site may probe while the registry is absent. Derived from the registry
 * above so re-enabling the pane also re-enables the probes. */
export const PERCEPTOR_REGISTRY_AVAILABLE = !UNAVAILABLE_SETTINGS_PANES.perceptors;

/** Localized explanation for a disabled pane, or null when the pane is usable. */
export function settingsPaneUnavailableReason(pane: SettingsPane, zh: boolean): string | null {
  const entry = UNAVAILABLE_SETTINGS_PANES[pane];
  if (!entry) return null;
  return zh ? entry.zh : entry.en;
}

/** Panes that this desktop build cannot serve even though the pane itself is
 * implemented. They are derived from the platform feature capabilities so a
 * platform (or a future runtime) that really serves the capability keeps the
 * pane enabled. */
export function capabilityDisabledPaneReason(
  pane: SettingsPane,
  features: DesktopPlatformDescriptor["capabilities"]["features"] | undefined,
  zh: boolean,
): string | null {
  if (pane === "codex" && features?.codexBackend === false) {
    return zh
      ? "当前桌面运行时只注册了 opendrsai 后端，未注册 Codex 后端，因此 Codex 集成在此构建中不可用。"
      : "This desktop runtime registers only the opendrsai backend, not the Codex backend, so Codex integration is unavailable in this build.";
  }
  return null;
}

/** Single entry point for "this navigation item is rendered but disabled". */
function disabledPaneReason(
  pane: SettingsPane,
  features: DesktopPlatformDescriptor["capabilities"]["features"] | undefined,
  zh: boolean,
): string | null {
  return settingsPaneUnavailableReason(pane, zh) ?? capabilityDisabledPaneReason(pane, features, zh);
}

function modelProviderRuntimeSummary(connection: MyDrSaiModelConnection, zh: boolean): string | undefined {
  switch (connection.runtime?.runtime_status) {
    case "applied": return connection.runtime.active_runtime_count > 0 ? (zh ? "运行中" : "Active") : undefined;
    case "pending_next_turn": return zh ? "下次会话生效" : "Applies next session";
    case "partially_applied": return zh ? "部分会话待更新" : "Some sessions pending";
    default: return undefined;
  }
}

function modelProviderTestSummary(connection: MyDrSaiModelConnection, zh: boolean): string | undefined {
  const test = connection.last_test;
  if (!test) return undefined;
  const kind = test.mode === "model" ? (zh ? "模型调用" : "Model call") : (zh ? "连接检查" : "Connection check");
  const outcome = test.ok ? (zh ? "已通过" : " passed") : (zh ? "失败" : " failed");
  const testedAt = new Date(test.tested_at);
  const timestamp = Number.isNaN(testedAt.getTime()) ? "" : testedAt.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${kind}${outcome}${timestamp ? ` · ${timestamp}` : ""}`;
}
type AndroidDeviceLoadState = "idle" | "loading" | "ready" | "runtime-offline" | "platform-offline" | "management-unavailable" | "failed";

function isPermissionError(reason: unknown): boolean {
  const raw = reason instanceof Error ? reason.message : String(reason);
  return /401|403|forbidden|permission|unauthorized|oidc|auth/i.test(raw);
}

function classifyAndroidDeviceError(reason: unknown, readiness: DesktopMobilePairingReadiness | null): AndroidDeviceLoadState {
  if (readiness?.state === "offline") return "platform-offline";
  if (readiness?.state === "not_registered" || readiness?.state === "credential_invalid") return "runtime-offline";
  if (isPermissionError(reason)) return "management-unavailable";
  return "failed";
}

function androidRelativeTime(raw: string | null | undefined, language: AppLanguage): string {
  if (!raw) return language === "zh" ? "从未在线" : "never seen";
  const then = Date.parse(raw);
  if (!Number.isFinite(then)) return language === "zh" ? "时间未知" : "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return language === "zh" ? "刚刚" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return language === "zh" ? `${minutes}分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === "zh" ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return language === "zh" ? "昨天" : "yesterday";
  return language === "zh" ? `${days}天前` : `${days}d ago`;
}

/* Inline SVG data-URIs for provider logos (replaces dead new URL() calls to non-existent legacy/ paths). */
const deepseekLogoSvg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4D6BFE" d="M12 0a12 12 0 100 24 12 12 0 000-24zm6.025 9.275c.382.45.65 1.05.75 1.725h-4.8c-.825 0-1.5-.675-1.5-1.5v-4.725c.675.113 1.275.383 1.725.762l3.075 3.075c.3.3.525.6.45.663z M18.775 12.75c-.1.675-.368 1.275-.762 1.725l-3.075 3.075c-.45.382-1.05.65-1.725.75v-4.8c0-.825.675-1.5 1.5-1.5h4.063z M11.25 18.775c-.675-.1-1.275-.368-1.725-.762l-3.075-3.075c-.382-.45-.65-1.05-.75-1.725h4.8c.825 0 1.5.675 1.5 1.5v4.062z M5.525 11.25c.1-.675.368-1.275.762-1.725l3.075-3.075c.45-.382 1.05-.65 1.725-.75v4.8c0 .825-.675 1.5-1.5 1.5H5.525z"/></svg>`)}`;
const geminiLogoSvg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1BA1E2" d="M12 24c0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12z"/></svg>`)}`;
const openrouterLogoSvg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#1C1C1C"/><path d="M6 8h4v2H8v6H6V8zm6 0h2v8h-2V8zm6 0v8h-2v-2h2V8z" fill="#fff"/></svg>`)}`;

const bundledModelProviderLogos: Record<string, string> = {
  deepseek: deepseekLogoSvg,
  openai: openAiLogo,
  gemini: geminiLogoSvg,
  openrouter: openrouterLogoSvg,
};

const BUILTIN_MODEL_PROVIDER_PRESETS: MyDrSaiProviderPreset[] = [
  { id: "hepai", label: "HepAI", base_url: "https://ddf.ihep.ac.cn/apiv2", default_model: "deepseek-v4-pro", wire_api: "openai", requires_api_key: false, base_url_editable: false, supports_model_discovery: true, auth_mode: "oidc" },
  { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", default_model: "deepseek-chat", wire_api: "openai", requires_api_key: true, api_key_env: "DEEPSEEK_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", default_model: "gpt-5.4", wire_api: "openai", requires_api_key: true, api_key_env: "OPENAI_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "anthropic", label: "Anthropic", base_url: "https://api.anthropic.com/v1", anthropic_base_url: "https://api.anthropic.com/v1", default_model: "claude-sonnet-4-6", wire_api: "anthropic", requires_api_key: true, api_key_env: "ANTHROPIC_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "gemini", label: "Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta", google_base_url: "https://generativelanguage.googleapis.com/v1beta", default_model: "gemini-3.6-flash", wire_api: "gemini", requires_api_key: true, api_key_env: "GEMINI_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", default_model: "openai/gpt-5.4", wire_api: "openai", requires_api_key: true, api_key_env: "OPENROUTER_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "zhizengzeng", label: "Zhizengzeng", base_url: "https://api.zhizengzeng.com/v1", anthropic_base_url: "https://api.zhizengzeng.com/anthropic", google_base_url: "https://api.zhizengzeng.com/google", default_model: "deepseek-v4-pro", wire_api: "openai", requires_api_key: true, api_key_env: "ZHIZENGZENG_API_KEY", base_url_editable: false, supports_model_discovery: true, auth_mode: "api_key" },
  { id: "ollama", label: "Ollama", base_url: "http://127.0.0.1:11434/v1", wire_api: "openai", requires_api_key: false, base_url_editable: true, supports_model_discovery: true, auth_mode: "none" },
];

const MODEL_PROVIDER_TAB_ORDER = BUILTIN_MODEL_PROVIDER_PRESETS.map((preset) => preset.id);

function modelProviderDisplayLabel(provider: { id: string; label: string }, zh: boolean): string {
  if (provider.id === "hepai") return "HepAI";
  if (provider.id === "zhizengzeng") return zh ? "智增增" : "Zhizengzeng";
  if (provider.id === "ollama") return zh ? "Ollama（本地）" : "Ollama (local)";
  return provider.label;
}

/**
 * Splits the provider tabs into the inline row plus the "更多 / 已保存" overflow menu.
 *
 * Primary providers always stay inline. On top of those, both the most recently
 * used provider and the provider whose form is currently open are pinned inline:
 * the tab the user is editing must never be hidden inside the overflow menu, and
 * the custom-draft pseudo tab must never be rendered twice (it is already the
 * first entry of the tab list).
 */
function computeModelProviderTabLayout({ tabs, primaryIds, draftTabId, pinned }: {
  tabs: Array<{ id: string; label: string }>;
  primaryIds: Set<string>;
  draftTabId: string;
  pinned: Array<{ id: string; label: string } | null | undefined>;
}): { visible: Array<{ id: string; label: string }>; overflow: Array<{ id: string; label: string }> } {
  // The draft pseudo tab is rendered by the caller as the first entry of the tab
  // list, so it is never emitted here: a duplicated entry would be a second,
  // non-functional "自定义接入" button in the row.
  const visible = tabs.filter((provider) => provider.id !== draftTabId && primaryIds.has(provider.id));
  const pinnedModelProviderIds = new Set<string>();
  for (const entry of pinned) {
    if (!entry || entry.id === draftTabId || pinnedModelProviderIds.has(entry.id)) continue;
    pinnedModelProviderIds.add(entry.id);
    if (!visible.some((provider) => provider.id === entry.id)) visible.push(entry);
  }
  return { visible, overflow: tabs.filter((provider) => provider.id !== draftTabId && !primaryIds.has(provider.id) && !pinnedModelProviderIds.has(provider.id)) };
}

function ModelProviderLogo({ provider }: { provider: string }) {
  const normalized = provider.toLowerCase();
  const kind = normalized === "zhizengzeng" ? "zhizz" : normalized.startsWith("custom") ? "custom" : normalized;
  const bundledLogo = bundledModelProviderLogos[kind];
  if (bundledLogo) return <span className={`model-provider-logo model-provider-logo-${kind}`} aria-hidden="true"><img src={bundledLogo} alt="" /></span>;
  if (kind === "hepai") return <span className="model-provider-logo model-provider-logo-hepai" aria-hidden="true"><svg viewBox="0 0 32 26"><defs><linearGradient id="hepai-provider-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7eaad7" /><stop offset=".52" stopColor="#aa91b8" /><stop offset="1" stopColor="#c54d69" /></linearGradient></defs><rect width="32" height="26" rx="4" fill="url(#hepai-provider-gradient)" /><text x="16" y="18.2" textAnchor="middle" fill="#fff" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800">HAI</text></svg></span>;
  if (kind === "anthropic") return <span className="model-provider-logo model-provider-logo-anthropic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" fill="currentColor" /></svg></span>;
  if (kind === "zhizz") return <span className="model-provider-logo model-provider-logo-zhizz" aria-hidden="true"><svg viewBox="0 0 128 128"><path d="M5 96 27 58l17 28 27-43 18 29 29-48" fill="none" stroke="#91c8ff" strokeWidth="14" strokeLinejoin="miter" /><path d="M5 96 27 66l17 28 27-43 18 29 34-57" fill="none" stroke="#1769f5" strokeWidth="8" strokeLinejoin="miter" /><path d="m99 9 23 2-4 22z" fill="#51a6ff" /></svg></span>;
  if (kind === "ollama") return <span className="model-provider-logo model-provider-logo-ollama" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z" fill="currentColor" /></svg></span>;
  return <span className="model-provider-logo model-provider-logo-custom" aria-hidden="true"><PackageOpen size={14} /></span>;
}

type ProviderModelModality = "text" | "image" | "audio" | "video";

type ProviderReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

const PROVIDER_REASONING_EFFORT_OPTIONS: ProviderReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

type ProviderModelEditorDraft = {
  originalId: string;
  modelId: string;
  alias: string;
  inputModalities: MyDrSaiModelModality[];
  outputModalities: MyDrSaiModelModality[];
  apiProtocol: MyDrSaiModelApiProtocol;
  enabled: boolean;
  capabilities: MyDrSaiModelCapability[];
  // Declared numbers are edited as text: an empty field means "no declaration",
  // which is not the same as 0 (the Runtime then falls back to the built-in
  // registry). Keeping them as text also lets the user type before we validate.
  tokenLimit: string;
  maxTokens: string;
  reasoningEfforts: ProviderReasoningEffort[];
  /** Which catalog file the entry came from. Read-only; null for new entries. */
  origin: ModelOwnership | null;
};

/**
 * Parse a declared token number typed by the user.
 *
 * ``absent`` (empty input) is a valid state: it clears the declaration so the
 * Runtime falls back to the built-in registry for that model.
 */
function parseDeclaredTokens(value: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,9}$/.test(trimmed)) return { ok: false };
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 && parsed <= 100_000_000 ? { ok: true, value: parsed } : { ok: false };
}

/** Toggle one reasoning effort while keeping the canonical declaration order. */
function nextProviderReasoningEfforts(
  current: ProviderReasoningEffort[],
  effort: ProviderReasoningEffort,
  enabled: boolean,
): ProviderReasoningEffort[] {
  const selected = new Set(current);
  if (enabled) selected.add(effort);
  else selected.delete(effort);
  return PROVIDER_REASONING_EFFORT_OPTIONS.filter((candidate) => selected.has(candidate));
}

/**
 * Shape a model entry for writing back to the Provider.
 *
 * ``origin`` is derived from the catalog file on read and is not an accepted
 * write field, so it must never round-trip to the configuration writer.
 */
function providerModelConfigForWrite(config: MyDrSaiProviderModelConfig): MyDrSaiProviderModelConfig {
  const { origin: _origin, ...rest } = config;
  return { ...rest, api_protocol: (rest.api_protocol as string) === "google" ? "gemini" : rest.api_protocol };
}

function knownTextModelCapabilities(modelId: string): MyDrSaiModelCapability[] {
  const normalized = modelId.trim().toLowerCase().split("/").at(-1);
  return normalized === "deepseek-v4-pro" || normalized === "deepseek-v4-flash" || normalized?.startsWith("deepseek-v4-flash-")
    ? ["chat", "tool_calling", "reasoning"]
    : [];
}

function defaultTextModelCapabilities(modelId: string): MyDrSaiModelCapability[] {
  const known = knownTextModelCapabilities(modelId);
  return known.length ? known : ["chat"];
}

/** Family order used for both the separator sequence and row sorting. */
const MODEL_FAMILY_ORDER: ModelFamily[] = ["chat", "multimodal_input", "image_generation", "audio", "other"];

type ProviderModelEntry =
  | { kind: "family"; family: ModelFamily; count: number }
  | { kind: "model"; model: string };

/**
 * Classify each catalog row and flatten it into separator + row order.
 *
 * Every emitted entry becomes a direct child of ``.model-provider-model-list``
 * (a grid whose rows use ``subgrid``); nothing here may wrap rows in another
 * element, or the table collapses into one column per wrapper.
 */
function orderedProviderModelEntries(
  models: string[],
  configs: Record<string, MyDrSaiProviderModelConfig>,
  wireApi: MyDrSaiModelApiProtocol,
  aliases: Record<string, string>,
  operations: Record<string, RuntimeModelOperation[]>,
): OrderedModelEntry[] {
  return orderModelEntriesByFamily(models.map((model) => {
    const config = configs[model] ?? providerModelConfigFor(model, { wire_api: wireApi, model_aliases: aliases, model_operations: operations });
    return {
      id: model,
      family: classifyModelFamily({
        alias: config.alias,
        model,
        operations: config.capabilities as unknown as readonly string[],
        input_modalities: config.input_modalities as unknown as readonly string[],
        output_modalities: config.output_modalities as unknown as readonly string[],
      }),
    };
  }));
}

function providerModelConfigFor(
  modelId: string,
  provider: { wire_api: MyDrSaiModelApiProtocol; model_configs?: Record<string, MyDrSaiProviderModelConfig>; model_aliases?: Record<string, string>; model_operations?: Record<string, RuntimeModelOperation[]> } | undefined,
): MyDrSaiProviderModelConfig {
  const configured = provider?.model_configs?.[modelId];
  if (configured) {
    const legacy = (configured as unknown as { modalities?: MyDrSaiModelModality[] }).modalities;
    const capabilities = configured.capabilities ?? defaultTextModelCapabilities(modelId);
    const output = legacy ? [
      ...(["chat", "tool_calling", "reasoning", "speech_to_text"].some((capability) => capabilities.includes(capability as MyDrSaiModelCapability)) ? ["text" as const] : []),
      ...(["image_generation", "image_edit"].some((capability) => capabilities.includes(capability as MyDrSaiModelCapability)) ? ["image" as const] : []),
      ...(capabilities.includes("text_to_speech") ? ["audio" as const] : []),
      ...(capabilities.includes("video_generation") ? ["video" as const] : []),
    ] : configured.output_modalities;
    const voiceModalities = mergeKnownVoiceModalities(
      modelId,
      configured.input_modalities ?? legacy ?? ["text"],
      output?.length ? [...new Set(output)] : ["text"],
    );
    const knownVoice = knownVoiceModelCapabilities(modelId);
    return {
      ...configured,
      input_modalities: voiceModalities.input,
      output_modalities: voiceModalities.output,
      capabilities: [...new Set([...capabilities, ...(knownVoice?.capabilities ?? [])])],
      api_protocol: (configured.api_protocol as string) === "google" ? "gemini" : configured.api_protocol,
    };
  }

  const operations = provider?.model_operations?.[modelId] ?? [];
  const normalizedId = modelId.toLowerCase().split("/").at(-1);
  const speechToText = normalizedId === "whisper-1";
  const textToSpeech = normalizedId === "tts-1";
  const knownVoice = knownVoiceModelCapabilities(modelId);
  return {
    ...(provider?.model_aliases?.[modelId] ? { alias: provider.model_aliases[modelId] } : {}),
    input_modalities: knownVoice?.inputModalities ?? (speechToText ? ["audio"] : operations.includes("image_edit") ? ["text", "image"] : ["text"]),
    output_modalities: knownVoice?.outputModalities ?? (speechToText ? ["text"] : textToSpeech ? ["audio"] : operations.some((operation) => operation === "image_generation" || operation === "image_edit") ? ["image"] : ["text"]),
    api_protocol: provider?.wire_api ?? "openai",
    enabled: true,
    capabilities: knownVoice?.capabilities ?? (speechToText ? ["speech_to_text"] : textToSpeech ? ["text_to_speech"] : operations.some((operation) => operation === "image_generation" || operation === "image_edit") ? operations.filter((operation) => operation === "image_generation" || operation === "image_edit") : [...new Set([...defaultTextModelCapabilities(modelId), ...operations])]),
  };
}

function providerModelConfigsFor(
  modelIds: string[],
  provider: Parameters<typeof providerModelConfigFor>[1],
): Record<string, MyDrSaiProviderModelConfig> {
  return Object.fromEntries(modelIds.map((modelId) => [modelId, providerModelConfigFor(modelId, provider)]));
}

/**
 * Rows the Settings panel shows for one Provider.
 *
 * ``models`` is the *selectable* list, so a disabled model is absent from it.
 * The disabled entries are appended back so their row (and therefore the switch
 * that re-enables them) does not disappear after saving.
 */
function providerDraftModels(
  provider: { models?: string[]; disabled_models?: string[] } | undefined,
  fallback: string[],
): string[] {
  const models = provider?.models?.length ? [...provider.models] : [...fallback];
  for (const model of provider?.disabled_models ?? []) if (!models.includes(model)) models.push(model);
  return models;
}

function providerModelDescriptor(modelId: string, providerId: string, catalogModels: MyDrSaiModelConfig[]): MyDrSaiModelConfig | undefined {
  const normalizedId = modelId.trim().toLowerCase();
  return catalogModels.find((candidate) => {
    if (candidate.provider_id && candidate.provider_id !== providerId) return false;
    return [candidate.model, candidate.alias, candidate.alias?.split("/").at(-1)]
      .some((value) => value?.trim().toLowerCase() === normalizedId);
  });
}

function providerModelModalities(
  modelId: string,
  providerId: string,
  catalogModels: MyDrSaiModelConfig[],
  declaredOperations: RuntimeModelOperation[],
): { input: ProviderModelModality[]; output: ProviderModelModality[] } {
  const normalizedId = modelId.trim().toLowerCase();
  const descriptor = providerModelDescriptor(modelId, providerId, catalogModels);
  const input = new Set<ProviderModelModality>();
  const output = new Set<ProviderModelModality>();
  for (const modality of descriptor?.input_modalities ?? []) if (["text", "image", "audio", "video"].includes(modality)) input.add(modality as ProviderModelModality);
  for (const modality of descriptor?.output_modalities ?? []) if (["text", "image", "audio", "video"].includes(modality)) output.add(modality as ProviderModelModality);
  const knownVoice = knownVoiceModelCapabilities(modelId);
  for (const modality of knownVoice?.inputModalities ?? []) input.add(modality);
  for (const modality of knownVoice?.outputModalities ?? []) output.add(modality);
  if (descriptor?.vision) input.add("image");
  if (declaredOperations.includes("image_edit")) input.add("image");
  if (declaredOperations.some((operation) => operation === "image_generation" || operation === "image_edit")) output.add("image");
  if (normalizedId === "whisper-1" || normalizedId.endsWith("/whisper-1")) {
    input.add("audio");
    output.add("text");
  }
  if (normalizedId === "tts-1" || normalizedId.endsWith("/tts-1")) {
    input.add("text");
    output.add("audio");
  }
  if (input.size === 0) input.add("text");
  if (output.size === 0) output.add("text");
  const ordered = ["text", "image", "audio", "video"] as const;
  return { input: ordered.filter((modality) => input.has(modality)), output: ordered.filter((modality) => output.has(modality)) };
}

function ModelModalityBadges({ modalities, direction, zh = false, onClick }: { modalities: ProviderModelModality[]; direction: "input" | "output"; zh?: boolean; onClick?: () => void }) {
  const entries: Record<ProviderModelModality, { label: string; icon: LucideIcon }> = {
    text: { label: "Text", icon: Type },
    image: { label: "Image", icon: ImageIcon },
    audio: { label: "Audio", icon: AudioLines },
    video: { label: "Video", icon: Video },
  };
  return <div className={`model-modality-badges ${onClick ? "is-editable" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}>{modalities.map((modality) => {
    const entry = entries[modality];
    const Icon = entry.icon;
    const supported = modalities.includes(modality);
    const stateLabel = zh ? (supported ? "支持" : "不支持") : (supported ? "Supported" : "Not supported");
    const directionLabel = direction === "input" ? (zh ? "输入" : "Input") : (zh ? "输出" : "Output");
    const label = `${directionLabel} ${entry.label} · ${stateLabel}`;
    return <span key={modality} className={`model-modality-badge modality-${modality} ${supported ? "is-supported" : "is-unsupported"}`} title={label} aria-label={label}><Icon size={14} aria-hidden /></span>;
  })}</div>;
}

function ModelApiProtocolBadge({ protocol, zh, onClick }: { protocol: string; zh: boolean; onClick?: () => void }) {
  // Legacy copy marker retained for migration-contract verification: "Google API 兼容".
  const normalized = protocol.toLowerCase();
  const kind = normalized === "anthropic" ? "anthropic" : normalized === "google" || normalized === "gemini" ? "google" : "openai";
  const labels = zh
    ? { openai: "OpenAI API 兼容", anthropic: "Anthropic API 兼容", google: "Gemini 原生 API" } as const
    : { openai: "OpenAI API compatible", anthropic: "Anthropic API compatible", google: "Gemini native API" } as const;
  const marks = { openai: "OA", anthropic: "A", google: "G" } as const;
  const label = labels[kind];
  return <div className={`model-api-protocols ${onClick ? "is-editable" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}><span className={`model-api-protocol protocol-${kind} is-supported`} title={label} aria-label={label}><i aria-hidden>{marks[kind]}</i></span></div>;
}

function ModelFamilyBadge({ family, zh }: { family: ModelFamily; zh: boolean }) {
  // Model families are disjoint (chat / multimodal-input vs image generation).
  // Showing the family keeps the two visually separated even though both rows
  // can carry an "Image" modality badge.
  const tone = family === "image_generation"
    ? "is-generation"
    : family === "multimodal_input"
      ? "is-multimodal"
      : family === "audio"
        ? "is-audio"
        : "is-chat";
  return (
    <span className={`model-family-badge ${tone}`} data-family={family} title={modelFamilyLabel(family, zh)}>
      {modelFamilyLabel(family, zh)}
    </span>
  );
}

function createAgentModelPolicyDraft(policy: MyDrSaiAgentModelPolicy): AgentModelPolicyDraft {
  return {
    primary_model: policy.primary_model,
    image_understanding_model: policy.image_understanding_model ?? null,
    image_generation_model: policy.image_generation_model ?? policy.image_model ?? null,
    text_to_speech_model: policy.text_to_speech_model ?? null,
    realtime_voice_model: policy.realtime_voice_model ?? null,
    speech_to_text_model: policy.speech_to_text_model ?? null,
    reasoning_effort: policy.reasoning_effort ?? null,
  };
}

function agentToolLabel(toolId: string, zh: boolean): string {
  if (toolId === "builtin.web-search") return zh ? "网络搜索" : "Web search";
  if (toolId === "builtin.image_generation") return zh ? "图像生成" : "Image generation";
  if (toolId === "builtin.image_edit") return zh ? "图像编辑" : "Image editing";
  return toolId;
}

function agentToolStatusLabel(status: string, zh: boolean): string {
  if (!zh) return status;
  return ({
    available: "可用",
    disabled: "已禁用",
    runtime_unavailable: "运行环境不可用",
    network_unavailable: "网络不可用",
    unsupported_platform: "当前平台不支持",
  } as Record<string, string>)[status] ?? status;
}

function AgentResourcesSettings({ agentId, zh, onManagePerceptors }: { agentId: string; zh: boolean; onManagePerceptors: () => void }) {
  const [tab, setTab] = useState<"perception" | "tools" | "skills" | "knowledge">("perception");
  const [perceptors, setPerceptors] = useState<Awaited<ReturnType<typeof desktopApi.listPerceptors>>>([]);
  const [toolPolicy, setToolPolicy] = useState<AgentToolPolicy | null>(null);
  const [toolPreview, setToolPreview] = useState<AgentToolPreview | null>(null);
  const [skillPolicy, setSkillPolicy] = useState<AgentSkillPolicy | null>(null);
  const [skillPreview, setSkillPreview] = useState<AgentSkillPreview | null>(null);
  const [knowledgePolicy, setKnowledgePolicy] = useState<AgentKnowledgePolicy | null>(null);
  const [knowledgePreview, setKnowledgePreview] = useState<AgentKnowledgePreview | null>(null);
  const [knowledgeDraft, setKnowledgeDraft] = useState({ id: "", name: "", type: "local-files" as "local-files" | "ragflow", location: "", dataset: "", credential: "" });
  const [knowledgeQuery, setKnowledgeQuery] = useState<Record<string, string>>({});
  const [knowledgeEvidence, setKnowledgeEvidence] = useState<Record<string, Array<{ source: string; score: number; content?: string }>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // The Perceptor API is not served by the Desktop Runtime yet, so do not
      // probe it at all: the .catch() below would still leave a rejected
      // ipcMain handler behind, which Electron logs as "Error occurred in
      // handler for 'desktop:list-perceptors'". The catch stays as a guard for
      // the day the route ships and misbehaves — it must never take the
      // tool/skill/knowledge panels down with it.
      const perceptorRows = PERCEPTOR_REGISTRY_AVAILABLE ? await desktopApi.listPerceptors().catch(() => []) : [];
      const [tools, toolsPreview, skills, skillsPreview, knowledge, knowledgePreviewResult] = await Promise.all([
        desktopApi.getMyDrSaiAgentToolPolicy(agentId),
        desktopApi.previewMyDrSaiAgentTools(agentId),
        desktopApi.getMyDrSaiAgentSkillPolicy(agentId),
        desktopApi.previewMyDrSaiAgentSkills(agentId),
        desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId),
        desktopApi.previewMyDrSaiAgentKnowledge(agentId),
      ]);
      setPerceptors(perceptorRows); setToolPolicy(tools); setToolPreview(toolsPreview); setSkillPolicy(skills); setSkillPreview(skillsPreview);
      setKnowledgePolicy(knowledge); setKnowledgePreview(knowledgePreviewResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleTool = async (toolId: string, checked: boolean) => {
    if (!toolPolicy || !toolPreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(toolPreview.tools.filter((row) => row.selected).map((row) => row.tool_id));
      if (checked) current.add(toolId); else current.delete(toolId);
      await desktopApi.updateMyDrSaiAgentToolPolicy(agentId, { ...toolPolicy, mode: "explicit", enabled: [...current], disabled: [], expected_revision: toolPolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const toggleSkill = async (skillId: string, checked: boolean) => {
    if (!skillPolicy || !skillPreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(skillPreview.enabled_ids);
      if (checked) current.add(skillId); else current.delete(skillId);
      await desktopApi.updateMyDrSaiAgentSkillPolicy(agentId, { ...skillPolicy, mode: "explicit", enabled: [...current], disabled: [], expected_revision: skillPolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const toggleKnowledge = async (knowledgeId: string, checked: boolean) => {
    if (!knowledgePolicy || !knowledgePreview) return;
    setBusy(true); setError(null);
    try {
      const current = new Set(knowledgePreview.sources);
      if (checked) current.add(knowledgeId); else current.delete(knowledgeId);
      await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, mode: "explicit", sources: [...current], expected_revision: knowledgePolicy.revision });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  return <section className="settings-section agent-resource-settings" data-testid="agent-resource-settings">
    <div><h2>{zh ? "感知、工具、技能与知识库" : "Perception, tools, skills, and knowledge"}</h2><p>{zh ? "配置智能体感知外部世界并真正进入运行时的资源。" : "Configure external perception and the resources that enter this Agent's runtime."}</p></div>
    <div className="agent-configuration-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "perception"} className={tab === "perception" ? "active" : ""} onClick={() => setTab("perception")}>{zh ? "感知" : "Perception"}</button>
      <button type="button" role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")}>{zh ? "工具" : "Tools"}</button>
      <button type="button" role="tab" aria-selected={tab === "skills"} className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>{zh ? "技能" : "Skills"}</button>
      <button type="button" role="tab" aria-selected={tab === "knowledge"} className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}>{zh ? "知识库" : "Knowledge"}</button>
      <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {tab === "perception" && <div role="tabpanel" data-testid="agent-perception-settings">
      <div className="settings-row">
        <span><strong>{zh ? "可用感知器资源" : "Available perceptor resources"}</strong><small>{zh ? "连接地址和凭据由全局感知器配置管理；这里仅展示当前智能体可引用的资源和运行时能力。" : "Global Perceptor configuration owns endpoints and credentials; this view only shows resources and runtime capabilities available for Agent binding."}</small></span>
        <button type="button" onClick={onManagePerceptors} disabled title={settingsPaneUnavailableReason("perceptors", zh) ?? undefined}>{zh ? "管理感知器资源" : "Manage perceptors"}</button>
      </div>
      {perceptors.map((perceptor) => <div className="settings-row" key={perceptor.perceptor_id} data-testid={`perceptor-${perceptor.perceptor_id}`}>
        <span><strong>{perceptor.name || perceptor.perceptor_id}</strong><small>{perceptor.adapter} · {perceptor.capabilities.join(", ")}</small><span className="perceptor-runtime-status">
          <em className={perceptor.adapter === "hai_managed_tavily" || perceptor.config.api_key ? "ok" : "warning"}>{perceptor.adapter === "hai_managed_tavily" ? (zh ? "平台托管" : "Platform managed") : perceptor.config.api_key ? (zh ? "已配置" : "Configured") : (zh ? "缺少凭据" : "Credential required")}</em>
          <em className={perceptor.enabled ? "ok" : "muted"}>{perceptor.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已禁用" : "Disabled")}</em>
          <em className={(toolPreview?.tools ?? []).some((tool) => tool.tool_id === "builtin.web-search" && tool.selected) ? "ok" : "warning"}>{(toolPreview?.tools ?? []).some((tool) => tool.tool_id === "builtin.web-search" && tool.selected) ? (zh ? "当前智能体已加载" : "Loaded by this Agent") : (zh ? "当前智能体未加载" : "Not loaded by this Agent")}</em>
        </span></span>
      </div>)}
      {!busy && perceptors.length === 0 && <p>{zh ? "当前运行时未提供感知器接口，感知器资源暂不可用；工具、技能与知识库不受影响。" : "This runtime does not expose the Perceptor API yet, so perceptor resources are unavailable. Tools, skills, and knowledge keep working."}</p>}
    </div>}
    {tab === "tools" && <div role="tabpanel">
      {(toolPreview?.tools ?? []).map((tool) => <div className="settings-toggle" key={tool.tool_id} data-testid={`agent-tool-${tool.tool_id}`}>
        <span><strong>{agentToolLabel(tool.tool_id, zh)}</strong><small>{agentToolStatusLabel(tool.status, zh)}{tool.error ? ` · ${tool.error}` : ""}</small></span>
        <div className="settings-model-control"><button type="button" disabled={busy || ["unsupported_platform", "runtime_unavailable"].includes(tool.status)} onClick={async () => { try { setBusy(true); setError(null); await desktopApi.testAgentTool(tool.tool_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "测试" : "Test"}</button><input aria-label={agentToolLabel(tool.tool_id, zh)} type="checkbox" checked={tool.selected} disabled={busy || ["unsupported_platform", "runtime_unavailable"].includes(tool.status)} onChange={(event) => void toggleTool(tool.tool_id, event.target.checked)} /></div>
      </div>)}
      {!busy && (toolPreview?.tools.length ?? 0) === 0 && <p>{zh ? "没有可配置工具。" : "No configurable tools."}</p>}
    </div>}
    {tab === "skills" && <div role="tabpanel">
      {(skillPreview?.skills ?? []).map((skill) => <label className="settings-toggle" key={skill.name} data-testid={`agent-skill-${skill.name}`}>
        <span><strong>{skill.name}</strong><small>{skill.description || (zh ? "已安装技能" : "Installed skill")}</small></span>
        <input type="checkbox" checked={skill.enabled_for_agent} disabled={busy} onChange={(event) => void toggleSkill(skill.name, event.target.checked)} />
      </label>)}
      {!busy && (skillPreview?.skills.length ?? 0) === 0 && <p>{zh ? "尚未安装技能，请前往技能广场。" : "No skills installed. Open Skills to install one."}</p>}
      {skillPolicy && <label className="settings-toggle"><span><strong>{zh ? "允许会话临时技能" : "Allow per-task skill overrides"}</strong><small>{zh ? "允许在输入框中为单次任务增加技能。" : "Allow the composer to add skills for one task."}</small></span><input type="checkbox" checked={skillPolicy.allow_thread_override} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentSkillPolicy(agentId, { ...skillPolicy, allow_thread_override: event.target.checked, expected_revision: skillPolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }} /></label>}
    </div>}
    {tab === "knowledge" && <div role="tabpanel">
      <div className="settings-row agent-knowledge-create">
        <span><strong>{zh ? "添加知识库" : "Add Knowledge Base"}</strong><small>{zh ? "本地路径建立 SQLite 索引；RAGFlow 使用远程数据集。" : "Local paths use a SQLite index; RAGFlow uses a remote dataset."}</small></span>
        <div className="settings-model-control">
          <input aria-label={zh ? "知识库 ID" : "Knowledge Base ID"} placeholder="product-docs" value={knowledgeDraft.id} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, id: event.target.value }))} />
          <input aria-label={zh ? "知识库名称" : "Knowledge Base name"} placeholder={zh ? "产品文档" : "Product docs"} value={knowledgeDraft.name} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, name: event.target.value }))} />
          <select value={knowledgeDraft.type} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, type: event.target.value as "local-files" | "ragflow" }))}><option value="local-files">Local files</option><option value="ragflow">RAGFlow</option></select>
          <input aria-label={knowledgeDraft.type === "local-files" ? (zh ? "根目录" : "Root path") : "RAGFlow URL"} placeholder={knowledgeDraft.type === "local-files" ? "C:\\workspace\\docs" : "https://rag.example.com"} value={knowledgeDraft.location} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, location: event.target.value }))} />
          {knowledgeDraft.type === "ragflow" && <><input aria-label="RAGFlow dataset ID" placeholder="dataset-id" value={knowledgeDraft.dataset} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, dataset: event.target.value }))} /><input aria-label="RAGFlow token" type="password" autoComplete="off" placeholder="Token" value={knowledgeDraft.credential} onChange={(event) => setKnowledgeDraft((value) => ({ ...value, credential: event.target.value }))} /></>}
          <button type="button" disabled={busy || !knowledgeDraft.id || !knowledgeDraft.name || !knowledgeDraft.location} onClick={async () => { try { setBusy(true); setError(null); await desktopApi.createKnowledgeBase({ knowledge_id: knowledgeDraft.id, display_name: knowledgeDraft.name, type: knowledgeDraft.type, enabled: true, config: knowledgeDraft.type === "local-files" ? { root_path: knowledgeDraft.location, paths: ["."], chunk_size: 800, chunk_overlap: 120 } : { base_url: knowledgeDraft.location, dataset_ids: [knowledgeDraft.dataset] }, ...(knowledgeDraft.credential ? { credential: knowledgeDraft.credential } : {}) }); setKnowledgeDraft({ id: "", name: "", type: "local-files", location: "", dataset: "", credential: "" }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "添加" : "Add"}</button>
        </div>
      </div>
      {(knowledgePreview?.knowledge_bases ?? []).map((knowledge) => <div className="settings-row" key={knowledge.knowledge_id} data-testid={`agent-knowledge-${knowledge.knowledge_id}`}>
        <span><strong>{knowledge.display_name}</strong><small>{knowledge.type} · {knowledge.status ?? "configured"}{knowledge.document_count !== undefined ? ` · ${knowledge.document_count} docs / ${knowledge.chunk_count ?? 0} chunks` : ""}</small></span>
        <div className="settings-model-control">
          {knowledge.type === "local-files" && <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.indexKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "建立索引" : "Index"}</button>}
          <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.testKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "测试连接" : "Test"}</button>
          <input aria-label={`${knowledge.display_name} ${zh ? "检索测试" : "search preview"}`} placeholder={zh ? "输入检索问题" : "Search query"} value={knowledgeQuery[knowledge.knowledge_id] ?? ""} onChange={(event) => setKnowledgeQuery((value) => ({ ...value, [knowledge.knowledge_id]: event.target.value }))} />
          <button type="button" disabled={busy || !(knowledgeQuery[knowledge.knowledge_id] ?? "").trim()} onClick={async () => { try { setBusy(true); setError(null); const result = await desktopApi.searchKnowledgeBase(knowledge.knowledge_id, knowledgeQuery[knowledge.knowledge_id] ?? ""); setKnowledgeEvidence((value) => ({ ...value, [knowledge.knowledge_id]: result.evidence })); setBusy(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}>{zh ? "检索" : "Search"}</button>
          {!knowledge.selected && <button type="button" disabled={busy} onClick={async () => { try { setBusy(true); await desktopApi.deleteKnowledgeBase(knowledge.knowledge_id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}><Trash2 size={14} />{zh ? "删除" : "Delete"}</button>}
          <input aria-label={knowledge.display_name} type="checkbox" checked={Boolean(knowledge.selected)} disabled={busy || knowledge.status === "credential_required"} onChange={(event) => void toggleKnowledge(knowledge.knowledge_id, event.target.checked)} />
        </div>
      </div>)}
      {Object.entries(knowledgeEvidence).map(([knowledgeId, rows]) => rows.length > 0 && <div className="settings-row" key={`evidence-${knowledgeId}`}><span><strong>{zh ? "检索证据" : "Search evidence"}</strong>{rows.map((row, index) => <small key={`${row.source}-${index}`}>{row.source} · {row.score.toFixed(3)}{row.content ? ` · ${row.content.slice(0, 160)}` : ""}</small>)}</span></div>)}
      {!busy && (knowledgePreview?.knowledge_bases.length ?? 0) === 0 && <p>{zh ? "尚未配置知识库。" : "No Knowledge Base configured."}</p>}
      {knowledgePolicy && <>
        <div className="settings-row"><span><strong>{zh ? "检索策略" : "Retrieval policy"}</strong></span><select value={knowledgePolicy.retrieval_policy} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, retrieval_policy: event.target.value as AgentKnowledgePolicy["retrieval_policy"], expected_revision: knowledgePolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }}><option value="auto">Auto</option><option value="always">Always</option><option value="never">Never</option></select></div>
        <label className="settings-toggle"><span><strong>{zh ? "要求引用" : "Require citations"}</strong><small>{zh ? "知识库回答必须保留来源证据。" : "Knowledge-grounded answers must retain source evidence."}</small></span><input type="checkbox" checked={knowledgePolicy.require_citations} disabled={busy} onChange={async (event) => { try { setBusy(true); await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, { ...knowledgePolicy, require_citations: event.target.checked, expected_revision: knowledgePolicy.revision }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } }} /></label>
      </>}
    </div>}
  </section>;
}

export function SettingsPanel({
  modelSettings,
  agents,
  appearance,
  codexStatus,
  approvalCenterPanel,
  channelsPanel,
  dataPerceptorsPanel,
  featureCapabilities,
  completionNotifications,
  defaultThinkingEffort,
  developerMode,
  developerModeAvailable,
  health,
  ideContext,
  language,
  models,
  mobilePairingRefreshToken,
  myDrSaiConfig,
  myDrSaiAgentModelPolicy,
  agentConfigurations,
  onCheckUpdates,
  onCodexRefresh,
  onCodexRestart,
  onCodexRepair,
  onCodexLogin,
  onCodexLogout,
  onUseCodex,
  onAppearanceChange,
  onCompletionNotificationsChange,
  onCopyDiagnostics,
  onDeveloperModeChange,
  onExportLocalData,
  onLanguageChange,
  onLogout,
  onNewAgentTask,
  onOpenMobilePairing,
  onOpenBrowserPanel,
  onOpenPath,
  onResetPreferences,
  onRestoreLastSessionChange,
  onRestoreLastWorkspaceChange,
  onRightSidebarComponentsChange,
  onConfigureAgentModel,
  onSaveAgentModelPolicy,
  onRefreshAgentModels,
  onSessionScopeChange,
  onArchiveThread,
  archivedThreadsHasMore,
  archivedThreadsLoading,
  onLoadArchivedThreads,
  workspaces,
  onSyncWorkspaceSessions,
  onSidebarComponentsChange,
  onConfigureAgentThinkingEffort,
  onWorkspaceSortModeChange,
  onUpdateAgentConfig,
  onModelConnectionUpdated,
  restoreLastSession,
  restoreLastWorkspace,
  rightSidebarComponents,
  selectedAgentId,
  selectedModel,
  sessionScope,
  sidebarComponents,
  threads,
  updateBusy,
  updateMessage,
  usageAnalyticsPanel,
  user,
  workspaceSortMode,
}: {
  modelSettings: ModelSettingsDraftController;
  agents: DesktopAgent[];
  appearance: AppearanceMode;
  codexStatus: CodexBackendStatus | null;
  approvalCenterPanel: React.ReactNode;
  channelsPanel: React.ReactNode;
  dataPerceptorsPanel: React.ReactNode;
  featureCapabilities?: DesktopPlatformDescriptor["capabilities"]["features"];
  completionNotifications: boolean;
  defaultThinkingEffort: ThinkingEffort;
  developerMode: boolean;
  developerModeAvailable: boolean;
  health: DesktopHealth | null;
  ideContext: DesktopIdeContextSnapshot | null;
  language: AppLanguage;
  models: MyDrSaiModelConfig[];
  mobilePairingRefreshToken: number;
  myDrSaiConfig: MyDrSaiConfig | null;
  myDrSaiAgentModelPolicy: MyDrSaiAgentModelPolicy | null;
  agentConfigurations: Record<string, AgentConfigurationPreference>;
  onCheckUpdates: () => void;
  onCodexRefresh: () => void | Promise<void>;
  onCodexRestart: () => void | Promise<void>;
  onCodexRepair: () => void | Promise<void>;
  onCodexLogin: (type: "chatgpt" | "chatgptDeviceCode") => Promise<CodexBackendLogin>;
  onCodexLogout: () => void | Promise<void>;
  onUseCodex: () => void | Promise<void>;
  onAppearanceChange: (appearance: AppearanceMode) => void;
  onCompletionNotificationsChange: (enabled: boolean) => void;
  onCopyDiagnostics: () => void;
  onDeveloperModeChange: (enabled: boolean) => void;
  onExportLocalData: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => Promise<void>;
  onNewAgentTask: () => void;
  onOpenMobilePairing: () => void;
  onOpenBrowserPanel: () => void;
  onOpenPath: (path: string) => void;
  onResetPreferences: () => void;
  onRestoreLastSessionChange: (enabled: boolean) => void;
  onRestoreLastWorkspaceChange: (enabled: boolean) => void;
  onRightSidebarComponentsChange: React.Dispatch<React.SetStateAction<RightSidebarComponentVisibility>>;
  onConfigureAgentModel: (agentId: string, model: string, providerId?: string) => void;
  onSaveAgentModelPolicy: (agentId: string, draft: AgentModelPolicyDraft) => Promise<void>;
  onRefreshAgentModels: () => void;
  onSessionScopeChange: (scope: "workspace" | "all") => void;
  onArchiveThread: (threadId: string, archived: boolean) => void | Promise<void>;
  archivedThreadsHasMore: boolean;
  archivedThreadsLoading: boolean;
  onLoadArchivedThreads: (reset?: boolean) => Promise<void>;
  workspaces: WorkspaceProject[];
  onSyncWorkspaceSessions: (workspace: WorkspaceProject) => void | Promise<void>;
  onSidebarComponentsChange: React.Dispatch<React.SetStateAction<SidebarComponentVisibility>>;
  onConfigureAgentThinkingEffort: (agentId: string, effort: ThinkingEffort) => void;
  onWorkspaceSortModeChange: (mode: WorkspaceSortMode) => void;
  onUpdateAgentConfig: (updates: { plan_mode?: boolean; workspace_enabled?: boolean }) => Promise<void>;
  onModelConnectionUpdated: (connection: MyDrSaiModelConnection) => void;
  restoreLastSession: boolean;
  restoreLastWorkspace: boolean;
  rightSidebarComponents: RightSidebarComponentVisibility;
  selectedAgentId: string | null;
  selectedModel: string | null;
  sessionScope: "workspace" | "all";
  sidebarComponents: SidebarComponentVisibility;
  threads: DesktopThread[];
  updateBusy: boolean;
  updateMessage: string | null;
  usageAnalyticsPanel: React.ReactNode;
  user: AuthUser | null;
  workspaceSortMode: WorkspaceSortMode;
}): React.JSX.Element {
  const {
    activePane, setActivePane,
    modelDraft, setModelDraft, providerDraft, setProviderDraft, baseUrlDraft, setBaseUrlDraft,
    anthropicBaseUrlDraft, setAnthropicBaseUrlDraft, geminiBaseUrlDraft, setGeminiBaseUrlDraft,
    apiKeyDraft, setApiKeyDraft, apiKeyEnvDraft, setApiKeyEnvDraft,
    wireApiDraft, setWireApiDraft, keySourceDraft, setKeySourceDraft,
    modelConfigBusy, setModelConfigBusy, modelConfigMessage, setModelConfigMessage,
    modelTestOutput, setModelTestOutput, modelConfigConflict, setModelConfigConflict,
    providerPendingDeletion, setProviderPendingDeletion, providerDeletePreflight, setProviderDeletePreflight,
    modelTestConfirmationOpen, setModelTestConfirmationOpen,
    modelDoctorResult, setModelDoctorResult, modelProviderPresets, setModelProviderPresets,
    activeModelProviderTab, setActiveModelProviderTab,
    recentOverflowModelProviderTab, setRecentOverflowModelProviderTab,
    discoveredModels, setDiscoveredModels, providerModelsDraft, setProviderModelsDraft,
    providerModelAliasesDraft, setProviderModelAliasesDraft,
    providerModelOperationsDraft, setProviderModelOperationsDraft,
    providerModelConfigsDraft, setProviderModelConfigsDraft,
    newProviderModelDraft, setNewProviderModelDraft,
  } = modelSettings;
  const zh = language === "zh";
  const [modelCapabilityResults, setModelCapabilityResults] = useState<Record<string, import("@shared/desktopApi").ModelCapabilityProbeResult>>({});
  const [runningModelCapability, setRunningModelCapability] = useState<string | null>(null);
  const [providerModelEditor, setProviderModelEditor] = useState<ProviderModelEditorDraft | null>(null);
  const [providerModelEditorBaseline, setProviderModelEditorBaseline] = useState("");
  const providerModelEditorDirty = providerModelEditor !== null && JSON.stringify(providerModelEditor) !== providerModelEditorBaseline;
  const [providerModelEditorError, setProviderModelEditorError] = useState<string | null>(null);
  const [addedProviderProtocols, setAddedProviderProtocols] = useState<Set<MyDrSaiModelApiProtocol>>(new Set());
  const [modelCenterTab, setModelCenterTab] = useState<"mine" | "official">("mine");
  const providerEntryInitializedRef = useRef(false);
  const [lastModelTestDraftFingerprint, setLastModelTestDraftFingerprint] = useState<string | null>(null);
  const selectedSettingsAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [activeAgentConfigurationTab, setActiveAgentConfigurationTab] = useState<AgentConfigurationTab>(() =>
    selectedSettingsAgent ? getAgentConfigurationTab(selectedSettingsAgent) : "opendrsai");
  const [agentConfigurationTabsExpanded, setAgentConfigurationTabsExpanded] = useState(false);
  const [androidPanelExpanded, setAndroidPanelExpanded] = useState(true);
  const [expandedIntegrationCard, setExpandedIntegrationCard] = useState<"codex" | "deepseek-harness" | null>(null);
  const [platformConfigurationAgentId, setPlatformConfigurationAgentId] = useState(() =>
    selectedSettingsAgent?.source === "remote" ? selectedSettingsAgent.id : "");
  const [agentModelPolicyDraft, setAgentModelPolicyDraft] = useState<AgentModelPolicyDraft | null>(() =>
    myDrSaiAgentModelPolicy ? createAgentModelPolicyDraft(myDrSaiAgentModelPolicy) : null);
  const [agentModelPolicyDirty, setAgentModelPolicyDirty] = useState(false);
  const [agentModelPolicySaving, setAgentModelPolicySaving] = useState(false);
  const [agentModelPolicyMessage, setAgentModelPolicyMessage] = useState<string | null>(null);
  const openDrSaiConfigurationAgent = agents.find((agent) => agent.source === "local" && agent.id !== "my-codex");
  const codexConfigurationAgent = agents.find((agent) => agent.id === "my-codex");
  const deepSeekHarnessAgent = agents.find((agent) => /deepseek[ -]?harness/i.test(`${agent.id} ${agent.name}`));
  const platformConfigurationAgents = agents.filter((agent) => agent.source === "remote");
  const platformConfigurationAgent = platformConfigurationAgents.find((agent) => agent.id === platformConfigurationAgentId)
    ?? platformConfigurationAgents[0];
  const activeConfigurationAgent = activeAgentConfigurationTab === "opendrsai"
    ? openDrSaiConfigurationAgent
    : activeAgentConfigurationTab === "codex"
      ? codexConfigurationAgent
      : platformConfigurationAgent;
  const configurationAgents = [
    openDrSaiConfigurationAgent,
    codexConfigurationAgent,
    ...platformConfigurationAgents,
  ].filter((agent): agent is DesktopAgent => Boolean(agent));
  const compactConfigurationAgents = configurationAgents.slice(0, 3);
  if (activeConfigurationAgent && !compactConfigurationAgents.some((agent) => agent.id === activeConfigurationAgent.id)) {
    compactConfigurationAgents[Math.max(0, compactConfigurationAgents.length - 1)] = activeConfigurationAgent;
  }
  const visibleConfigurationAgents = agentConfigurationTabsExpanded
    ? configurationAgents
    : compactConfigurationAgents;
  const selectConfigurationAgent = (agent: DesktopAgent): void => {
    const tab = getAgentConfigurationTab(agent);
    setActiveAgentConfigurationTab(tab);
    if (tab === "platform") setPlatformConfigurationAgentId(agent.id);
  };
  const activeAgentPreference = activeConfigurationAgent ? agentConfigurations[activeConfigurationAgent.id] : undefined;
  const activeAgentModels = getAgentModelOptions(
    models, activeConfigurationAgent, activeAgentPreference?.model ?? null, activeAgentPreference?.modelRef,
  );
  const draftPrimaryModelRef = agentModelPolicyDraft?.primary_model.mode === "explicit"
    ? agentModelPolicyDraft.primary_model.ref
    : undefined;
  const displayedPrimaryModelRef = draftPrimaryModelRef || activeAgentPreference?.modelRef;
  const activeAgentModel = activeAgentConfigurationTab === "opendrsai" && displayedPrimaryModelRef
    ? `${encodeURIComponent(displayedPrimaryModelRef.provider_id)}::${encodeURIComponent(displayedPrimaryModelRef.model_id)}`
    : activeAgentPreference?.model || activeConfigurationAgent?.model || activeConfigurationAgent?.models?.[0]
      || (activeAgentConfigurationTab === "opendrsai" ? "" : DEFAULT_AGENT_TEXT_MODEL);
  const activeAgentThinkingEffort = activeAgentConfigurationTab === "opendrsai" && agentModelPolicyDraft?.reasoning_effort
    ? agentModelPolicyDraft.reasoning_effort
    : activeAgentPreference?.thinkingEffort
    ?? (activeConfigurationAgent?.id === selectedAgentId ? defaultThinkingEffort : "medium");
  const activeAgentModelDescriptor = activeAgentConfigurationTab === "opendrsai"
    ? activeAgentModels.find((model) => model.provider_id === displayedPrimaryModelRef?.provider_id && model.alias === displayedPrimaryModelRef?.model_id)
      ?? activeAgentModels.find((model) => model.alias === activeAgentPreference?.model)
    : undefined;
  const activeAgentModelGroups = activeAgentModels.reduce<Record<string, MyDrSaiModelConfig[]>>((groups, model) => {
    const provider = model.provider_id || (zh ? "其他来源" : "Other sources");
    (groups[provider] ??= []).push(model);
    return groups;
  }, {});
  const activeAgentModelUnavailable = activeAgentConfigurationTab === "opendrsai"
    && activeAgentModelDescriptor
    && !isSelectableModelAvailability(activeAgentModelDescriptor.availability);
  const activeAgentModelProvider = activeAgentConfigurationTab === "opendrsai"
    ? displayedPrimaryModelRef?.provider_id || activeAgentModelDescriptor?.provider_id
    : undefined;
  const modelCatalogState = myDrSaiConfig?.modelCatalog?.state
    ?? (myDrSaiConfig?.ready ? (models.length ? "fresh" : "empty") : "offline");
  const activeAgentThinkingEfforts: ThinkingEffort[] = activeAgentConfigurationTab === "opendrsai"
    ? activeAgentModelDescriptor?.operations?.includes("reasoning")
      ? (activeAgentModelDescriptor.reasoning_efforts ?? [])
      : []
    : ["low", "medium", "high", "xhigh", "max"];
  const selectableCapabilityModels = (input: MyDrSaiModelModality, output: MyDrSaiModelModality) => models.filter((model) =>
    model.provider_id
      && ["available", "configured_unverified"].includes(model.availability ?? "")
      && model.input_modalities?.includes(input)
      && model.output_modalities?.includes(output),
  );
  const selectableRealtimeVoiceModels = models.filter((model) =>
    model.provider_id
      && ["available", "configured_unverified"].includes(model.availability ?? "")
      && ((model.input_modalities?.includes("audio") && model.output_modalities?.includes("audio"))
        || model.alias.toLowerCase().split("/").at(-1)?.startsWith("gpt-realtime")),
  );
  const capabilityModelSettings: Array<{
    role: AgentCapabilityModelRole;
    testId: string;
    label: string;
    description: string;
    models: MyDrSaiModelConfig[];
    selection: AgentModelSelection | null | undefined;
  }> = [
    { role: "image_understanding_model", testId: "agent-image-understanding-model-setting", label: zh ? "图像理解" : "Image understanding", description: zh ? "接收图片并输出文字理解结果。" : "Accepts images and returns a text understanding.", models: selectableCapabilityModels("image", "text"), selection: agentModelPolicyDraft?.image_understanding_model },
    { role: "image_generation_model", testId: "agent-image-generation-model-setting", label: zh ? "图像生成" : "Image generation", description: zh ? "选定主模型后，可再选择图像生成模型；系统有默认值，也可手动切换。根据文字或图片生成图像。" : "After the primary model, pick an image-generation model (system default available; you can switch). Generates images from text or image input.", models: models.filter((model) => Boolean(model.provider_id) && supportsImageGenerationModel(model)), selection: agentModelPolicyDraft?.image_generation_model },
    { role: "text_to_speech_model", testId: "agent-text-to-speech-model-setting", label: zh ? "文字转语音" : "Text to speech", description: zh ? "将文字合成为语音。" : "Synthesizes speech from text.", models: selectableCapabilityModels("text", "audio"), selection: agentModelPolicyDraft?.text_to_speech_model },
    { role: "realtime_voice_model", testId: "agent-realtime-voice-model-setting", label: zh ? "实时" : "Realtime", description: zh ? "用于全双工实时语音输入与输出。" : "Handles full-duplex realtime voice input and output.", models: selectableRealtimeVoiceModels, selection: agentModelPolicyDraft?.realtime_voice_model },
    { role: "speech_to_text_model", testId: "agent-speech-to-text-model-setting", label: zh ? "语音转文字" : "Speech to text", description: zh ? "将语音识别为文字。" : "Transcribes speech into text.", models: selectableCapabilityModels("audio", "text"), selection: agentModelPolicyDraft?.speech_to_text_model },
  ];
  useEffect(() => {
    if (!myDrSaiAgentModelPolicy) return;
    setAgentModelPolicyDraft(createAgentModelPolicyDraft(myDrSaiAgentModelPolicy));
    setAgentModelPolicyDirty(false);
  }, [myDrSaiAgentModelPolicy?.agent_id, myDrSaiAgentModelPolicy?.revision]);
  useEffect(() => {
    if (!selectedSettingsAgent) return;
    const tab = getAgentConfigurationTab(selectedSettingsAgent);
    setActiveAgentConfigurationTab(tab);
    if (tab === "platform") setPlatformConfigurationAgentId(selectedSettingsAgent.id);
  }, [selectedAgentId, selectedSettingsAgent?.id, selectedSettingsAgent?.source]);
  const [voiceIntegrationState, setVoiceIntegrationState] = useState<string | null>(null);
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences();
  const [voiceRuntimeStatus, setVoiceRuntimeStatus] = useState<DesktopVoiceRuntimeStatus | null>(null);
  const [duplexVoiceReadiness, setDuplexVoiceReadiness] = useState<DesktopDuplexVoiceReadiness | null>(null);
  const [duplexVoiceReadinessBusy, setDuplexVoiceReadinessBusy] = useState(false);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [realtimeAudioDevices, setRealtimeAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [remoteHostCount, setRemoteHostCount] = useState<number | null>(null);
  const [mobilePairingReadiness, setMobilePairingReadiness] = useState<DesktopMobilePairingReadiness | null>(null);
  const [mobileAssociations, setMobileAssociations] = useState<DesktopMobileAssociation[]>([]);
  const [mobileAssociationsState, setMobileAssociationsState] = useState<AndroidDeviceLoadState>("idle");
  const [mobileEnrollmentBusy, setMobileEnrollmentBusy] = useState(false);
  const [mobileEnrollmentError, setMobileEnrollmentError] = useState<string | null>(null);
  const [mobileScopeEditor, setMobileScopeEditor] = useState<(
    MobileAssociationScopeEditorState & { association: DesktopMobileAssociation }
  ) | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigMessage, setAgentConfigMessage] = useState<string | null>(null);
  const [modelCapabilityStatus, setModelCapabilityStatus] = useState<AgentModelCapabilityStatus | null>(null);
  const [modelCapabilityStatusError, setModelCapabilityStatusError] = useState<string | null>(null);
  const [modelCapabilityStatusBusy, setModelCapabilityStatusBusy] = useState(false);
  const refreshModelCapabilityStatus = useCallback(async () => {
    setModelCapabilityStatusBusy(true);
    setModelCapabilityStatusError(null);
    try {
      setModelCapabilityStatus(await desktopApi.getMyDrSaiAgentModelCapabilityStatus(openDrSaiConfigurationAgent?.id));
    } catch (error) {
      const friendly = describeUserFacingError(error, language);
      setModelCapabilityStatusError(`${friendly.title} ${friendly.action}`);
    } finally {
      setModelCapabilityStatusBusy(false);
    }
  }, [language, openDrSaiConfigurationAgent?.id]);
  useEffect(() => {
    if (activePane === "agent-defaults" && activeAgentConfigurationTab === "opendrsai") void refreshModelCapabilityStatus();
  }, [activeAgentConfigurationTab, activePane, refreshModelCapabilityStatus]);
  const effectiveModelProviderPresets = useMemo(() => {
    const byId = new Map(BUILTIN_MODEL_PROVIDER_PRESETS.map((preset) => [preset.id, preset]));
    for (const preset of modelProviderPresets) {
      const fallback = byId.get(preset.id);
      byId.set(preset.id, fallback ? { ...fallback, ...preset, label: fallback.label } : preset);
    }
    return [...byId.values()];
  }, [modelProviderPresets]);
  const [cleanupPreview, setCleanupPreview] = useState<DesktopDataCleanupPreview | null>(null);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [archiveSearch, setArchiveSearch] = useState("");
  const archivedThreads = threads.filter((thread) => thread.archived).filter((thread) =>
    thread.title.toLocaleLowerCase().includes(archiveSearch.trim().toLocaleLowerCase()),
  );
  const archivedInitialLoadRequestedRef = useRef(false);
  useEffect(() => {
    if (activePane !== "archived-sessions" || archivedInitialLoadRequestedRef.current) return;
    archivedInitialLoadRequestedRef.current = true;
    void onLoadArchivedThreads(true).catch(() => { archivedInitialLoadRequestedRef.current = false; });
  }, [activePane]);

  const modelProviderInventory = myDrSaiConfig?.modelConnection?.providers
    ?? myDrSaiConfig?.modelProviders
    ?? [];
  const modelCenterRuntime = useMemo(() => models.flatMap((model) => {
    const providerId = model.provider_id;
    const modelId = model.model;
    if (!providerId || !modelId) return [];
    return [{
      ref: { provider_id: providerId, model_id: modelId },
      display_name: model.display_name || model.alias || modelId,
      input_modalities: model.input_modalities ?? [],
      output_modalities: model.output_modalities ?? [],
      operations: model.operations ?? [],
      reasoning_efforts: model.reasoning_efforts ?? [],
      token_limit: model.token_limit,
      max_output_tokens: model.max_tokens,
      availability: model.availability ?? "configured_unverified",
      capability_source: model.capability_source ?? "unknown",
      capability_confidence: "unknown" as const,
      origin: model.origin,
    }];
  }), [models]);
  const directModels = useMemo(
    () => aggregateDirectModels(modelProviderInventory, modelCenterRuntime),
    [modelProviderInventory, modelCenterRuntime],
  );
  // Initialize once, not on inventory/probe refresh: those must not erase a draft.
  useEffect(() => {
    if (activePane !== "model-providers" || providerEntryInitializedRef.current) return;
    providerEntryInitializedRef.current = true;
    if (!providerDraft) addCustomModelProvider();
  }, [activePane]);

  useEffect(() => {
    if (activePane === "model-providers" && !providerModelEditor) openProviderModelEditor(modelDraft);
  }, [activePane, providerDraft, modelDraft, providerModelEditor]);

  useEffect(() => {
    void desktopApi.listMyDrSaiModelProviderPresets().then(setModelProviderPresets).catch(() => setModelProviderPresets([]));
  }, []);

  function applyModelProviderPreset(presetId: string): void {
    const preset = effectiveModelProviderPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setModelDraft(preset.default_model || "");
    setProviderModelsDraft(preset.default_model ? [preset.default_model] : []);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft(preset.default_model ? { [preset.default_model]: providerModelConfigFor(preset.default_model, { wire_api: preset.wire_api }) } : {});
    setProviderDraft(preset.id.startsWith("custom-") ? "custom" : preset.id);
    setBaseUrlDraft(preset.base_url);
    setAnthropicBaseUrlDraft(preset.anthropic_base_url ?? "");
    setGeminiBaseUrlDraft(preset.google_base_url ?? "");
    setAddedProviderProtocols(new Set());
    setWireApiDraft(preset.wire_api);
    setKeySourceDraft(preset.requires_api_key ? "secure" : "none");
    setApiKeyDraft("");
    setApiKeyEnvDraft("");
    setDiscoveredModels([]);
  }

  function selectModelProviderTab(presetId: string, connection = myDrSaiConfig?.modelConnection): void {
    setActiveModelProviderTab(presetId);
    setNewProviderModelDraft(null);
    if (!["hepai", "deepseek", "openai", "anthropic"].includes(presetId)) setRecentOverflowModelProviderTab(presetId);
    setModelConfigMessage(null);
    setModelTestOutput(null);
    setModelConfigConflict(false);
    setDiscoveredModels([]);
    const preset = effectiveModelProviderPresets.find((item) => item.id === presetId);
    if (connection?.model_provider === presetId) {
      setModelDraft(connection.model);
      setProviderDraft(connection.model_provider);
      setBaseUrlDraft(connection.provider.base_url);
      setAnthropicBaseUrlDraft(connection.provider.anthropic_base_url ?? "");
      setGeminiBaseUrlDraft(connection.provider.google_base_url ?? "");
      setAddedProviderProtocols(new Set());
      setWireApiDraft(connection.provider.wire_api);
      setKeySourceDraft(connection.provider.requires_api_key ? (connection.provider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
      setApiKeyDraft("");
      setApiKeyEnvDraft(connection.provider.api_key_source?.startsWith("env:") ? connection.provider.api_key_source.slice(4) : "");
      const configuredModels = providerDraftModels(connection.provider, [connection.model]);
      setProviderModelsDraft(configuredModels);
      setProviderModelAliasesDraft(connection.provider.model_aliases ?? {});
      setProviderModelOperationsDraft(connection.provider.model_operations ?? {});
      setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, connection.provider));
      return;
    }
    const configuredProvider = (connection?.providers ?? modelProviderInventory).find((provider) => provider.name === presetId);
    if (configuredProvider) {
      const configuredModels = providerDraftModels(configuredProvider, preset?.default_model ? [preset.default_model] : []);
      setModelDraft(configuredModels[0] ?? "");
      setProviderDraft(configuredProvider.name);
      setBaseUrlDraft(configuredProvider.base_url);
      setAnthropicBaseUrlDraft(configuredProvider.anthropic_base_url ?? "");
      setGeminiBaseUrlDraft(configuredProvider.google_base_url ?? "");
      setAddedProviderProtocols(new Set());
      setWireApiDraft(configuredProvider.wire_api);
      setKeySourceDraft(configuredProvider.requires_api_key ? (configuredProvider.api_key_source?.startsWith("env:") ? "env" : "secure") : "none");
      setApiKeyDraft("");
      setApiKeyEnvDraft(configuredProvider.api_key_source?.startsWith("env:") ? configuredProvider.api_key_source.slice(4) : "");
      setProviderModelsDraft(configuredModels);
      setProviderModelAliasesDraft(configuredProvider.model_aliases ?? {});
      setProviderModelOperationsDraft(configuredProvider.model_operations ?? {});
      setProviderModelConfigsDraft(providerModelConfigsFor(configuredModels, configuredProvider));
      return;
    }
    applyModelProviderPreset(presetId);
  }

  function addCustomModelProvider(): void {
    setProviderModelEditor(null);
    setActiveModelProviderTab("__new-custom-provider__");
    const names = new Set(modelProviderInventory.map((provider) => provider.name));
    if (myDrSaiConfig?.modelConnection) names.add(myDrSaiConfig.modelConnection.provider.name);
    let name = "custom";
    for (let suffix = 2; names.has(name); suffix += 1) name = `custom-${suffix}`;
    setProviderDraft(name);
    setModelDraft("");
    setBaseUrlDraft("");
    setAnthropicBaseUrlDraft("");
    setGeminiBaseUrlDraft("");
    setAddedProviderProtocols(new Set());
    setWireApiDraft("openai");
    setKeySourceDraft("secure");
    setApiKeyDraft("");
    setApiKeyEnvDraft("");
    setDiscoveredModels([]);
    setProviderModelsDraft([]);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft({});
    setNewProviderModelDraft(null);
    setModelConfigMessage(null);
    setModelTestOutput(null);
    setModelConfigConflict(false);
  }

  async function navigateModelProvider(id: string): Promise<void> {
    if (modelConfigBusy || runningModelCapability || id === activeModelProviderTab) return;
    if (newProviderModelDraft?.trim() || (modelProviderDirty && (baseUrlDraft.trim() || apiKeyDraft.trim() || providerModelsDraft.length))) {
      const confirmed = await requestAppDecision({
        id: "switch-model-provider-draft",
        title: zh ? "放弃未保存的提供方草稿？" : "Discard unsaved provider draft?",
        description: zh ? "切换提供方会丢弃当前草稿。取消后可先保存提供方。" : "Switching discards this draft. Cancel to save the provider first.",
        confirmLabel: zh ? "放弃并切换" : "Discard and switch",
      });
      if (!confirmed) return;
    }
    setLastModelTestDraftFingerprint(null);
    setProviderModelEditor(null);
    setModelCapabilityResults({});
    if (id === "__new-custom-provider__") addCustomModelProvider();
    else selectModelProviderTab(id);
  }

  function removeProviderModel(model: string): void {
    setProviderModelsDraft((current) => {
      const next = current.filter((item) => item !== model);
      if (modelDraft === model) setModelDraft(next[0] ?? "");
      return next;
    });
    setProviderModelAliasesDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
    setProviderModelOperationsDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
    setProviderModelConfigsDraft((current) => {
      const next = { ...current };
      delete next[model];
      return next;
    });
  }

  async function deleteSavedProviderModel(model: string, providerOverride?: string): Promise<void> {
    if (modelConfigBusy) return;
    if (modelProviderDirty) {
      setModelConfigMessage(zh ? "请先保存或放弃当前草稿，再删除已保存模型。" : "Save or discard the current draft before deleting a saved model.");
      return;
    }
    const provider = providerOverride?.trim() || providerDraft.trim();
    setModelConfigBusy(true);
    setModelConfigMessage(null);
    setModelConfigConflict(false);
    try {
      const preflight = await desktopApi.preflightMyDrSaiModelDeletion(provider, model);
      if (!preflight.can_delete) {
        const labels = preflight.references.map((reference) => reference.label).join(", ");
        setModelConfigMessage(zh ? `该模型仍被引用：${labels}` : `This model is still referenced by: ${labels}`);
        return;
      }
      const confirmed = await requestAppDecision({
        id: `delete-provider-model-${provider}-${model}`,
        tone: "danger",
        title: preflight.action === "disable"
          ? (zh ? `停用内置模型 ${model}？` : `Disable built-in model ${model}?`)
          : (zh ? `删除模型 ${model}？` : `Delete model ${model}?`),
        description: preflight.action === "disable"
          ? (zh ? "内置模型不会被物理删除，只会在此 Provider 中停用。" : "Built-in models are not physically deleted; this model will be disabled for this provider.")
          : (zh ? "只会删除此模型；Provider、其他模型、连接和凭据都会保留。" : "Only this model will be deleted. The provider, its other models, connection, and credentials are retained."),
        confirmLabel: preflight.action === "disable" ? (zh ? "停用模型" : "Disable model") : (zh ? "删除模型" : "Delete model"),
      });
      if (!confirmed) return;
      const result = await desktopApi.deleteMyDrSaiModel(provider, model, myDrSaiConfig?.modelConnection?.revision);
      const refreshed = await desktopApi.getMyDrSaiConfig();
      if (refreshed.modelConnection) {
        onModelConnectionUpdated(refreshed.modelConnection);
        selectModelProviderTab(provider, refreshed.modelConnection);
      } else {
        removeProviderModel(model);
      }
      onRefreshAgentModels();
      setModelConfigMessage(result.action === "disable"
        ? (zh ? "内置模型已停用。" : "Built-in model disabled.")
        : (zh ? "模型已删除；Provider、其他模型和凭据已保留。" : "Model deleted; provider, other models, and credentials were retained."));
    } catch (error) {
      const envelope = normalizeRuntimeErrorEnvelope(error);
      setModelConfigConflict(envelope.code === "config_conflict");
      setModelConfigMessage(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setModelConfigBusy(false);
    }
  }

  function openProviderModelEditor(model: string): void {
    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
    const editor: ProviderModelEditorDraft = {
      originalId: model,
      modelId: model,
      alias: config.alias ?? "",
      inputModalities: [...config.input_modalities],
      outputModalities: [...config.output_modalities],
      apiProtocol: config.api_protocol,
      enabled: config.enabled,
      capabilities: [...config.capabilities],
      tokenLimit: config.token_limit !== undefined && config.max_tokens !== undefined ? String(config.token_limit - config.max_tokens) : "",
      maxTokens: config.max_tokens !== undefined ? String(config.max_tokens) : "",
      reasoningEfforts: PROVIDER_REASONING_EFFORT_OPTIONS.filter((effort) => (config.reasoning_efforts ?? []).includes(effort)),
      origin: config.origin ?? null,
    };
    setProviderModelEditor(editor);
    setProviderModelEditorBaseline(JSON.stringify(editor));
    setProviderModelEditorError(null);
  }

  function duplicateProviderModel(model: string): void {
    if (providerModelEditorDirty && !saveProviderModelEditor()) return;
    const base = `${model}-copy`;
    let copyId = base;
    let suffix = 2;
    while (providerModelsDraft.some((candidate) => candidate.toLowerCase() === copyId.toLowerCase())) copyId = `${base}-${suffix++}`;
    const sourceIndex = providerModelsDraft.indexOf(model);
    const nextModels = [...providerModelsDraft];
    nextModels.splice(sourceIndex + 1, 0, copyId);
    setProviderModelsDraft((current) => [...current, copyId]);
    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
    const alias = config.alias ?? "";
    if (alias) setProviderModelAliasesDraft((current) => ({ ...current, [copyId]: alias }));
    const operations = [...(providerModelOperationsDraft[model] ?? [])];
    if (operations.length) setProviderModelOperationsDraft((current) => ({ ...current, [copyId]: operations }));
    // The copy is a brand-new user-owned entry, even when it was cloned from a
    // built-in model: that is the supported way to customise a Product model.
    const copiedConfig: MyDrSaiProviderModelConfig = { ...config, input_modalities: [...config.input_modalities], output_modalities: [...config.output_modalities], capabilities: [...config.capabilities], origin: "user" };
    setProviderModelConfigsDraft((current) => ({ ...current, [copyId]: copiedConfig }));
    setProviderModelEditor({ originalId: copyId, modelId: copyId, alias, inputModalities: [...copiedConfig.input_modalities], outputModalities: [...copiedConfig.output_modalities], apiProtocol: copiedConfig.api_protocol, enabled: copiedConfig.enabled, capabilities: [...copiedConfig.capabilities], tokenLimit: copiedConfig.token_limit !== undefined && copiedConfig.max_tokens !== undefined ? String(copiedConfig.token_limit - copiedConfig.max_tokens) : "", maxTokens: copiedConfig.max_tokens !== undefined ? String(copiedConfig.max_tokens) : "", reasoningEfforts: PROVIDER_REASONING_EFFORT_OPTIONS.filter((effort) => (copiedConfig.reasoning_efforts ?? []).includes(effort)), origin: "user" });
    setProviderModelEditorError(null);
  }

  // Build a synchronous snapshot. State setters must never be a save boundary.
  function currentModelSnapshot(): { id: string; models: Record<string, MyDrSaiProviderModelConfig> } {
    const editor = providerModelEditor;
    if (!editor) throw new Error(zh ? "请填写模型 ID。" : "Enter a model ID.");
    const original = providerModelConfigsDraft[editor.originalId];
    if (editor.origin === "product" && original) return { id: editor.originalId, models: { ...modelConfigsForSave(), [editor.originalId]: providerModelConfigForWrite({ ...original, enabled: editor.enabled }) } };
    const budget = directTokenBudget(editor.tokenLimit, editor.maxTokens);
    if (!editor.inputModalities.length || !editor.outputModalities.length) throw new Error(zh ? "请选择输入和输出模态。" : "Select input and output modalities.");
    const image = editor.capabilities.includes("image_generation");
    if (image && (editor.capabilities.some((capability) => ["chat", "tool_calling", "reasoning"].includes(capability)) || !editor.outputModalities.includes("image"))) throw new Error(zh ? "图像生成须输出 image，且不能混用对话能力。" : "Image generation must output images and cannot declare chat capabilities.");
    if (!image && editor.capabilities.includes("chat") && editor.outputModalities.includes("image")) throw new Error(zh ? "输出图像请切换为图像生成类型。" : "Select image generation to output images.");
    const protocolHasHost = editor.apiProtocol === wireApiDraft || (editor.apiProtocol === "anthropic" && anthropicBaseUrlDraft.trim()) || (editor.apiProtocol === "gemini" && geminiBaseUrlDraft.trim());
    if (!protocolHasHost) throw new Error(zh ? "请在高级连接设置中填写所选协议的主机，或更改主连接协议。" : "Set the selected protocol host in advanced connection settings, or change the primary connection protocol.");
    const { alias: _alias, reasoning_efforts: _efforts, ...metadata } = original ?? {};
    const config = providerModelConfigForWrite({ ...metadata,
      ...(editor.alias.trim() ? { alias: editor.alias.trim() } : {}),
      input_modalities: editor.inputModalities, output_modalities: editor.outputModalities,
      api_protocol: editor.apiProtocol, enabled: editor.enabled, capabilities: editor.capabilities, ...budget,
      ...(editor.reasoningEfforts.length && editor.capabilities.includes("reasoning") ? { reasoning_efforts: editor.reasoningEfforts } : {}),
    });
    const id = editor.modelId.trim();
    return { id, models: replaceDirectModel(modelConfigsForSave(), editor.originalId, id, config) };
  }

  function saveProviderModelEditor(): boolean {
    try {
      const snapshot = currentModelSnapshot();
      setProviderModelsDraft(Object.keys(snapshot.models));
      // Preserve read-only origin in local state; it is stripped only at the API boundary.
      setProviderModelConfigsDraft(Object.fromEntries(Object.entries(snapshot.models).map(([id, config]) => [id, { ...config, ...(providerModelConfigsDraft[id]?.origin ? { origin: providerModelConfigsDraft[id].origin } : {}) }])));
      setProviderModelAliasesDraft(Object.fromEntries(Object.entries(snapshot.models).flatMap(([id, config]) => config.alias ? [[id, config.alias]] : [])));
      setProviderModelOperationsDraft(Object.fromEntries(Object.entries(snapshot.models).map(([id, config]) => [id, config.capabilities.filter((capability) => capability === "image_generation" || capability === "image_edit")])));
      setProviderModelEditorError(null);
      return true;
    } catch (error) {
      setProviderModelEditorError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function switchDirectModel(model: string): void {
    if (providerModelEditorDirty && !saveProviderModelEditor()) return;
    setModelDraft(model);
    openProviderModelEditor(model);
  }

  function editAggregatedModel(entry: DirectModelEntry, copy = false, enabled = entry.config.enabled): void {
    const route = directModelRoute(entry);
    setModelCenterTab("official");
    // Provider identity remains internal: aggregate rows route directly to the
    // owning connection while the reused model form does not expose that ID.
    selectModelProviderTab(route.providerId);
    const configs = providerModelConfigsFor(providerDraftModels(entry.provider, [entry.modelId]), entry.provider);
    let id = route.modelId;
    let config = configs[id] ?? entry.config;
    if (copy) {
      const base = `${id}-copy`;
      id = base;
      for (let suffix = 2; configs[id]; suffix += 1) id = `${base}-${suffix}`;
      config = { ...config, origin: "user", input_modalities: [...config.input_modalities], output_modalities: [...config.output_modalities], capabilities: [...config.capabilities] };
    }
    const baseline: ProviderModelEditorDraft = {
      originalId: id, modelId: id, alias: config.alias ?? "",
      inputModalities: [...config.input_modalities], outputModalities: [...config.output_modalities],
      apiProtocol: config.api_protocol, enabled: config.enabled, capabilities: [...config.capabilities],
      tokenLimit: config.token_limit !== undefined && config.max_tokens !== undefined ? String(config.token_limit - config.max_tokens) : "",
      maxTokens: config.max_tokens !== undefined ? String(config.max_tokens) : "",
      reasoningEfforts: PROVIDER_REASONING_EFFORT_OPTIONS.filter((effort) => (config.reasoning_efforts ?? []).includes(effort)),
      origin: copy ? "user" : config.origin ?? null,
    };
    const editor = { ...baseline, enabled };
    configs[id] = { ...config, enabled };
    setProviderModelsDraft(Object.keys(configs));
    setProviderModelConfigsDraft(configs);
    setModelDraft(id);
    setProviderModelEditor(editor);
    setProviderModelEditorBaseline(copy ? "" : JSON.stringify(baseline));
    setProviderModelEditorError(null);
    if (copy) setModelConfigMessage(zh ? "副本已加入当前连接草稿；保存后才会生效。" : "Copy added to the current connection draft; save to apply it.");
  }

  function toggleAggregatedModel(entry: DirectModelEntry): void {
    editAggregatedModel(entry, false, !entry.config.enabled);
    setModelConfigMessage(zh ? "启用状态已进入草稿，请保存。" : "Enabled state changed in the draft; save to apply.");
  }
  function setDirectModelType(image: boolean): void {
    setProviderModelEditor((current) => current ? { ...current,
      capabilities: image ? ["image_generation"] : ["chat"],
      inputModalities: ["text"], outputModalities: image ? ["image"] : ["text"], reasoningEfforts: [],
    } : current);
  }

  function toggleProviderModelEditorModality(direction: "input" | "output", modality: MyDrSaiModelModality, enabled: boolean): void {
    setProviderModelEditor((current) => {
      if (!current) return current;
      const key = direction === "input" ? "inputModalities" : "outputModalities";
      const nextModalities = enabled ? [...new Set([...current[key], modality])] : current[key].filter((item) => item !== modality);
      const input = direction === "input" ? nextModalities : current.inputModalities;
      const output = direction === "output" ? nextModalities : current.outputModalities;
      const capabilities = current.capabilities.filter((capability) => {
        if (capability === "image_generation") return output.includes("image");
        if (capability === "image_edit") return input.includes("image") && output.includes("image");
        if (capability === "speech_to_text") return input.includes("audio") && output.includes("text");
        if (capability === "text_to_speech") return input.includes("text") && output.includes("audio");
        if (capability === "video_generation") return output.includes("video");
        return true;
      });
      return { ...current, [key]: nextModalities, capabilities };
    });
  }

  function toggleProviderModelEditorCapability(capability: MyDrSaiModelCapability, enabled: boolean): void {
    setProviderModelEditor((current) => {
      if (!current) return current;
      const capabilities = enabled ? [...new Set([...current.capabilities, capability, ...(["tool_calling", "reasoning"].includes(capability) ? ["chat" as const] : [])])] : current.capabilities.filter((item) => item !== capability);
      const requiredInput: MyDrSaiModelModality[] = capability === "image_edit" ? ["image"] : capability === "speech_to_text" ? ["audio"] : capability === "text_to_speech" || ["chat", "tool_calling", "reasoning", "image_generation", "video_generation"].includes(capability) ? ["text"] : [];
      const requiredOutput: MyDrSaiModelModality[] = ["image_generation", "image_edit"].includes(capability) ? ["image"] : capability === "speech_to_text" || ["chat", "tool_calling", "reasoning"].includes(capability) ? ["text"] : capability === "text_to_speech" ? ["audio"] : capability === "video_generation" ? ["video"] : [];
      return { ...current, capabilities, inputModalities: enabled ? [...new Set([...current.inputModalities, ...requiredInput])] : current.inputModalities, outputModalities: enabled ? [...new Set([...current.outputModalities, ...requiredOutput])] : current.outputModalities, ...(capability === "reasoning" && !enabled ? { reasoningEfforts: [] } : {}) };
    });
  }

  function resetProviderModels(): void {
    const preset = effectiveModelProviderPresets.find((item) => item.id === activeModelProviderTab);
    const next = preset?.default_model ? [preset.default_model] : [];
    setProviderModelsDraft(next);
    setProviderModelAliasesDraft({});
    setProviderModelOperationsDraft({});
    setProviderModelConfigsDraft(next[0] ? { [next[0]]: providerModelConfigFor(next[0], { wire_api: preset?.wire_api ?? "openai" }) } : {});
    setModelDraft(next[0] ?? "");
    setDiscoveredModels([]);
    setNewProviderModelDraft(null);
  }

  async function discoverModels(): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const usesHepAiAccount = providerDraft.trim() === "hepai";
      const result = await desktopApi.discoverMyDrSaiProviderModels(providerDraft.trim(), true, {
        base_url: baseUrlDraft.trim(),
        ...(anthropicBaseUrlDraft.trim() ? { anthropic_base_url: anthropicBaseUrlDraft.trim() } : {}),
        ...(geminiBaseUrlDraft.trim() ? { google_base_url: geminiBaseUrlDraft.trim() } : {}),
        ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
        wire_api: wireApiDraft,
        requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
      });
      setDiscoveredModels(result.models);
      if (result.ok && result.models.length) {
        setProviderModelsDraft((current) => [...new Set([...current, ...result.models])]);
        setProviderModelConfigsDraft((current) => ({ ...Object.fromEntries(result.models.map((model) => [model, providerModelConfigFor(model, { wire_api: wireApiDraft })])), ...current }));
      }
      setModelConfigMessage(result.ok ? `${result.models.length} ${zh ? "个模型已发现；列表已加入草稿，尚未保存或验证调用" : "models discovered; added to draft, not saved or call-tested"}` : `${zh ? "模型发现失败，可继续手工输入" : "Discovery failed; manual model entry remains available"}: ${result.error || "unknown"}`);
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  function modelAliasesForSave(): Record<string, string> {
    return Object.fromEntries(providerModelsDraft.flatMap((model) => {
      const alias = providerModelAliasesDraft[model]?.trim();
      return alias && alias !== model ? [[model, alias]] : [];
    }));
  }

  function modelConfigsForSave(): Record<string, MyDrSaiProviderModelConfig> {
    return Object.fromEntries(providerModelsDraft.map((model) => {
      const inferredModalities = providerModelModalities(model, providerDraft, models, providerModelOperationsDraft[model] ?? []);
      const configured = providerModelConfigsDraft[model] ?? {
        ...(providerModelAliasesDraft[model]?.trim() ? { alias: providerModelAliasesDraft[model].trim() } : {}),
        input_modalities: inferredModalities.input,
        output_modalities: inferredModalities.output,
        api_protocol: wireApiDraft,
        enabled: true,
        capabilities: [...new Set([...defaultTextModelCapabilities(model), ...(providerModelOperationsDraft[model] ?? [])])],
      };
      return [model, providerModelConfigForWrite(configured)];
    }));
  }

  async function runModelDoctor(online = false): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const result = await desktopApi.diagnoseMyDrSaiModelConnection(online);
      setModelDoctorResult(result);
      setModelConfigMessage(result.ok
        ? (zh ? "模型配置检查完成，未发现阻断问题。" : "Model Doctor completed without blocking issues.")
        : (zh ? "模型配置需要处理，请查看检查结果。" : "Model configuration needs attention; review the checks below."));
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function restoreLastKnownGoodModelConnection(): Promise<void> {
    setModelConfigBusy(true); setModelConfigMessage(null); setModelConfigConflict(false);
    try {
      const connection = await desktopApi.restoreMyDrSaiModelConnection(myDrSaiConfig?.modelConnection?.revision);
      onModelConnectionUpdated(connection);
      setModelDoctorResult(null);
      setLastModelTestDraftFingerprint(null);
      setModelTestOutput(null);
      setModelCapabilityResults({});
      setModelConfigMessage(zh ? "已恢复最后一次可用的运行配置；当前编辑草稿已保留，不代表草稿已保存或通过测试。" : "Restored the last-known-good runtime configuration. Your editor draft is retained, not saved or verified by this recovery.");
    } catch (error) {
      const message = userFacingFailureMessage(error, language, "connection");
      setModelConfigConflict(normalizeRuntimeErrorEnvelope(error).code === "config_conflict");
      setModelConfigMessage(message);
    } finally { setModelConfigBusy(false); }
  }

  function modelProviderSetupIssue(requireModels = true): string | null {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerDraft.trim())) return zh ? "请在高级连接设置中填写提供方名称。" : "Enter a provider name in advanced connection settings.";
    try {
      const url = new URL(baseUrlDraft.trim());
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("invalid API URL");
    } catch {
      return zh ? "请填写完整的 http:// 或 https:// API 地址。" : "Enter a complete http:// or https:// API URL.";
    }
    if (!providerDiscoveryCredentialReady) return zh ? "请填写 API Key；无需密钥的服务可在高级设置中声明。" : "Enter an API key, or declare a keyless service in advanced settings.";
    if (requireModels) {
      try { currentModelSnapshot(); } catch (error) { return error instanceof Error ? error.message : String(error); }
    }
    return null;
  }

  async function saveModelProvider(testFirst = false): Promise<void> {
    if (modelConfigBusy) return;
    const issue = modelProviderSetupIssue();
    if (issue) { setModelConfigMessage(issue); return; }
    setModelConfigBusy(true); setModelConfigMessage(null); setModelConfigConflict(false); setModelTestOutput(null); setLastModelTestDraftFingerprint(null);
    try {
      const provider = providerDraft.trim();
      const usesHepAiAccount = provider === "hepai";
      const snapshot = currentModelSnapshot();
      const selected = snapshot.models[snapshot.id];
      if (testFirst) {
        if (!selected.enabled) throw new Error(zh ? "请先启用此模型。" : "Enable this model first.");
        if (!selected.capabilities.includes("chat") || selected.capabilities.includes("image_generation")) throw new Error(zh ? "草稿测试仅支持对话，不支持图像生成。可仅保存（未验证），再在高级管理中进行可能收费的图像能力测试。" : "Draft testing supports chat only. Save without verification, then use the potentially billable image capability probe in advanced management.");
        const protocol = selected.api_protocol;
        const host = protocol === wireApiDraft ? baseUrlDraft.trim() : protocol === "anthropic" ? anthropicBaseUrlDraft.trim() : protocol === "gemini" ? geminiBaseUrlDraft.trim() : "";
        const url = new URL(host);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol API URL");
        const result = await desktopApi.testMyDrSaiModelDraft({
          model: selected.upstream_id || snapshot.id, model_provider: provider, base_url: host,
          ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
          wire_api: protocol, requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
        }, "model");
        if (!result.ok) { setModelConfigMessage(`${zh ? "模型调用测试失败，未保存" : "Model call failed; not saved"}: ${result.error || "unknown"}`); return; }
        if (result.output) setModelTestOutput(result.output);
      }
      const connection = await desktopApi.saveMyDrSaiModelProvider(provider, {
        base_url: baseUrlDraft.trim(),
        ...(anthropicBaseUrlDraft.trim() ? { anthropic_base_url: anthropicBaseUrlDraft.trim() } : {}),
        ...(geminiBaseUrlDraft.trim() ? { google_base_url: geminiBaseUrlDraft.trim() } : {}),
        ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
        wire_api: wireApiDraft,
        requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
        models: snapshot.models,
        ...(myDrSaiConfig?.modelConnection?.revision ? { expected_revision: myDrSaiConfig.modelConnection.revision } : {}),
      });
      onModelConnectionUpdated(connection);
      selectModelProviderTab(provider, connection);
      setModelDraft(snapshot.id);
      setProviderModelEditor(null);
      if (!["hepai", "deepseek", "openai", "anthropic"].includes(provider)) setRecentOverflowModelProviderTab(provider);
      setApiKeyDraft("");
      setModelTestConfirmationOpen(false);
      setModelConfigMessage(testFirst
        ? (zh ? "当前模型调用测试通过并已保存；其他模型及工具/多模态能力未经本次测试验证，未切换主模型。" : "Selected model call passed and saved. Other models and tool/multimodal capabilities were not tested; primary model unchanged.")
        : (zh ? "已保存；尚未验证模型调用，未切换主模型。" : "Saved without model-call verification; primary model unchanged."));
    } catch (error) {
      const message = userFacingFailureMessage(error, language, "connection");
      setModelConfigConflict(normalizeRuntimeErrorEnvelope(error).code === "config_conflict");
      setModelConfigMessage(`${zh ? "保存未完成：" : "Save not completed: "}${message}`);
    } finally { setModelConfigBusy(false); }
  }

  async function reloadModelConnectionAfterConflict(): Promise<void> {
    setModelConfigBusy(true);
    try {
      const refreshed = await desktopApi.getMyDrSaiConfig();
      if (refreshed.modelConnection) {
        onModelConnectionUpdated(refreshed.modelConnection);
        setModelConfigConflict(false);
        setModelConfigMessage(zh ? "已获取最新配置版本，当前草稿已保留；请核对后再次保存。" : "Latest configuration revision loaded; your draft is retained. Review before saving again.");
      }
    } catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function testModelConnection(mode: "basic" | "model"): Promise<void> {
    const issue = modelProviderSetupIssue(mode === "model");
    if (issue) { setModelConfigMessage(issue); return; }
    setModelConfigBusy(true); setModelConfigMessage(null); setModelTestOutput(null);
    try {
      const usesHepAiAccount = providerDraft.trim() === "hepai";
      const selectedProtocol = providerModelConfigsDraft[modelDraft.trim()]?.api_protocol ?? wireApiDraft;
      const selectedBaseUrl = selectedProtocol === wireApiDraft ? baseUrlDraft.trim() : selectedProtocol === "anthropic" ? anthropicBaseUrlDraft.trim() : selectedProtocol === "gemini" ? geminiBaseUrlDraft.trim() : "";
      const testingSavedModel = mode === "model" && !modelProviderDirty;
      const result = testingSavedModel
        ? await desktopApi.testMyDrSaiModelProvider(providerDraft.trim(), modelDraft.trim())
        : await desktopApi.testMyDrSaiModelDraft({ model: modelDraft.trim(), model_provider: providerDraft.trim(), ...(selectedBaseUrl ? { base_url: selectedBaseUrl } : {}), ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}), wire_api: selectedProtocol, requires_api_key: !usesHepAiAccount && keySourceDraft !== "none" }, mode);
      const refreshed = await desktopApi.getMyDrSaiConfig();
      if (refreshed.modelConnection) onModelConnectionUpdated(refreshed.modelConnection);
      const localizedGuidance = result.guidance?.localizations?.[zh ? "zh" : "en"];
      if (mode === "model" && result.output) setModelTestOutput(result.output);
      setLastModelTestDraftFingerprint(modelDraftFingerprint);
      setModelConfigMessage(result.ok
        ? mode === "model"
          ? testingSavedModel
            ? (zh ? "所选已保存模型调用测试通过；未切换主模型。" : "The selected saved model call passed; the primary model is unchanged.")
            : (zh ? "当前草稿模型调用测试通过；草稿尚未保存，未切换主模型。" : "This draft model call passed; the draft is not saved and the primary model is unchanged.")
          : (zh ? "基础连接检查通过；不代表模型调用测试通过。" : "Basic connection check passed; model calls are not verified.")
        : `${localizedGuidance?.title || result.guidance?.title || (zh ? "连接测试失败" : "Connection test failed")}: ${localizedGuidance?.actions?.join(" / ") || result.guidance?.actions?.join(" / ") || result.error || "unknown"}`);
      if (mode === "model") setModelTestConfirmationOpen(false);
    }
    catch (error) { setModelConfigMessage(userFacingFailureMessage(error, language, "connection")); }
    finally { setModelConfigBusy(false); }
  }

  async function probeProviderModelCapability(model: string, operation: import("@shared/desktopApi").ModelCapabilityProbeOperation): Promise<void> {
    if (modelProviderDirty || modelConfigBusy || runningModelCapability) return;
    const confirmed = await requestAppDecision({
      id: `probe-model-capability-${model}-${operation}`,
      title: zh ? `测试模型“${model}”的 ${operation} 能力？` : `Test ${operation} on “${model}”?`,
      description: zh
        ? "这会向模型提供方发送一次最小能力测试请求。"
        : "This sends one minimal capability probe to the model provider.",
      impact: zh ? "服务商可能收取少量费用。" : "The provider may charge a small fee.",
      confirmLabel: zh ? "确认测试并保存" : "Confirm test and save",
    });
    if (!confirmed) return;
    const key = `${providerDraft.trim()}:${model}:${operation}`;
    setRunningModelCapability(key);
    try {
      const result = await desktopApi.probeMyDrSaiProviderModel(providerDraft.trim(), { model, operation });
      setModelCapabilityResults((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setModelCapabilityResults((current) => ({ ...current, [key]: { probe_id: "", agent_id: "", provider_id: providerDraft.trim(), model_id: model, operation, protocol: "auto", status: "error", started_at: new Date().toISOString(), duration_ms: 0, error_code: userFacingFailureMessage(error, language, "connection"), retryable: false } }));
    } finally { setRunningModelCapability(null); }
  }

  async function requestModelProviderDeletion(): Promise<void> {
    const provider = providerDraft.trim();
    if (!provider || provider === "hepai") return;
    setModelConfigBusy(true); setModelConfigMessage(null);
    try {
      const preflight = await desktopApi.preflightMyDrSaiModelProviderDeletion(provider);
      setProviderDeletePreflight(preflight);
      setProviderPendingDeletion(provider);
    } catch (error) {
      setModelConfigMessage(userFacingFailureMessage(error, language, "connection"));
    } finally { setModelConfigBusy(false); }
  }

  async function deleteModelProvider(_deleteCredential: boolean): Promise<void> {
    // Phase one deliberately has no destructive provider path. Reference checks
    // are not authoritative yet, so even a positive preflight must not issue DELETE.
    setModelConfigMessage(zh ? "待引用检查：本阶段不能删除已保存连接。" : "Pending reference checks: saved connections cannot be deleted in this phase.");
  }
  async function openDataCleanup(scope: DesktopDataCleanupScope): Promise<void> {
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      setCleanupPreview(await desktopApi.previewLocalDataCleanup(scope));
      setCleanupConfirmation("");
    } catch (error) {
      setCleanupStatus(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function confirmDataCleanup(): Promise<void> {
    if (!cleanupPreview) return;
    const scope = cleanupPreview.scope;
    if (scope === "all_local_data" && cleanupConfirmation !== cleanupPreview.confirmationPhrase) return;
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      const result = await desktopApi.clearLocalData({
        scope,
        confirmation: scope === "sessions" ? "CLEAR_SESSIONS" : "DELETE_LOCAL_DATA",
      });
      if (scope === "sessions") {
        for (const key of [LAST_THREAD_STORAGE_KEY, AWAY_STARTED_AT_STORAGE_KEY]) window.localStorage.removeItem(key);
      } else {
        window.localStorage.clear();
        window.sessionStorage.clear();
      }
      setCleanupPreview(null);
      setCleanupStatus(zh ? result.message : scope === "sessions" ? "Session data cleared; workspace files and results were preserved." : "OpenDrSai app data cleared; workspace files and results were preserved.");
      if (scope === "all_local_data") window.setTimeout(() => void onLogout(), 600);
      else window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setCleanupStatus(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function updateAgentConfig(updates: { plan_mode?: boolean; workspace_enabled?: boolean }): Promise<void> {
    setAgentConfigSaving(true);
    setAgentConfigMessage(null);
    try {
      await onUpdateAgentConfig(updates);
      setAgentConfigMessage(zh ? "智能体配置已保存。" : "Agent configuration saved.");
    } catch (error) {
      setAgentConfigMessage(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setAgentConfigSaving(false);
    }
  }

  async function saveAgentModelConfiguration(): Promise<void> {
    if (!openDrSaiConfigurationAgent || !agentModelPolicyDraft) return;
    setAgentModelPolicySaving(true);
    setAgentModelPolicyMessage(null);
    try {
      await onSaveAgentModelPolicy(openDrSaiConfigurationAgent.id, agentModelPolicyDraft);
      setAgentModelPolicyDirty(false);
      setAgentModelPolicyMessage(zh ? "模型配置已保存。" : "Model configuration saved.");
    } catch (error) {
      setAgentModelPolicyMessage(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setAgentModelPolicySaving(false);
    }
  }

  async function revokeMobileEnrollment(): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-mobile-enrollment", tone: "danger", title: zh ? "关闭所有移动设备访问？" : "Disable all mobile access?", description: zh ? "这会断开所有 Android 设备，并禁止它们继续连接此电脑。" : "This disconnects every Android device and prevents further connections to this computer.", impact: zh ? "需要重新启用和配对后才能恢复。" : "Access requires enabling and pairing again.", confirmLabel: zh ? "关闭访问" : "Disable access" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.revokeMobileRuntimeEnrollment();
      setMobilePairingReadiness({ state: "not_registered", action: "register_runtime" });
      setMobileAssociations([]);
      setMobileAssociationsState("runtime-offline");
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function pauseMobileRemoteAccess(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.pauseMobileRemoteAccess();
      setMobilePairingReadiness((current) => ({
        state: "paused",
        action: "resume",
        runtime_id: current?.runtime_id,
        gateway_runtime_id: current?.gateway_runtime_id,
        environment: current?.environment,
      }));
      setMobileAssociationsState("ready");
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function enableMobileRemoteAccess(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const before = await desktopApi.getMobilePairingReadiness().catch(() => null);
      if (before?.state === "paused") await desktopApi.resumeMobileRemoteAccess();
      const readiness = before?.state === "paused"
        ? await desktopApi.getMobilePairingReadiness()
        : await desktopApi.enableMobileRemoteAccess();
      setMobilePairingReadiness(readiness);
      setMobileAssociationsState(readiness.state === "ready" ? "ready" : "runtime-offline");
      if (readiness.state === "ready") {
        await refreshAndroidDevices();
      }
    } catch (reason) {
      setMobileAssociationsState("runtime-offline");
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function refreshAndroidDevices(): Promise<void> {
    setMobileAssociationsState("loading");
    setMobileEnrollmentError(null);
    let readiness: DesktopMobilePairingReadiness | null = null;
    try {
      readiness = await desktopApi.getMobilePairingReadiness();
      setMobilePairingReadiness(readiness);
      if (readiness.state !== "ready" && readiness.state !== "paused") {
        setMobileAssociations([]);
        setMobileAssociationsState(readiness.state === "offline" ? "platform-offline" : "runtime-offline");
        return;
      }
      const rows = await desktopApi.listMobileAssociations();
      setMobileAssociations(rows.filter((item) => item.status === "active"));
      setMobileAssociationsState("ready");
    } catch (reason) {
      setMobileAssociations([]);
      const state = classifyAndroidDeviceError(reason, readiness);
      setMobileAssociationsState(state);
      setMobileEnrollmentError(state === "management-unavailable" ? null : mobilePairingErrorText(reason, language));
    }
  }

  async function revokeAndroidDevice(association: DesktopMobileAssociation): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-mobile-device", tone: "danger", title: zh ? "撤销设备访问？" : "Revoke device access?", description: zh ? `设备：${association.device_name}` : `Device: ${association.device_name}`, impact: zh ? "该设备会立即断开，重新访问需要再次配对。" : "The device will disconnect immediately and must pair again to return.", confirmLabel: zh ? "撤销访问" : "Revoke access" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      await desktopApi.revokeMobileAssociation(association.association_id);
      setMobileAssociations((items) => items.filter((item) => item.association_id !== association.association_id));
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function makeAndroidDeviceReadOnly(association: DesktopMobileAssociation): Promise<void> {
    const confirmed = await requestAppDecision({ id: "mobile-device-read-only", title: zh ? "将设备改为只读？" : "Change device to read-only?", description: zh ? `设备：${association.device_name}` : `Device: ${association.device_name}`, impact: zh ? "正在打开的实时流会断开，并按只读权限重新验证。" : "Open live streams will close and re-authorize with read-only access.", confirmLabel: zh ? "改为只读" : "Make read-only" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const updated = await desktopApi.shrinkMobileAssociation(
        association.association_id,
        ["read"],
      );
      setMobileAssociations((items) => items.map((item) =>
        item.association_id === updated.association_id ? updated : item));
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function openAndroidDeviceScopeEditor(association: DesktopMobileAssociation): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const editor = mobileAssociationScopeEditorState(association, await desktopApi.listWorkspaces());
      if (editor.workspaces.length === 0) {
        setMobileEnrollmentError(zh ? "当前没有可用于缩小授权范围的工作区。" : "No workspaces are available for narrowing this authorization.");
        return;
      }
      setMobileScopeEditor({
        association,
        ...editor,
      });
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function saveAndroidDeviceScope(): Promise<void> {
    if (!mobileScopeEditor?.canSave) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const updated = await desktopApi.shrinkMobileAssociation(
        mobileScopeEditor.association.association_id,
        [...mobileScopeEditor.selectedPermissions],
        {
          workspace_scope: "selected",
          workspace_ids: [...mobileScopeEditor.selectedIds].sort(),
        },
      );
      setMobileAssociations((items) => items.map((item) =>
        item.association_id === updated.association_id ? updated : item));
      setMobileScopeEditor(null);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function revokeAllAndroidDevices(): Promise<void> {
    const confirmed = await requestAppDecision({ id: "revoke-all-mobile-devices", tone: "danger", title: zh ? "撤销所有设备访问？" : "Revoke every device?", description: zh ? "所有已配对 Android 设备会立即失去访问权限。" : "Every paired Android device will immediately lose access.", impact: zh ? "此电脑仍可配对；每台设备需要重新配对。" : "This computer remains pairable; each device must pair again.", confirmLabel: zh ? "全部撤销" : "Revoke all" });
    if (!confirmed) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      for (const association of activeAndroidAssociations) {
        await desktopApi.revokeMobileAssociation(association.association_id);
      }
      setMobileAssociations([]);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
      await refreshAndroidDevices();
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function renameAndroidRuntime(): Promise<void> {
    const proposed = window.prompt(zh ? "输入此电脑的新显示名称" : "Enter a new display name for this computer");
    if (proposed === null) return;
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const result = await desktopApi.renameMobileRuntime(proposed);
      setMobileEnrollmentError(zh ? `此电脑已重命名为 ${result.display_name}` : `This computer is now named ${result.display_name}`);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  async function diagnoseAndroidRuntime(): Promise<void> {
    setMobileEnrollmentBusy(true);
    setMobileEnrollmentError(null);
    try {
      const result = await desktopApi.diagnoseMobileRemoteAccess();
      const labels: Record<DesktopMobileRemoteDiagnostics["action"], string> = zh ? {
        repair_device_identity: "请重新扫码连接设备",
        enable_notifications: "请在手机上启用通知",
        none: "连接正常", start_runtime: "请启动 OpenDrSai Runtime", sign_in: "请重新登录",
        retry_relay: "请稍后重试平台连接", reconnect_runtime: "请重新连接 Runtime", update_runtime: "请更新 OpenDrSai Runtime",
      } : {
        none: "Connection is healthy", start_runtime: "Start OpenDrSai Runtime", sign_in: "Sign in again",
        retry_relay: "Retry the platform connection", repair_device_identity: "Pair the device again",
        reconnect_runtime: "Reconnect this computer", update_runtime: "Update OpenDrSai",
        enable_notifications: "Enable notifications on the phone",
      };
      setMobileEnrollmentError(labels[result.action]);
    } catch (reason) {
      setMobileEnrollmentError(mobilePairingErrorText(reason, language));
    } finally {
      setMobileEnrollmentBusy(false);
    }
  }

  useEffect(() => {
    if (activePane !== "remote-workspace") return;
    let cancelled = false;
    const refresh = (): void => {
      void (featureCapabilities?.remoteWorkspace === false
        ? Promise.resolve([])
        : desktopApi.listSshHosts().catch(() => [])
      ).then((hosts) => {
        if (cancelled) return;
        setRemoteHostCount(hosts.length);
        if (featureCapabilities?.remoteWorkspace === true && featureCapabilities?.mobilePairing !== false) void refreshAndroidDevices();
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activePane, featureCapabilities]);

  useEffect(() => {
    if (mobilePairingRefreshToken <= 0 || activePane !== "remote-workspace") return;
    void refreshAndroidDevices();
  }, [mobilePairingRefreshToken, activePane]);

  useEffect(() => {
    if (activePane !== "integrations") return;
    if (featureCapabilities?.serialVoice !== true && featureCapabilities?.streamingVoice !== true) return;
    let cancelled = false;
    void desktopApi.getVoiceRuntimeStatus().then((status) => {
      if (!cancelled) setVoiceIntegrationState(status.state);
    }).catch(() => {
      if (!cancelled) setVoiceIntegrationState("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [activePane, featureCapabilities]);

  useEffect(() => {
    if (activePane !== "voice" || !("speechSynthesis" in window)) return;
    const refreshVoices = (): void => setSystemVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
  }, [activePane]);

  // The V2 Desktop Runtime does not serve POST /v1/audio/speech, so provider
  // (online) reading cannot run here; see
  // WINDOWS_PLATFORM_DESCRIPTOR.features.remoteSpeechSynthesis.  Windows system
  // speech stays available, so only the online paths are disabled.
  const remoteSynthesisAvailable = featureCapabilities?.remoteSpeechSynthesis !== false;
  const onlineSynthesisUnavailableReason = zh
    ? "此桌面运行时未提供在线朗读接口（POST /v1/audio/speech 返回 404），当前只能使用 Windows 本地朗读。"
    : "This desktop runtime does not expose online speech synthesis (POST /v1/audio/speech returns 404); only Windows system speech is available.";
  useEffect(() => {
    if (remoteSynthesisAvailable) return;
    if (voicePreferences.synthesisMode !== "provider") return;
    updateVoicePreferences({ synthesisMode: "system" });
  }, [remoteSynthesisAvailable, voicePreferences.synthesisMode, updateVoicePreferences]);

  // Capability-gated Codex entry point in the Integrations pane: it must not
  // navigate into a pane that this build disables.
  const codexIntegrationUnavailableReason = capabilityDisabledPaneReason("codex", featureCapabilities, zh);

  // Agent configuration is rendered but disabled, so every cross-link that
  // would navigate into it must be disabled with the same reason instead of
  // silently landing on another pane.
  const agentDefaultsUnavailableReason = settingsPaneUnavailableReason("agent-defaults", zh);

  const refreshDuplexVoiceReadiness = useCallback(async () => {
    setDuplexVoiceReadinessBusy(true);
    try {
      const [status, readiness] = await Promise.all([
        desktopApi.getVoiceRuntimeStatus().catch(() => null),
        desktopApi.getDuplexVoiceReadiness().catch(() => null),
      ]);
      setVoiceRuntimeStatus(status);
      setDuplexVoiceReadiness(readiness ?? {
        available: false,
        reasonCode: "internal",
        message: zh ? "无法检查实时对话状态。" : "Realtime conversation readiness could not be checked.",
        providerId: null,
        modelId: null,
        checkedAt: new Date().toISOString(),
        checks: [],
        capabilities: null,
      });
    } finally {
      setDuplexVoiceReadinessBusy(false);
    }
  }, [zh]);
  useEffect(() => {
    if (activePane === "voice") void refreshDuplexVoiceReadiness();
  }, [activePane, refreshDuplexVoiceReadiness]);
  useEffect(() => {
    if (activePane !== "voice" || !navigator.mediaDevices?.enumerateDevices) return;
    const refresh = (): void => { void navigator.mediaDevices.enumerateDevices().then(setRealtimeAudioDevices).catch(() => setRealtimeAudioDevices([])); };
    refresh(); navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, [activePane]);

  const duplexVoiceAvailable = duplexVoiceReadiness?.available === true
    && typeof AudioWorkletNode !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia);
  const duplexVoiceReason = duplexVoiceReadiness?.available === true && !duplexVoiceAvailable
    ? (typeof AudioWorkletNode === "undefined"
      ? (zh ? "当前环境不支持低延迟音频处理。" : "Low-latency audio processing is unavailable in this environment.")
      : (zh ? "当前环境无法访问麦克风设备。" : "Microphone devices are unavailable in this environment."))
    : duplexVoiceReadiness?.message ?? (zh ? "正在检查实时对话状态…" : "Checking Realtime conversation readiness…");
  const duplexVoiceActions = getDuplexVoiceReadinessActions(
    duplexVoiceReadiness?.available === true && !duplexVoiceAvailable
      ? (typeof AudioWorkletNode === "undefined" ? "audio_worklet_unavailable" : "media_devices_unavailable")
      : duplexVoiceReadiness?.reasonCode ?? "internal",
  );
  const runDuplexVoiceReadinessAction = (action: DuplexVoiceReadinessActionId): void => {
    if (action === "open_agent_settings") {
      if (agentDefaultsUnavailableReason) return;
      setActivePane("agent-defaults");
    }
    else if (action === "switch_to_serial") updateVoicePreferences({ interactionMode: "serial" });
    else void refreshDuplexVoiceReadiness();
  };

  useEffect(() => {
    if (activePane !== "voice" || !systemVoices.length || !voicePreferences.voiceName) return;
    const resolvedName = resolveAvailableVoiceName(
      voicePreferences.voiceName,
      systemVoices.map((voice) => voice.name),
    );
    if (resolvedName !== voicePreferences.voiceName) updateVoicePreferences({ voiceName: resolvedName });
  }, [activePane, systemVoices, updateVoicePreferences, voicePreferences.voiceName]);
  const groups: Array<{
    label: string;
    items: Array<{ id: SettingsPane; label: string; icon: LucideIcon | typeof OpenAiBrandIcon }>;
  }> = [
    {
      label: zh ? "常规" : "General",
      items: [
        { id: "general", label: zh ? "常规" : "General", icon: Settings },
        { id: "voice", label: zh ? "语音" : "Voice", icon: Volume2 },
      ],
    },
    {
      label: zh ? "智能体" : "Agent",
      items: [
        { id: "agent-defaults", label: zh ? "智能体配置" : "Agent configuration", icon: Settings },
        { id: "model-providers", label: zh ? "模型提供方" : "Model providers", icon: PackageOpen },
        { id: "perceptors", label: zh ? "感知器配置" : "Perceptors", icon: Globe2 },
        { id: "executors", label: zh ? "执行器配置" : "Executors", icon: TerminalIcon },
        { id: "memories", label: zh ? "记忆器配置" : "Memories", icon: History },
        { id: "agent-task", label: zh ? "智能体任务" : "Agent tasks", icon: Bot },
        { id: "approvals", label: zh ? "审批中心" : "Approval Center", icon: ShieldCheck },
        { id: "analytics", label: zh ? "使用分析" : "Usage analytics", icon: History },
      ],
    },
    {
      label: zh ? "集成" : "Integrations",
      items: [
        { id: "integrations", label: zh ? "通用设置" : "General", icon: Plug },
        { id: "remote-workspace", label: zh ? "远程工作区" : "Remote Workspace", icon: TerminalIcon },
        { id: "codex", label: "Codex", icon: OpenAiBrandIcon },
        { id: "channels", label: zh ? "频道" : "Channels", icon: MessageSquare },
      ],
    },
    {
      label: zh ? "更多" : "Misc",
      items: [
        { id: "archived-sessions", label: zh ? "已归档会话" : "Archived sessions", icon: Archive },
        { id: "other", label: zh ? "系统与路径" : "System and paths", icon: FileText },
      ],
    },
  ];
  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.id === "voice") return featureCapabilities?.serialVoice !== false || featureCapabilities?.streamingVoice !== false;
      if (item.id === "agent-defaults" || item.id === "model-providers" || item.id === "perceptors" || item.id === "executors" || item.id === "memories" || item.id === "agent-task") return featureCapabilities?.agents !== false;
      if (item.id === "approvals") return featureCapabilities?.approvals !== false;
      if (item.id === "analytics") return featureCapabilities?.diagnostics !== false;
      if (item.id === "codex") return true;
      if (item.id === "remote-workspace") return featureCapabilities?.remoteWorkspace !== false;
      if (item.id === "channels") return featureCapabilities?.channels !== false;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
  const visiblePaneIds = visibleGroups.flatMap((group) => group.items.map((item) => item.id));
  useEffect(() => {
    if (visiblePaneIds.includes(activePane) && !disabledPaneReason(activePane, featureCapabilities, zh)) return;
    setActivePane("general");
  }, [activePane, visiblePaneIds.join("|"), featureCapabilities]);
  const presetModelProviderTabs = effectiveModelProviderPresets
    .filter((preset) => !preset.id.startsWith("custom-"))
    .sort((left, right) => {
      const leftIndex = MODEL_PROVIDER_TAB_ORDER.indexOf(left.id);
      const rightIndex = MODEL_PROVIDER_TAB_ORDER.indexOf(right.id);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });
  const presetModelProviderIds = new Set(presetModelProviderTabs.map((preset) => preset.id));
  const customModelProviderTabs = (myDrSaiConfig?.modelConnection && !modelProviderInventory.some((provider) => provider.name === myDrSaiConfig.modelConnection!.provider.name)
    ? [...modelProviderInventory, myDrSaiConfig.modelConnection.provider] : modelProviderInventory)
    .filter((provider) => !presetModelProviderIds.has(provider.name))
    .map((provider) => ({ id: provider.name, label: provider.name }));
  const modelProviderTabs: Array<{ id: string; label: string }> = [...presetModelProviderTabs, ...customModelProviderTabs];
  const primaryModelProviderIds = new Set(["hepai", "deepseek", "openai", "anthropic"]);
  const compactModelProviderTabs = modelProviderTabs.map((provider) => ({
    ...provider,
    label: modelProviderDisplayLabel(provider, zh),
  }));
  const recentOverflowModelProviderTabEntry = compactModelProviderTabs.find((provider) => provider.id === recentOverflowModelProviderTab)
    ?? (recentOverflowModelProviderTab ? { id: recentOverflowModelProviderTab, label: recentOverflowModelProviderTab === "custom" ? (zh ? "自定义" : "Custom") : recentOverflowModelProviderTab } : null);
  const activeModelProviderTabEntry = compactModelProviderTabs.find((provider) => provider.id === activeModelProviderTab)
    ?? { id: activeModelProviderTab, label: activeModelProviderTab === "custom" ? (zh ? "自定义" : "Custom") : activeModelProviderTab };
  const modelProviderTabLayout = computeModelProviderTabLayout({
    tabs: compactModelProviderTabs,
    primaryIds: primaryModelProviderIds,
    draftTabId: "__new-custom-provider__",
    pinned: [recentOverflowModelProviderTabEntry, activeModelProviderTabEntry],
  });
  const visibleModelProviderTabs = [{ id: "__new-custom-provider__", label: zh ? "自定义接入" : "Custom connection" }, ...modelProviderTabLayout.visible];
  const overflowModelProviderTabs = modelProviderTabLayout.overflow;
  const activeModelProviderPreset = effectiveModelProviderPresets.find((preset) => preset.id === activeModelProviderTab);
  const providersWithConfiguredKeys = new Set(modelProviderInventory.filter((provider) => provider.has_api_key).map((provider) => provider.name));
  if (myDrSaiConfig?.modelConnection?.provider.has_api_key) providersWithConfiguredKeys.add(myDrSaiConfig.modelConnection.provider.name);
  const selectedProviderConfig = modelProviderInventory.find((provider) => provider.name === providerDraft)
    ?? (myDrSaiConfig?.modelConnection?.provider.name === providerDraft ? myDrSaiConfig.modelConnection.provider : undefined);
  const selectedProviderConfigured = Boolean(selectedProviderConfig);
  const selectedProviderHasSavedKey = Boolean(selectedProviderConfig?.has_api_key);
  const savedProviderModels = selectedProviderConfig
    ? providerDraftModels(selectedProviderConfig, myDrSaiConfig?.modelConnection?.model_provider === selectedProviderConfig.name ? [myDrSaiConfig.modelConnection.model] : [])
    : [];
  const providerModelsChanged = savedProviderModels.length !== providerModelsDraft.length
    || savedProviderModels.some((model, index) => model !== providerModelsDraft[index]);
  const normalizedProviderModelAliases = modelAliasesForSave();
  const savedProviderModelAliases = selectedProviderConfig?.model_aliases ?? {};
  const providerAliasesChanged = Object.keys(savedProviderModelAliases).length !== Object.keys(normalizedProviderModelAliases).length
    || Object.entries(savedProviderModelAliases).some(([model, alias]) => normalizedProviderModelAliases[model] !== alias);
  const savedProviderModelOperations = selectedProviderConfig?.model_operations ?? {};
  const providerOperationsChanged = JSON.stringify(savedProviderModelOperations) !== JSON.stringify(providerModelOperationsDraft);
  const savedProviderModelConfigs = Object.fromEntries(Object.entries(selectedProviderConfig?.model_configs ?? providerModelConfigsFor(savedProviderModels, selectedProviderConfig)).map(([model, config]) => [model, providerModelConfigForWrite(config)]));
  const providerModelConfigsChanged = JSON.stringify(savedProviderModelConfigs) !== JSON.stringify(modelConfigsForSave());
  const modelProviderDirty = providerModelEditorDirty || !selectedProviderConfig
    || providerDraft.trim() !== selectedProviderConfig.name
    || baseUrlDraft.trim() !== selectedProviderConfig.base_url
    || anthropicBaseUrlDraft.trim() !== (selectedProviderConfig.anthropic_base_url ?? "")
    || geminiBaseUrlDraft.trim() !== (selectedProviderConfig.google_base_url ?? "")
    || wireApiDraft !== selectedProviderConfig.wire_api
    || (keySourceDraft !== "none" && providerDraft.trim() !== "hepai") !== selectedProviderConfig.requires_api_key
    || Boolean(apiKeyDraft.trim())
    || providerModelsChanged
    || providerAliasesChanged
    || providerOperationsChanged
    || providerModelConfigsChanged;
  // Test feedback belongs to exactly the draft that was tested, never its edits.
  const modelDraftFingerprint = JSON.stringify([providerDraft, baseUrlDraft, anthropicBaseUrlDraft, geminiBaseUrlDraft, apiKeyDraft, keySourceDraft, wireApiDraft, modelDraft, providerModelsDraft, providerModelConfigsDraft, providerModelAliasesDraft, providerModelOperationsDraft, newProviderModelDraft, providerModelEditor]);
  useEffect(() => {
    if (lastModelTestDraftFingerprint !== null && lastModelTestDraftFingerprint !== modelDraftFingerprint) {
      setLastModelTestDraftFingerprint(null);
      setModelConfigMessage(null);
      setModelTestOutput(null);
    }
  }, [modelDraftFingerprint, lastModelTestDraftFingerprint]);
  useEffect(() => { setModelCapabilityResults({}); }, [modelDraftFingerprint]);
  const hepAiAccountName = user?.name?.trim() || user?.email?.trim() || (zh ? "当前账号" : "current account");
  const usesOidcProviderAuth = activeModelProviderPreset?.auth_mode === "oidc" || providerDraft === "hepai";
  const providerDiscoveryCredentialReady = usesOidcProviderAuth
    || keySourceDraft === "none"
    || Boolean(apiKeyDraft.trim())
    || selectedProviderHasSavedKey;
  const providerSetupIssue = modelProviderSetupIssue();
  const activeAndroidAssociations = mobileAssociations.filter((item) => item.status === "active");
  const androidOnlineDeviceCount = new Set(
    activeAndroidAssociations
      .filter((item) => item.access_state === "online" || item.access_state === "accessing")
      .map((item) => item.device_summary),
  ).size;
  const androidRemoteEnabled = mobilePairingReadiness?.state === "ready"
    || (mobilePairingReadiness?.state === "offline" && Boolean(mobilePairingReadiness.runtime_id));
  // Android device management is served by the Runtime's /v1/mobile-pairing
  // routes (status / enrollment / associations / diagnostics); see
  // WINDOWS_PLATFORM_DESCRIPTOR.features.mobilePairing.  When the runtime does
  // not expose them the card is informational only instead of failing at
  // request time.
  const mobilePairingUnavailableReason = featureCapabilities?.mobilePairing === false
    ? (zh
      ? "此桌面运行时未提供 Android 远程设备管理接口（/v1/mobile-pairing 返回 404），无法启用或管理设备。"
      : "This desktop runtime does not expose the Android remote device management API (/v1/mobile-pairing returns 404), so Android access cannot be enabled or managed.")
    : null;
  const androidDeviceStateText: Record<DesktopMobileAssociation["access_state"], string> = zh ? {
    accessing: "正在访问",
    online: "在线",
    offline: "离线",
    revoked: "已撤销",
  } : {
    accessing: "Accessing",
    online: "Online",
    offline: "Offline",
    revoked: "Revoked",
  };
  const androidPermissionText: Record<DesktopMobileAssociation["permissions"][number], string> = zh ? {
    read: "查看",
    send: "发送消息",
    approve: "处理审批",
    files: "查看文件",
  } : {
    read: "View",
    send: "Send messages",
    approve: "Review approvals",
    files: "View files",
  };
  const androidPanelMessage = mobileAssociationsState === "loading"
    ? null
    : mobilePairingReadiness?.state === "paused"
      ? (zh ? "已暂停远程访问；现有授权会保留，恢复后无需重新扫码。" : "Remote access is paused. Existing authorizations are preserved and resume without pairing again.")
    : mobileAssociationsState === "runtime-offline"
      ? (!androidRemoteEnabled
          ? (zh ? "Android 远程连接已关闭。" : "Android remote connection is disabled.")
          : (zh ? "Runtime Host enrollment 暂时不可用。" : "Runtime Host enrollment is temporarily unavailable."))
      : mobileAssociationsState === "platform-offline"
        ? (zh ? "暂时无法连接 HepAI Platform Relay，请稍后重试。" : "HepAI Platform Relay is currently unreachable. Try again later.")
        : mobileAssociationsState === "management-unavailable"
          ? (zh ? "已允许 Android 连接，但当前 Relay 暂不支持查看和管理设备列表。" : "Android connections are allowed, but the current Relay does not support viewing or managing the device list.")
          : mobileAssociationsState === "failed"
            ? (mobileEnrollmentError ?? (zh ? "请求 Android 设备列表失败。" : "Could not load Android devices."))
            : activeAndroidAssociations.length === 0
               ? (zh ? "暂无已授权 Android 设备。" : "No authorized Android devices yet.")
               : null;
  const activeModelProviderStatusSummary = myDrSaiConfig?.modelConnection
    ? [
        modelProviderRuntimeSummary(myDrSaiConfig.modelConnection, zh),
        modelProviderTestSummary(myDrSaiConfig.modelConnection, zh),
      ].filter((item): item is string => Boolean(item)).join(" · ")
    : "";

  return (
    <div className="settings-view">
      <aside className="settings-navigation" aria-label={zh ? "设置分组" : "Settings groups"}>
        <h1>{zh ? "设置" : "Settings"}</h1>
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => {
              const Icon = item.icon;
              const unavailableReason = disabledPaneReason(item.id, featureCapabilities, zh);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`settings-pane-${item.id}`}
                  autoFocus={item.id === "general"}
                  className={[activePane === item.id ? "active" : "", unavailableReason ? "settings-pane-unavailable" : ""].filter(Boolean).join(" ")}
                  disabled={Boolean(unavailableReason)}
                  aria-disabled={Boolean(unavailableReason)}
                  title={unavailableReason ?? undefined}
                  onClick={() => { if (unavailableReason) return; setActivePane(item.id); }}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                  {unavailableReason ? <em className="settings-pane-unavailable-tag">{zh ? "不可用" : "Unavailable"}</em> : null}
                </button>
              );
            })}
          </section>
        ))}
      </aside>

      <div className="settings-content">
        {(activePane === "general" || activePane === "model-providers") && (
          <>
            <header className="settings-content-header">
              <h2>{activePane === "model-providers" ? (zh ? "模型提供方" : "Model providers") : (zh ? "常规" : "General")}</h2>
              <p>{activePane === "model-providers"
                ? (zh ? "接入第三方模型：填写 API 地址、API Key 和模型 ID，保存后可手动测试。" : "Connect a third-party model: enter its API URL, API key, and model ID. Save, then test manually.")
                : (zh ? "管理账户和桌面端的基础偏好。" : "Manage your account and desktop preferences.")}</p>
            </header>
            {activePane === "model-providers" && (
              <>
            <div className="model-provider-tabs" role="tablist" aria-label={zh ? "模型中心" : "Model center"}>
              <button type="button" role="tab" aria-selected={modelCenterTab === "mine"} className={modelCenterTab === "mine" ? "active" : ""} onClick={() => setModelCenterTab("mine")}>{zh ? "我的模型" : "My models"}</button>
              <button type="button" role="tab" aria-selected={modelCenterTab === "official"} className={modelCenterTab === "official" ? "active" : ""} onClick={() => setModelCenterTab("official")}>{zh ? "官方服务" : "Official services"}</button>
            </div>
            {modelCenterTab === "mine" ? <section className="settings-section model-provider-settings model-center-mine" data-testid="my-models-center">
              <header className="model-center-heading">
                <div><h2>{zh ? "我的模型" : "My models"}</h2><p>{zh ? "管理已接入的模型与运行状态。" : "Manage connected models and runtime status."}</p></div>
                <button type="button" className="model-provider-button-primary" onClick={() => { setModelCenterTab("official"); void navigateModelProvider("__new-custom-provider__"); }}>{zh ? "添加模型" : "Add model"}</button>
              </header>
              <div className="model-center-card-list">
                {directModels.length === 0 ? <div className="model-center-empty"><PackageOpen size={28} /><strong>{zh ? "还没有模型" : "No models yet"}</strong><span>{zh ? "添加模型后，可在这里统一管理。" : "Add a model to manage it here."}</span></div> : directModels.map((entry) => {
                  const runtimeStatus = modelCenterRuntimeStatus(entry.runtime?.availability ?? "configured_unverified", zh);
                  const connection = modelCenterConnection(entry.provider.base_url);
                  const inputBudget = Math.max(0, (entry.config.token_limit ?? 0) - (entry.config.max_tokens ?? 0));
                  const modelType = entry.config.capabilities.includes("image_generation") ? (zh ? "图像" : "Image") : (zh ? "对话" : "Chat");
                  const modalities = `${entry.config.input_modalities.map((item) => modelCenterModalityLabel(item, zh)).join("+")} → ${entry.config.output_modalities.map((item) => modelCenterModalityLabel(item, zh)).join("+")}`;
                  return <article className="model-center-card" key={entry.key} data-testid={`my-model-${entry.providerId}-${entry.modelId}`}>
                    <header className="model-center-card-header">
                      <div className="model-center-identity"><strong title={entry.config.alias || entry.modelId}>{entry.config.alias || entry.modelId}</strong><code title={entry.modelId}>{entry.modelId}</code></div>
                      <div className="model-center-badges"><span>{modelType}</span><span className={entry.config.enabled ? "is-enabled" : "is-disabled"}>{entry.config.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已停用" : "Disabled")}</span><span className={`is-${runtimeStatus.tone}`} title={zh ? "运行时状态" : "Runtime status"}>{runtimeStatus.label}</span></div>
                    </header>
                    <div className="model-center-connection"><span>{zh ? "连接" : "Connection"}</span><strong title={connection.title}>{connection.host}</strong><code>{entry.config.api_protocol}</code></div>
                    <div className="model-center-chips">
                      <span>{zh ? "最大输入" : "Max input"} <b>{inputBudget.toLocaleString()}</b></span>
                      <span>{zh ? "最大输出" : "Max output"} <b>{(entry.config.max_tokens ?? 0).toLocaleString()}</b></span>
                      <span>{modalities}</span>
                      <span>{entry.config.capabilities.includes("tool_calling") ? (zh ? "工具调用" : "Tool calling") : (zh ? "无工具调用" : "No tool calling")}</span>
                    </div>
                    {entry.agentEligibilityReason && <p className="model-center-agent-warning">{zh ? "不能用于 Agent：" : "Cannot be used for Agent: "}{modelCenterAgentReason(entry.agentEligibilityReason, zh)}</p>}
                    <footer className="model-center-actions">
                      <button type="button" onClick={() => editAggregatedModel(entry)}><Pencil size={14} />{zh ? "编辑" : "Edit"}</button>
                      <button type="button" onClick={() => editAggregatedModel(entry, true)}><Copy size={14} />{zh ? "复制" : "Copy"}</button>
                      <button type="button" disabled={!entry.config.enabled} title={!entry.config.enabled ? (zh ? "请先启用模型" : "Enable the model first") : undefined} onClick={() => { editAggregatedModel(entry); setModelConfigMessage(zh ? "请先保存草稿，再使用测试入口；测试不会自动发生。" : "Save the draft first, then use Test. No test has run yet."); }}>{zh ? "测试" : "Test"}</button>
                      <button type="button" onClick={() => toggleAggregatedModel(entry)}>{entry.config.enabled ? (zh ? "禁用" : "Disable") : (zh ? "启用" : "Enable")}</button>
                      <button type="button" className="model-provider-button-danger" disabled={modelConfigBusy} onClick={() => void deleteSavedProviderModel(entry.modelId, entry.providerId)}><Trash2 size={14} />{zh ? "删除" : "Delete"}</button>
                    </footer>
                  </article>;
                })}
              </div>
            </section> : <>
            <div className="model-provider-tabs" aria-label={zh ? "模型提供方" : "Model providers"}>
              <div className="model-provider-tablist" role="tablist">
                {visibleModelProviderTabs.map((provider) => (
                  <button key={provider.id} type="button" role="tab" aria-selected={activeModelProviderTab === provider.id} className={activeModelProviderTab === provider.id ? "active" : ""} onClick={() => void navigateModelProvider(provider.id)}><ModelProviderLogo provider={provider.id} /><span>{provider.label}</span>{providersWithConfiguredKeys.has(provider.id) && <i className="model-provider-configured-dot" title={zh ? "API 密钥已配置" : "API key configured"} aria-label={zh ? "API 密钥已配置" : "API key configured"} />}</button>
                ))}
              </div>
              {overflowModelProviderTabs.length > 0 && <details className="model-provider-overflow">
                <summary>{zh ? "更多 / 已保存" : "More / Saved"}<span aria-hidden="true">⌄</span></summary>
                <div className="model-provider-overflow-menu" role="menu">
                  {overflowModelProviderTabs.map((provider) => (
                    <button key={provider.id} type="button" role="menuitemradio" aria-checked={activeModelProviderTab === provider.id} className={activeModelProviderTab === provider.id ? "selected" : ""} onClick={(event) => { void navigateModelProvider(provider.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ModelProviderLogo provider={provider.id} /><span>{provider.label}</span>{providersWithConfiguredKeys.has(provider.id) && <i className="model-provider-configured-dot" title={zh ? "API 密钥已配置" : "API key configured"} aria-label={zh ? "API 密钥已配置" : "API key configured"} />}{activeModelProviderTab === provider.id && <b aria-hidden="true">✓</b>}</button>
                  ))}
                </div>
              </details>}
              <button type="button" className="model-provider-add-tab" aria-label={zh ? "添加模型提供方" : "Add model provider"} title={zh ? "添加模型提供方" : "Add model provider"} onClick={() => void navigateModelProvider("__new-custom-provider__")}>＋</button>
            </div>
            <section className="settings-section model-provider-settings" data-testid="model-provider-settings">
              <fieldset className="model-provider-form" disabled={modelConfigBusy || runningModelCapability !== null}>
              <div><h2>{activeModelProviderPreset ? modelProviderDisplayLabel(activeModelProviderPreset, zh) : (zh ? "自定义提供方" : "Custom provider")}<span className={`model-provider-configuration-indicator ${selectedProviderConfigured ? "configured" : "unconfigured"}`} data-testid="model-provider-configuration-indicator">{selectedProviderConfigured ? (zh ? "已保存（不代表测试通过）" : "Saved (not proof of a test pass)") : (zh ? "未保存草稿" : "Unsaved draft")}</span>{selectedProviderConfigured && modelProviderDirty && <span className="model-provider-dirty-indicator" data-testid="model-provider-dirty-indicator">{zh ? "有未保存更改" : "Unsaved changes"}</span>}</h2><p>{usesOidcProviderAuth ? (zh ? "HepAI 使用当前已登录账号的 access token 获取模型并调用服务，不使用 API Key。" : "HepAI uses the current signed-in account access token for model discovery and calls; no API key is used.") : (zh ? "直接填写模型信息，然后测试并保存。" : "Enter model details, then test and save.")}</p></div>
              {myDrSaiConfig?.modelConnection?.model_provider === activeModelProviderTab && <div className="model-provider-status-card" data-testid="model-provider-status-card">
                <strong>{zh ? "当前运行配置：" : "Active runtime configuration: "}{myDrSaiConfig.modelConnection.model} · {myDrSaiConfig.modelConnection.model_provider}</strong>
                <span>{zh ? "API 主机：" : "API host: "}{myDrSaiConfig.modelConnection.provider.base_url}</span>
                {activeModelProviderStatusSummary && <span className="model-provider-status-summary">{activeModelProviderStatusSummary}</span>}
              </div>}
              <div className="model-provider-grid model-provider-basic">
                  <label><span>{zh ? "API 地址（必填）" : "API URL (required)"}</span><input data-testid="model-provider-api-host" aria-required="true" value={baseUrlDraft} readOnly={usesOidcProviderAuth} onChange={(event) => setBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/v1" /><small className="model-provider-key-hint">{zh ? "填写服务商的 API 基础地址（不是官网或聊天页面）；是否带 /v1 请按服务商文档。" : "Use the API base URL, not a website or chat page. Follow provider documentation for /v1."}</small></label>
                {usesOidcProviderAuth ? <>
                  <div className="model-provider-account-auth model-provider-wide" data-testid="model-provider-account-auth"><span>{zh ? "账号验证" : "Account authentication"}</span><strong>{zh ? `已登录账号（${hepAiAccountName}）` : `Signed-in account (${hepAiAccountName})`}</strong><small>{zh ? "获取模型、检查连接和模型调用均使用当前登录会话的 access token。" : "Model discovery, connection checks, and model calls all use the current session access token."}</small></div>
                </> : <>
                  <label><span className="model-provider-field-label"><span>{zh ? `API Key${keySourceDraft !== "none" && !selectedProviderHasSavedKey ? "（必填）" : "（可留空）"}` : `API key${keySourceDraft !== "none" && !selectedProviderHasSavedKey ? " (required)" : " (optional)"}`}</span>{selectedProviderHasSavedKey && <em data-testid="model-provider-key-configured"><ShieldCheck size={13} />{zh ? "已安全保存" : "Saved securely"}</em>}</span><input data-testid="model-provider-api-key" aria-required={keySourceDraft !== "none" && !selectedProviderHasSavedKey} type="password" value={apiKeyDraft} onChange={(event) => { setKeySourceDraft("secure"); setApiKeyDraft(event.target.value); }} placeholder={selectedProviderHasSavedKey ? (zh ? "已配置；留空表示不修改" : "Configured; leave blank to keep") : "sk-..."} /><small className="model-provider-key-hint" data-testid="model-provider-key-hint">{keySourceDraft === "none" && !selectedProviderHasSavedKey ? (zh ? "当前预设声明无需 API Key；如该服务需要密钥，直接在此填入即会自动启用。" : "This preset declares no API key. If the service needs one, type it here and it is enabled automatically.") : (zh ? "第三方服务通常需要 API Key。已保存的密钥不会回显；留空保留原密钥，填写新值后保存才会替换。" : "Saved keys are never displayed. Leave blank to keep the existing key; enter a new value and save to replace it.")}</small></label>
                </>}
              </div>
              <div className="model-provider-models" data-testid="model-provider-models">
                {selectedProviderConfig?.user_models_error && <p className="model-provider-hint model-provider-hint-warning" data-testid="model-provider-user-models-error">{zh ? `你的模型文件无法读取，本次仅内置模型生效。请修复或删除该文件后重试：${selectedProviderConfig.user_models_error}` : `Your model file could not be read, so only the built-in models are active. Fix or delete it and try again: ${selectedProviderConfig.user_models_error}`}</p>}
                {(selectedProviderConfig?.shadowed_models?.length ?? 0) > 0 && <p className="model-provider-hint model-provider-hint-warning" data-testid="model-provider-shadowed-models">{zh ? `这些自定义模型与内置模型重名，已改用内置定义：${(selectedProviderConfig?.shadowed_models ?? []).join("、")}。请改用新的模型 ID。` : `These custom models share a built-in ID, so the built-in definition is used: ${(selectedProviderConfig?.shadowed_models ?? []).join(", ")}. Use a new model ID instead.`}</p>}
                {selectedProviderConfig?.origin === "product" && <p className="model-provider-hint" data-testid="model-provider-product-origin-hint">{zh ? "内置模型的名称、模态与数值由 OpenDrSai 维护并随版本更新，只能停用；如需调整请用“复制模型”生成你自己的模型。" : "Built-in model names, modalities, and numbers are maintained by OpenDrSai and update with the app, so they can only be disabled. Use “Copy model” to make an editable copy."}</p>}
                <datalist id="discovered-model-options">{discoveredModels.map((model) => <option key={model} value={model} />)}</datalist>
                <div className="model-provider-actions">
                  {providerModelsDraft.length > 0 && <label>{zh ? "编辑模型" : "Edit model"}<select data-testid="model-provider-model-selection" value={providerModelEditor?.originalId ?? ""} onChange={(event) => switchDirectModel(event.target.value)}><option value="">{zh ? "新模型" : "New model"}</option>{providerModelsDraft.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>}
                  {providerModelsDraft.length > 0 && <button type="button" onClick={() => switchDirectModel("")}>{zh ? "新建模型" : "New model"}</button>}
                </div>
              {providerModelEditor && (() => {
                const modalityOptions: MyDrSaiModelModality[] = ["text", "image", "audio", "video"];
                const protocolOptions: Array<{ id: MyDrSaiModelApiProtocol; label: string }> = [{ id: "openai", label: "OpenAI" }, { id: "anthropic", label: "Anthropic" }, { id: "gemini", label: "Gemini" }];
                const imageModel = providerModelEditor.capabilities.includes("image_generation");
                const capabilityOptions: MyDrSaiModelCapability[] = imageModel ? ["image_edit"] : ["tool_calling", "reasoning"];
                // A built-in entry may only be switched on or off here: OpenDrSai
                // regenerates its catalog file on every launch, so every other field
                // is read-only and customisation goes through "Copy model".
                const productModel = providerModelEditor.origin === "product";
                return <div className="model-provider-direct-editor">
                  <section aria-label={zh ? "模型参数" : "Model parameters"} data-testid="model-provider-model-editor">
                    {productModel && <p className="model-provider-hint model-provider-hint-warning" data-testid="model-provider-model-editor-product-notice">{zh ? "这是内置模型：名称、模态、协议、能力与数值由 OpenDrSai 维护并随版本更新，此处只能切换启用状态。如需调整，请先“复制模型”再修改副本。" : "This is a built-in model: OpenDrSai maintains its name, modalities, protocol, capabilities, and numbers, and updates them with the app, so only the enabled state can change here. Use “Copy model” first to adjust a copy."}</p>}
                    <div className="model-provider-model-editor-grid">
                      <label><span>{zh ? "模型 ID" : "Model ID"}</span><input data-testid="model-provider-model-id" aria-required="true" value={providerModelEditor.modelId} maxLength={256} disabled={productModel} onChange={(event) => { setProviderModelEditor((current) => current ? { ...current, modelId: event.target.value } : current); setProviderModelEditorError(null); }} /></label>
                      <label><span>{zh ? "模型类型" : "Model type"}</span><select data-testid="model-provider-model-type" disabled={productModel} value={imageModel ? "image" : "chat"} onChange={(event) => setDirectModelType(event.target.value === "image")}><option value="chat">{zh ? "对话模型" : "Chat model"}</option><option value="image">{zh ? "图像生成" : "Image generation"}</option></select></label>
                      <label><span>{zh ? "别名" : "Alias"}</span><input value={providerModelEditor.alias} maxLength={256} placeholder={providerModelEditor.modelId} disabled={productModel} onChange={(event) => setProviderModelEditor((current) => current ? { ...current, alias: event.target.value } : current)} /></label>
                      <fieldset disabled={productModel}><legend>{zh ? "输入模态" : "Input modalities"}</legend><div className="model-provider-capability-options">{modalityOptions.map((modality) => <label key={modality}><input type="checkbox" checked={providerModelEditor.inputModalities.includes(modality)} onChange={(event) => toggleProviderModelEditorModality("input", modality, event.target.checked)} /><span>{modality}</span></label>)}</div></fieldset>
                      <fieldset disabled={productModel}><legend>{zh ? "输出模态" : "Output modalities"}</legend><div className="model-provider-capability-options">{modalityOptions.map((modality) => <label key={modality}><input type="checkbox" checked={providerModelEditor.outputModalities.includes(modality)} onChange={(event) => toggleProviderModelEditorModality("output", modality, event.target.checked)} /><span>{modality}</span></label>)}</div></fieldset>
                      <fieldset disabled={productModel}><legend>{zh ? "API 协议" : "API protocol"}</legend><div className="model-provider-capability-options">{protocolOptions.map((protocol) => <label key={protocol.id}><input type="radio" name="model-api-protocol" checked={providerModelEditor.apiProtocol === protocol.id} onChange={() => { if (providerModelsDraft.length <= 1) setWireApiDraft(protocol.id); setProviderModelEditor((current) => current ? { ...current, apiProtocol: protocol.id } : current); }} /><span>{protocol.label}</span></label>)}</div></fieldset>
                      <label><span>{zh ? "最大输入预算（token，必填）" : "Max input budget (tokens, required)"}</span><input aria-required="true" inputMode="numeric" maxLength={9} value={providerModelEditor.tokenLimit} placeholder={zh ? "必填正整数" : "Required positive integer"} disabled={productModel} onChange={(event) => { setProviderModelEditor((current) => current ? { ...current, tokenLimit: event.target.value } : current); setProviderModelEditorError(null); }} /><small data-testid="model-provider-model-editor-token-limit-hint">{zh ? "预留完整输出预算后的输入额度。保存为共享上下文 = 输入预算 + 最大输出；不是后端独立输入硬上限。" : "Input budget after reserving full output. Shared context = input budget + max output; not an independent backend input cap."}</small></label>
                      <label><span>{zh ? "最大输出（token，必填）" : "Max output (tokens, required)"}</span><input aria-required="true" inputMode="numeric" maxLength={9} value={providerModelEditor.maxTokens} placeholder={zh ? "必填正整数" : "Required positive integer"} disabled={productModel} onChange={(event) => { setProviderModelEditor((current) => current ? { ...current, maxTokens: event.target.value } : current); setProviderModelEditorError(null); }} /><small data-testid="model-provider-model-editor-max-tokens-hint">{zh ? "输入与输出合计不得超过 100000000。图像模型也须声明 token 预算；这不是图像尺寸。" : "Combined budgets must not exceed 100000000. Image token budgets are not image dimensions."}</small></label>
                      <fieldset className="model-provider-model-editor-wide" disabled={productModel || !providerModelEditor.capabilities.includes("reasoning")}><legend>{zh ? "推理强度" : "Reasoning efforts"}</legend><div className="model-provider-capability-options">{PROVIDER_REASONING_EFFORT_OPTIONS.map((effort) => <label key={effort}><input type="checkbox" checked={providerModelEditor.reasoningEfforts.includes(effort)} onChange={(event) => setProviderModelEditor((current) => current ? { ...current, reasoningEfforts: nextProviderReasoningEfforts(current.reasoningEfforts, effort, event.target.checked) } : current)} /><span>{effort}</span></label>)}</div><small data-testid="model-provider-model-editor-reasoning-hint">{providerModelEditor.capabilities.includes("reasoning") ? (zh ? "声明该模型可用的推理强度，用于界面取值；全部留空表示沿用内置默认值。" : "Declare the reasoning efforts this model offers so the UI can pick one. Leave all unchecked to keep the built-in default.") : (zh ? "请先勾选“能力”中的 reasoning。" : "Select the reasoning capability above first.")}</small></fieldset>
                      <fieldset className="model-provider-model-editor-wide" disabled={productModel}><legend>{zh ? "能力" : "Capabilities"}</legend><div className="model-provider-capability-options">{capabilityOptions.map((capability) => <label key={capability}><input type="checkbox" checked={providerModelEditor.capabilities.includes(capability)} onChange={(event) => toggleProviderModelEditorCapability(capability, event.target.checked)} /><span>{capability === "tool_calling" ? (zh ? "工具调用（Agent 筛选）" : "Tool calling (Agent eligibility)") : capability}</span></label>)}</div></fieldset>
                      <label className="model-provider-model-editor-enabled"><input type="checkbox" checked={providerModelEditor.enabled} onChange={(event) => setProviderModelEditor((current) => current ? { ...current, enabled: event.target.checked } : current)} /><span>{zh ? "启用此模型" : "Enable this model"}</span></label>
                    </div>
                    {providerModelEditorError && <p className="settings-message" role="alert">{providerModelEditorError}</p>}
                    {imageModel && <p className="model-provider-hint" role="status">{zh ? "图像在线测试可能收费。当前草稿测试接口只发起文本调用，不支持图像生成，不能据此验证图像。可仅保存（未验证），然后在高级管理中显式测试图像能力。" : "Online image tests may incur charges. Draft tests send text requests only and cannot verify image generation. Save without verification, then explicitly probe image capabilities in advanced management."}</p>}

                  </section>
                </div>;
              })()}

                <details className="model-provider-advanced" data-testid="model-provider-model-details">
                  <summary>{zh ? `模型详情与能力（${providerModelsDraft.length}）` : `Model details and capabilities (${providerModelsDraft.length})`}</summary>
                  <div className="model-provider-actions"><button type="button" disabled={!providerDiscoveryCredentialReady || modelConfigBusy} onClick={() => void discoverModels()}>{zh ? "获取模型列表（合并保留现有模型）" : "Fetch models (merge, keep existing)"}</button></div>
                <div className="model-provider-model-list">
                  <div className="model-provider-model-table-header" role="row">
                    <span>{zh ? "模型 ID" : "Model ID"}</span>
                    <span>{zh ? "别名" : "Alias"}</span>
                    <span>{zh ? "输入与输出模态" : "Input and output modalities"}</span>
                    <span>{zh ? "API 协议" : "API protocol"}</span>
                    <span>{zh ? "操作" : "Actions"}</span>
                  </div>
                  {providerModelsDraft.length === 0 && newProviderModelDraft === null ? <p>{zh ? "尚未添加模型。可以手工新建，或从提供方获取。" : "No models yet. Add one manually or fetch from the provider."}</p> : orderedProviderModelEntries(providerModelsDraft, providerModelConfigsDraft, wireApiDraft, providerModelAliasesDraft, providerModelOperationsDraft).map((entry) => entry.kind === "family" ? (
                    // A family separator must be a *direct* child of the list:
                    // the row grid uses ``subgrid``, so any extra wrapper div
                    // would collapse the table into one column per wrapper.
                    <div className="model-family-group-header" key={`family:${entry.family}`} data-model-family={entry.family} role="presentation">
                      <ModelFamilyBadge family={entry.family} zh={zh} />
                      <span className="model-family-group-count">{entry.count}</span>
                    </div>
                  ) : (() => {
                    const model = entry.model;
                    const config = providerModelConfigsDraft[model] ?? providerModelConfigFor(model, { wire_api: wireApiDraft, model_aliases: providerModelAliasesDraft, model_operations: providerModelOperationsDraft });
                    const probeOperations = config.capabilities.filter((capability) => ["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech"].includes(capability)) as import("@shared/desktopApi").ModelCapabilityProbeOperation[];
                    const family = classifyModelFamily({
                      alias: config.alias,
                      model,
                      operations: config.capabilities as unknown as readonly string[],
                      input_modalities: config.input_modalities as unknown as readonly string[],
                      output_modalities: config.output_modalities as unknown as readonly string[],
                    });
                    return <div className="model-provider-model-row-wrap" key={model}>
                    <div className="model-provider-model-row">
                      <code className="model-provider-model-id" title={model} data-origin={config.origin ?? "user"}><span className="model-provider-model-id-text">{model}</span>{config.origin === "product" && <em className="model-provider-model-origin" title={zh ? "内置模型：随 OpenDrSai 更新，只能停用" : "Built-in model: updates with OpenDrSai and can only be disabled"}>{zh ? "内置" : "Built-in"}</em>}<ModelFamilyBadge family={family} zh={zh} /></code>
                      <button type="button" className={`model-provider-model-alias ${config.alias ? "" : "is-placeholder"}`} data-testid={`model-provider-model-alias-${model}`} title={zh ? "点击编辑别名" : "Click to edit alias"} onClick={() => switchDirectModel(model)}>{config.alias || model}</button>
                      <div className="model-modality-directional"><ModelModalityBadges zh={zh} direction="input" modalities={config.input_modalities} onClick={() => switchDirectModel(model)} /><span className="model-modality-separator" aria-hidden>→</span><ModelModalityBadges zh={zh} direction="output" modalities={config.output_modalities} onClick={() => switchDirectModel(model)} /></div>
                      <ModelApiProtocolBadge protocol={config.api_protocol} zh={zh} onClick={() => switchDirectModel(model)} />
                      <div className="model-provider-model-operations" data-testid={`model-provider-model-operations-${model}`}>
                        <label className="model-provider-model-enabled" title={config.enabled ? (zh ? "点击停用" : "Click to disable") : (zh ? "点击启用" : "Click to enable")}><input type="checkbox" checked={config.enabled} onChange={(event) => { const enabled = event.target.checked; setProviderModelConfigsDraft((current) => ({ ...current, [model]: { ...config, enabled } })); if (!enabled && modelDraft === model) { const fallback = providerModelsDraft.find((candidate) => candidate !== model && (providerModelConfigsDraft[candidate]?.enabled ?? true)); setModelDraft(fallback ?? ""); } else if (enabled && !modelDraft) setModelDraft(model); }} aria-label={zh ? `${config.enabled ? "停用" : "启用"}模型 ${model}` : `${config.enabled ? "Disable" : "Enable"} model ${model}`} /><span aria-hidden /></label>
                        <button type="button" className="model-provider-model-action" data-testid={`model-provider-model-edit-${model}`} title={zh ? "编辑模型信息" : "Edit model information"} aria-label={zh ? `编辑模型 ${model}` : `Edit model ${model}`} onClick={() => switchDirectModel(model)}><Pencil size={14} aria-hidden /></button>
                        <button type="button" className="model-provider-model-action" data-testid={`model-provider-model-copy-${model}`} title={zh ? "复制模型" : "Copy model"} aria-label={zh ? `复制模型 ${model}` : `Copy model ${model}`} onClick={() => duplicateProviderModel(model)}><Copy size={14} aria-hidden /></button>
                        <details className="model-provider-capability-test-menu"><summary title={zh ? "测试单项能力" : "Test a capability"}>{zh ? "测试" : "Test"}</summary><div>{probeOperations.length ? probeOperations.map((operation) => { const key = `${providerDraft.trim()}:${model}:${operation}`; const result = modelCapabilityResults[key]; return <button key={operation} type="button" disabled={modelProviderDirty || modelConfigBusy || !config.enabled || runningModelCapability !== null} title={modelProviderDirty ? (zh ? "请先保存提供方，再测试已保存模型能力" : "Save provider before probing saved model capabilities") : undefined} onClick={() => void probeProviderModelCapability(model, operation)}>{runningModelCapability === key ? (zh ? "测试中…" : "Testing…") : operation}{result && !modelProviderDirty ? <small className={result.status}>{result.status === "verified" ? (zh ? "已验证" : "Verified") : result.error_code || result.status}</small> : null}</button>; }) : <small>{zh ? "请先声明能力" : "Declare capabilities first."}</small>}</div></details>
                        <button type="button" className="model-provider-model-remove" disabled={modelConfigBusy} title={selectedProviderConfig?.model_configs?.[model] ? (config.origin === "product" ? (zh ? "预检引用后停用内置模型" : "Check references, then disable this built-in model") : (zh ? "预检引用后删除此模型" : "Check references, then delete only this model")) : (zh ? "移除未保存草稿" : "Remove unsaved draft")} aria-label={zh ? `${config.origin === "product" ? "停用" : "删除"}模型 ${model}` : `${config.origin === "product" ? "Disable" : "Delete"} model ${model}`} onClick={() => selectedProviderConfig?.model_configs?.[model] ? void deleteSavedProviderModel(model) : removeProviderModel(model)}><Trash2 size={14} aria-hidden /></button>
                      </div>
                    </div>
                    {probeOperations.map((operation) => { const result = modelCapabilityResults[`${providerDraft.trim()}:${model}:${operation}`]; return result && !modelProviderDirty ? <div className={`model-provider-capability-result ${result.status}`} key={`${model}:${operation}:result`}><strong>{operation}</strong><span>{result.status === "verified" ? (zh ? "已验证" : "Verified") : result.error_code || result.status}</span><small>{result.protocol} · {result.duration_ms} ms</small></div> : null; })}
                    </div>;
                  })())}
                </div>
                </details>
              </div>
              <details className="model-provider-advanced" data-testid="model-provider-endpoints">
                <summary>{zh ? "高级连接设置 · 名称与多协议" : "Advanced connection · name and protocols"}</summary>
                <div className="model-provider-grid">
                <label><span>{zh ? "提供方名称（保存标识）" : "Provider name (saved identifier)"}</span><input data-testid="model-provider-name" value={providerDraft} readOnly={usesOidcProviderAuth} onChange={(event) => setProviderDraft(event.target.value)} placeholder="custom" /></label>
                </div>
                {!usesOidcProviderAuth && <label className="model-provider-hint"><input type="checkbox" data-testid="model-provider-keyless" checked={keySourceDraft === "none"} onChange={(event) => { setKeySourceDraft(event.target.checked ? "none" : "secure"); if (event.target.checked) setApiKeyDraft(""); }} />{zh ? "此服务无需 API Key（仅在服务商明确说明时勾选）" : "This service needs no API key (only if confirmed by the provider)"}</label>}
                <div className="model-provider-endpoints-header"><h3>{zh ? "主机与协议" : "Hosts and protocols"}</h3><button type="button" aria-label={zh ? "添加协议主机" : "Add protocol host"} title={zh ? "添加协议主机" : "Add protocol host"} disabled={(wireApiDraft === "anthropic" || Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")) && (wireApiDraft === "gemini" || Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini"))} onClick={() => setAddedProviderProtocols((current) => { const next = new Set(current); if (wireApiDraft !== "anthropic" && !anthropicBaseUrlDraft && !next.has("anthropic")) next.add("anthropic"); else if (wireApiDraft !== "gemini" && !geminiBaseUrlDraft && !next.has("gemini")) next.add("gemini"); return next; })}>＋</button></div>
                <div className="model-provider-grid">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value={wireApiDraft} disabled={usesOidcProviderAuth} onChange={(event) => setWireApiDraft(event.target.value as MyDrSaiModelApiProtocol)}><option value="openai">OpenAI API</option><option value="anthropic">Anthropic API</option><option value="gemini">Google API</option></select></label>

                  <span className="model-provider-endpoint-action-spacer" aria-hidden="true" />
                </div>
                {(Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")) && wireApiDraft !== "anthropic" && <div className="model-provider-endpoint-row">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value="anthropic" onChange={(event) => { if (event.target.value !== "gemini") return; const url = anthropicBaseUrlDraft; setAnthropicBaseUrlDraft(""); setGeminiBaseUrlDraft(url); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("anthropic"); next.add("gemini"); return next; }); }}><option value="anthropic">Anthropic API</option><option value="gemini" disabled={wireApiDraft === "gemini" || Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini")}>Google API</option></select></label>
                  <label><span>{zh ? "API 主机" : "API host"}</span><input data-testid="model-provider-anthropic-api-host" value={anthropicBaseUrlDraft} onChange={(event) => setAnthropicBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/anthropic" /></label>
                  <button type="button" className="model-provider-endpoint-remove" aria-label={zh ? "移除 Anthropic API 主机" : "Remove Anthropic API host"} onClick={() => { setAnthropicBaseUrlDraft(""); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("anthropic"); return next; }); }}>−</button>
                </div>}
                {(Boolean(geminiBaseUrlDraft) || addedProviderProtocols.has("gemini")) && wireApiDraft !== "gemini" && <div className="model-provider-endpoint-row">
                  <label><span>{zh ? "API 协议" : "API protocol"}</span><select value="gemini" onChange={(event) => { if (event.target.value !== "anthropic") return; const url = geminiBaseUrlDraft; setGeminiBaseUrlDraft(""); setAnthropicBaseUrlDraft(url); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("gemini"); next.add("anthropic"); return next; }); }}><option value="anthropic" disabled={wireApiDraft === "anthropic" || Boolean(anthropicBaseUrlDraft) || addedProviderProtocols.has("anthropic")}>Anthropic API</option><option value="gemini">Google API</option></select></label>
                  <label><span>{zh ? "API 主机" : "API host"}</span><input data-testid="model-provider-gemini-api-host" value={geminiBaseUrlDraft} onChange={(event) => setGeminiBaseUrlDraft(event.target.value)} placeholder="https://api.example.com/google" /></label>
                  <button type="button" className="model-provider-endpoint-remove" aria-label={zh ? "移除 Google API 主机" : "Remove Google API host"} onClick={() => { setGeminiBaseUrlDraft(""); setAddedProviderProtocols((current) => { const next = new Set(current); next.delete("gemini"); return next; }); }}>−</button>
                </div>}
              </details>
              {myDrSaiConfig?.modelConnection?.model_provider === activeModelProviderTab && myDrSaiConfig.modelConnection.metadata?.known_model === false && <p className="model-provider-hint" data-testid="model-provider-unknown-model-warning">{zh ? "该模型未登记，能力参数尚未校准；将使用安全的通用默认值。" : "This model is not registered; capabilities are uncalibrated and safe generic defaults will be used."}</p>}
              <p className="model-provider-hint" data-testid="model-provider-save-guidance">{zh ? "测试并保存会进行可能收费的真实对话调用，成功后才保存当前表单与其他模型草稿；不切换主模型。此调用不验证工具或多模态能力。" : "Test and save makes a potentially billable chat call, then saves this form and other model drafts only on success. It does not switch the primary model or verify tools/multimodal capabilities."}</p>
              {providerSetupIssue && <p className="model-provider-hint" id="model-provider-setup-issue" role="status">{providerSetupIssue}</p>}
              <div className="model-provider-actions">
                <button type="button" className="model-provider-button-primary" data-testid="model-provider-test-save" disabled={modelConfigBusy || Boolean(providerSetupIssue) || !providerModelEditor?.enabled || !providerModelEditor.capabilities.includes("chat") || providerModelEditor.capabilities.includes("image_generation")} onClick={() => setModelTestConfirmationOpen(true)}>{zh ? "测试并保存" : "Test and save"}</button>
                <button type="button" className="model-provider-button-quiet" data-testid="model-provider-save" disabled={modelConfigBusy || Boolean(providerSetupIssue) || !modelProviderDirty} onClick={() => void saveModelProvider(false)}>{zh ? "仅保存（未验证）" : "Save only (unverified)"}</button>
              </div>
              {modelConfigMessage && <div className="settings-message" role="status" aria-live="polite">{modelConfigMessage}{modelConfigConflict && <button type="button" data-testid="model-provider-conflict-reload" disabled={modelConfigBusy} onClick={() => void reloadModelConnectionAfterConflict()}>{zh ? "重新加载配置" : "Reload configuration"}</button>}</div>}
              {modelTestOutput && <div className="model-provider-test-output" data-testid="model-provider-test-output" role="status" aria-live="polite"><span>{zh ? "模型回复" : "Model reply"}</span><pre>{modelTestOutput}</pre></div>}
              </fieldset>
            </section>
            <details className="settings-section model-provider-recovery model-provider-advanced" data-testid="model-provider-recovery">
              <summary>{zh ? "高级工具 · 检查、诊断、配置文件与删除" : "Advanced tools · checks, diagnosis, config and deletion"}</summary>
              <div className="model-provider-actions"><button type="button" disabled={runningModelCapability !== null || modelConfigBusy || !providerDraft.trim()} data-testid="model-provider-test-basic" onClick={() => void testModelConnection("basic")}>{zh ? "检查连接" : "Check connection"}</button><button type="button" className="model-provider-button-danger" disabled={runningModelCapability !== null || modelConfigBusy || !selectedProviderConfigured || providerDraft === "hepai"} onClick={requestModelProviderDeletion}>{zh ? "删除提供方" : "Delete provider"}</button>{myDrSaiConfig?.modelConnection?.path && <button type="button" className="model-provider-button-quiet" onClick={() => onOpenPath(myDrSaiConfig.modelConnection!.path!)}>{zh ? "打开配置文件" : "Open config"}</button>}</div>
              <div>
                <h3>{zh ? "模型配置诊断与恢复" : "Model configuration diagnosis and recovery"}</h3>
                <p>{zh ? "检查配置、凭据和最后可用快照；在线检查会真实调用当前模型。" : "Check configuration, credentials, and the last-known-good snapshot. Online diagnosis calls the current model."}</p>
              </div>
              <div className="model-provider-actions">
                <button type="button" disabled={runningModelCapability !== null || modelConfigBusy} data-testid="model-provider-doctor" onClick={() => void runModelDoctor(false)}>{zh ? "运行检查" : "Run Doctor"}</button>
                <button type="button" className="model-provider-button-accent" disabled={runningModelCapability !== null || modelConfigBusy} data-testid="model-provider-doctor-online" onClick={() => void runModelDoctor(true)}>{zh ? "在线检查" : "Online check"}</button>
                <button type="button" className="model-provider-button-quiet" disabled={runningModelCapability !== null || modelConfigBusy || modelDoctorResult?.last_known_good_available !== true} data-testid="model-provider-restore-last-good" onClick={() => void restoreLastKnownGoodModelConnection()}>{zh ? "恢复最后可用配置" : "Restore last-known-good"}</button>
              </div>
              {modelDoctorResult && <ul data-testid="model-provider-doctor-result">{modelDoctorResult.checks.map((check) => <li key={check.id} data-status={check.status}><strong>{check.id}</strong><span>{check.message}</span></li>)}</ul>}
            </details>
            {providerPendingDeletion && (
              <div className="model-provider-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !modelConfigBusy) { setProviderPendingDeletion(null); setProviderDeletePreflight(null); } }} onKeyDown={(event) => { if (event.key === "Escape" && !modelConfigBusy) { setProviderPendingDeletion(null); setProviderDeletePreflight(null); } }}>
                <section className="model-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="model-provider-delete-title" aria-describedby="model-provider-delete-description" data-testid="model-provider-delete-dialog">
                  <h2 id="model-provider-delete-title">{zh ? `删除 Provider“${providerPendingDeletion}”？` : `Delete Provider “${providerPendingDeletion}”?`}</h2>
                  <p id="model-provider-delete-description">{zh ? "请选择是否同时删除系统安全存储中的凭据。取消不会修改 Provider、凭据或当前连接。" : "Choose whether to remove its credential from secure storage. Cancel leaves the Provider, credential, and active connection unchanged."}</p>
                  {providerDeletePreflight && providerDeletePreflight.references.length > 0 && (
                    <div className="settings-message" data-testid="model-provider-delete-references">
                      <p>{zh ? "此 Provider 仍被以下配置引用。请先迁移引用；当前操作不会修改任何配置。" : "This Provider is still referenced. Migrate these selections first; nothing has been changed."}</p>
                      <ul>{providerDeletePreflight.references.map((reference) => <li key={`${reference.kind}:${reference.id}`}>{reference.label}: {reference.model_id}</li>)}</ul>
                    </div>
                  )}
                  <div className="model-provider-delete-actions">
                    <button type="button" className="danger" disabled data-testid="model-provider-delete-with-credential" title={zh ? "待引用检查" : "Pending reference checks"} onClick={() => void deleteModelProvider(true)}>{zh ? "删除 Provider 和凭据（待引用检查）" : "Delete Provider and credential (pending checks)"}</button>
                    <button type="button" disabled data-testid="model-provider-delete-keep-credential" title={zh ? "待引用检查" : "Pending reference checks"} onClick={() => void deleteModelProvider(false)}>{zh ? "仅删除 Provider（待引用检查）" : "Delete Provider only (pending checks)"}</button>
                    <button type="button" autoFocus disabled={modelConfigBusy} data-testid="model-provider-delete-cancel" onClick={() => { setProviderPendingDeletion(null); setProviderDeletePreflight(null); }}>{zh ? "取消" : "Cancel"}</button>
                  </div>
                </section>
              </div>
            )}
            </>}
            {modelTestConfirmationOpen && (
              <div className="model-provider-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !modelConfigBusy) setModelTestConfirmationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && !modelConfigBusy) setModelTestConfirmationOpen(false); }}>
                <section className="model-provider-test-dialog" role="dialog" aria-modal="true" aria-labelledby="model-provider-test-title" aria-describedby="model-provider-test-description" data-testid="model-provider-test-dialog">
                  <h2 id="model-provider-test-title">{zh ? `测试并保存“${providerModelEditor?.modelId.trim()}”？` : `Test and save “${providerModelEditor?.modelId.trim()}”?`}</h2>
                  <p id="model-provider-test-description">{zh ? "将发送可能收费的最小对话请求。只有调用成功才保存当前表单；失败不保存。其他模型、工具与多模态能力未经此次验证，不切换主模型。" : "Sends a potentially billable minimal chat request. Saves this form only after success; failure does not save. Other models, tools and multimodal abilities are not verified, and the primary model is unchanged."}</p>
                  <div className="model-provider-delete-actions">
                    <button type="button" disabled={modelConfigBusy} data-testid="model-provider-test-model-confirm" onClick={() => void saveModelProvider(true)}>{modelConfigBusy ? (zh ? "测试中…" : "Testing…") : (zh ? "确认测试并保存" : "Confirm test and save")}</button>
                    <button type="button" autoFocus disabled={modelConfigBusy} data-testid="model-provider-test-model-cancel" onClick={() => setModelTestConfirmationOpen(false)}>{zh ? "取消" : "Cancel"}</button>
                  </div>
                </section>
              </div>
            )}
              </>
            )}
            {activePane === "general" && (
              <>
            <section className="settings-section">
              <div>
                <h2>{zh ? "HepAI 账号" : "HepAI account"}</h2>
                <p>{user?.name || user?.email || (zh ? "已通过 OIDC 登录" : "Signed in with OIDC")}</p>
                {user?.email && user.email !== user.name && <small>{user.email}</small>}
              </div>
              <button type="button" onClick={() => void onLogout()}>{zh ? "退出登录" : "Sign out"}</button>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "显示语言" : "Language"}</h2>
                <p>{zh ? "切换 OpenDrSai 桌面端的界面语言。" : "Switch the interface language for OpenDrSai Desktop."}</p>
              </div>
              <div className="settings-language-control">
                <span>{zh ? "界面语言" : "Interface language"}</span>
                <div className="language-segment" role="group" aria-label={zh ? "界面语言" : "Interface language"}>
                  <button type="button" className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>
                    {zh ? "英文" : "English"}
                  </button>
                  <button type="button" className={language === "zh" ? "active" : ""} onClick={() => onLanguageChange("zh")}>
                    {zh ? "中文" : "Chinese"}
                  </button>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "外观" : "Appearance"}</h2>
                <p>{zh ? "选择界面主题，并决定左侧栏显示哪些广场组件。" : "Choose the interface theme and which Square components appear in the sidebar."}</p>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "主题" : "Theme"}</strong><small>{zh ? "跟随系统会实时响应 Windows 的颜色模式。" : "System mode follows Windows color changes in real time."}</small></span>
                <div className="appearance-segment" role="group" aria-label={zh ? "外观主题" : "Appearance theme"}>
                  {(["light", "dark", "system"] as AppearanceMode[]).map((mode) => (
                    <button key={mode} type="button" className={appearance === mode ? "active" : ""} onClick={() => onAppearanceChange(mode)}>
                      {mode === "light" ? (zh ? "白天" : "Light") : mode === "dark" ? (zh ? "黑夜" : "Dark") : (zh ? "跟随系统" : "System")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-component-list">
                <strong>{zh ? "左侧栏组件" : "Sidebar components"}</strong>
                <label className="settings-toggle"><span><strong>{zh ? "广场" : "Square"}</strong><small>{zh ? "显示或隐藏整个广场分组。" : "Show or hide the entire Square group."}</small></span><input type="checkbox" checked={sidebarComponents.square} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, square: event.target.checked }))} /></label>
                <label className="settings-toggle"><span><strong>{zh ? "智能体" : "Agents"}</strong><small>{zh ? "在广场分组中显示智能体入口。" : "Show Agents inside the Square group."}</small></span><input type="checkbox" checked={sidebarComponents.agents} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, agents: event.target.checked }))} /></label>
                <label className="settings-toggle"><span><strong>{zh ? "技能" : "Skills"}</strong><small>{zh ? "在广场分组中显示技能入口。" : "Show Skills inside the Square group."}</small></span><input type="checkbox" checked={sidebarComponents.skills} onChange={(event) => onSidebarComponentsChange((current) => ({ ...current, skills: event.target.checked }))} /></label>
              </div>
              <div className="settings-component-list">
                <strong>{zh ? "右侧栏组件" : "Right sidebar components"}</strong>
                {(["files", "diagnostics"] as Array<keyof RightSidebarComponentVisibility>).map((component) => {
                  const label = component === "files" ? (zh ? "文件" : "Files") : (zh ? "诊断" : "Diagnostics");
                  return (
                    <label className="settings-toggle" key={component}>
                      <span><strong>{label}</strong><small>{zh ? `在右侧栏中显示${label}标签。` : `Show the ${label} tab in the right sidebar.`}</small></span>
                      <input type="checkbox" checked={rightSidebarComponents[component]} onChange={(event) => onRightSidebarComponentsChange((current) => ({ ...current, [component]: event.target.checked }))} />
                    </label>
                  );
                })}
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "工作区与会话" : "Workspace and sessions"}</h2>
                <p>{zh ? "设置侧栏会话范围和工作区排序的默认方式。" : "Choose the default session scope and workspace sorting."}</p>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "会话范围" : "Session scope"}</strong><small>{zh ? "控制侧栏默认显示当前工作区还是全部会话。" : "Control whether the sidebar shows this workspace or all sessions."}</small></span>
                <select value={sessionScope} onChange={(event) => onSessionScopeChange(event.target.value as "workspace" | "all")}>
                  <option value="workspace">{zh ? "当前工作区" : "Current workspace"}</option>
                  <option value="all">{zh ? "全部会话" : "All sessions"}</option>
                </select>
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "工作区排序" : "Workspace sorting"}</strong><small>{zh ? "同时应用到主侧栏的工作区列表。" : "Also applies to the workspace list in the primary sidebar."}</small></span>
                <select value={workspaceSortMode} onChange={(event) => onWorkspaceSortModeChange(event.target.value as WorkspaceSortMode)}>
                  <option value="name">{zh ? "名称" : "Name"}</option>
                  <option value="created">{zh ? "创建时间" : "Created"}</option>
                </select>
              </div>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "启动与通知" : "Startup and notifications"}</h2><p>{zh ? "恢复上次工作状态，并在任务完成时发送桌面通知。" : "Restore your last working state and notify when a task completes."}</p></div>
              <label className="settings-toggle"><span><strong>{zh ? "恢复上次会话" : "Restore last session"}</strong><small>{zh ? "下次启动时重新打开最近使用的会话。" : "Reopen the most recently used session on launch."}</small></span><input type="checkbox" checked={restoreLastSession} onChange={(event) => onRestoreLastSessionChange(event.target.checked)} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "恢复上次工作区" : "Restore last workspace"}</strong><small>{zh ? "下次启动时重新选择最近使用的工作区。" : "Select the most recently used workspace on launch."}</small></span><input type="checkbox" checked={restoreLastWorkspace} onChange={(event) => onRestoreLastWorkspaceChange(event.target.checked)} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "任务完成通知" : "Completion notifications"}</strong><small>{zh ? "会话或后台任务完成时发送 Windows 通知，点击可返回对应任务。" : "Send a Windows notification for completed conversations and background tasks; click it to return to the task."}</small></span><input type="checkbox" checked={completionNotifications} onChange={(event) => onCompletionNotificationsChange(event.target.checked)} /></label>
            </section>
              </>
            )}
          </>
        )}

        {activePane === "voice" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "语音" : "Voice"}</h2>
              <p>{zh ? "配置语音输入、回复朗读和本机系统声音。" : "Configure voice input, response reading, and Windows system voices."}</p>
            </header>
            <section className="settings-section">
              <div>
                <h2>{zh ? "交互模式" : "Interaction mode"}</h2>
                <p>{zh ? "单次语音输入适合录完后确认；实时对话支持连续听说和随时打断。" : "Single voice input lets you review after recording; Realtime conversation supports continuous listening, speaking, and interruption."}</p>
              </div>
              <div className="settings-row">
                <span>
                  <strong>{zh ? "语音模式" : "Voice mode"}</strong>
                  <small data-testid="voice-mode-status">{voicePreferences.interactionMode === "duplex" ? (zh ? "连续听说，可随时打断" : "Continuous conversation with interruption") : (zh ? "录制一次，确认后发送" : "Record once, then review and send")}</small>
                </span>
                <select
                  data-testid="voice-interaction-mode"
                  value={voicePreferences.interactionMode}
                  onChange={(event) => updateVoicePreferences({ interactionMode: event.target.value as DesktopVoiceInteractionMode })}
                  aria-describedby="voice-duplex-availability"
                >
                  <option value="serial">{zh ? "单次语音输入" : "Single voice input"}</option>
                  <option value="duplex" disabled={!duplexVoiceAvailable}>{zh ? "实时对话" : "Realtime conversation"}</option>
                </select>
              </div>
              <div id="voice-duplex-availability" className="settings-privacy-note" role="note" data-testid="voice-duplex-readiness">
                <strong>{zh ? "实时对话状态" : "Realtime conversation status"}</strong>
                <p>{duplexVoiceAvailable ? (zh ? "已就绪，可开始实时对话。" : "Ready to start a Realtime conversation.") : duplexVoiceReason}</p>
                {!duplexVoiceAvailable && <div className="settings-actions">
                  <button type="button" disabled={duplexVoiceReadinessBusy || (duplexVoiceActions.primary === "open_agent_settings" && Boolean(agentDefaultsUnavailableReason))} title={duplexVoiceActions.primary === "open_agent_settings" ? agentDefaultsUnavailableReason ?? undefined : undefined} onClick={() => runDuplexVoiceReadinessAction(duplexVoiceActions.primary)}>{duplexVoiceActions.primary === "open_agent_settings" ? (zh ? "打开智能体配置" : "Open Agent configuration") : duplexVoiceActions.primary === "switch_to_serial" ? (zh ? "使用单次语音输入" : "Use single voice input") : duplexVoiceReadinessBusy ? (zh ? "检查中…" : "Checking…") : (zh ? "重新检查" : "Check again")}</button>
                  {duplexVoiceActions.fallback && <button type="button" onClick={() => runDuplexVoiceReadinessAction(duplexVoiceActions.fallback!)}>{zh ? "使用单次语音输入" : "Use single voice input"}</button>}
                </div>}
              </div>
            </section>
            <section className="settings-section" data-testid="realtime-voice-settings">
              <div><h2>{zh ? "实时对话" : "Realtime conversation"}</h2><p>{zh ? "这些设置只影响全双工实时会话，并直接映射到下一次 Session。" : "These settings affect only full-duplex Realtime Sessions and map directly to the next Session payload."}</p></div>
              <div className="settings-row"><span><strong>{zh ? "实时模型" : "Realtime model"}</strong><small>{zh ? "模型在智能体配置中独立绑定；切换模型需要重启会话。" : "Bound independently in Agent configuration; changing it requires a new Session."}</small></span><button type="button" disabled={Boolean(agentDefaultsUnavailableReason)} title={agentDefaultsUnavailableReason ?? undefined} onClick={() => setActivePane("agent-defaults")}>{duplexVoiceReadiness?.providerId && duplexVoiceReadiness?.modelId ? `${duplexVoiceReadiness.providerId} / ${duplexVoiceReadiness.modelId}` : (zh ? "打开智能体配置" : "Open Agent configuration")}</button></div>
              <div className="settings-row"><span><strong>Provider voice</strong><small>{zh ? "留空使用 Provider 默认声音；变更后下一次会话生效。" : "Leave blank for the Provider default; changes apply to the next Session."}</small></span><input data-testid="realtime-voice-name" value={voicePreferences.realtimeVoiceName} maxLength={80} placeholder={zh ? "默认" : "Default"} onChange={(event) => updateVoicePreferences({ realtimeVoiceName: event.target.value })} /></div>
              <div className="settings-row"><span><strong>{zh ? "实时识别语言" : "Realtime language"}</strong><small>{zh ? "独立于单次语音输入。" : "Independent from single voice input."}</small></span><select data-testid="realtime-voice-language" value={voicePreferences.realtimeLanguage} onChange={(event) => updateVoicePreferences({ realtimeLanguage: event.target.value as "auto" | "zh-CN" | "en-US" })}><option value="auto">{zh ? "自动检测" : "Automatic"}</option><option value="zh-CN">中文</option><option value="en-US">English</option></select></div>
              <div className="settings-row"><span><strong>{zh ? "实时麦克风" : "Realtime microphone"}</strong><small>{zh ? "会话中也可无缝切换。" : "Can also be switched during a Session."}</small></span><select data-testid="realtime-input-device" value={voicePreferences.realtimeInputDeviceId} onChange={(event) => updateVoicePreferences({ realtimeInputDeviceId: event.target.value })}><option value="">{zh ? "系统默认" : "System default"}</option>{realtimeAudioDevices.filter((device) => device.kind === "audioinput" && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${zh ? "麦克风" : "Microphone"} ${index + 1}`}</option>)}</select></div>
              <div className="settings-row"><span><strong>{zh ? "实时扬声器" : "Realtime output"}</strong><small>{zh ? "仅支持当前系统可用的输出设备。" : "Uses an output currently available to the system."}</small></span><select data-testid="realtime-output-device" value={voicePreferences.realtimeOutputDeviceId} onChange={(event) => updateVoicePreferences({ realtimeOutputDeviceId: event.target.value })}><option value="">{zh ? "系统默认" : "System default"}</option>{realtimeAudioDevices.filter((device) => device.kind === "audiooutput" && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${zh ? "扬声器" : "Output"} ${index + 1}`}</option>)}</select></div>
              <label className="settings-toggle"><span><strong>{zh ? "自动恢复连接" : "Automatically recover connection"}</strong><small>{zh ? "断线后最多进行三次有界重连；关闭后立即报告网络错误。" : "Attempts up to three bounded reconnects; when off, reports a network error immediately."}</small></span><input data-testid="realtime-auto-recovery" type="checkbox" checked={voicePreferences.realtimeAutoRecovery} onChange={(event) => updateVoicePreferences({ realtimeAutoRecovery: event.target.checked })} /></label>
              <div className="settings-row"><span><strong>{zh ? "转录保存" : "Transcript saving"}</strong><small>{zh ? "不保存时仍可显示会话内临时字幕，结束后不会写入任务。" : "Temporary captions remain visible but are not written to the task."}</small></span><select data-testid="realtime-transcript-policy" value={voicePreferences.realtimeTranscriptPolicy} onChange={(event) => updateVoicePreferences({ realtimeTranscriptPolicy: event.target.value as "stable" | "none" })}><option value="stable">{zh ? "保存稳定转录" : "Save stable transcripts"}</option><option value="none">{zh ? "不保存" : "Do not save"}</option></select></div>
              <div className="settings-privacy-note" role="note"><strong>{zh ? "会话更新规则" : "Session update rules"}</strong><p>{zh ? "音量和输入/输出设备可立即生效；instruction 可经 ACK 热更新；模型、Provider voice、语言、自动恢复和保存策略需要新会话。" : "Volume and input/output devices apply immediately; instructions can hot-update with an ACK. Model, Provider voice, language, recovery, and saving policy require a new Session."}</p></div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "语音发送" : "Voice sending"}</h2>
                <p>{zh ? "串行语音识别完成后默认填入输入框，由你检查并发送。" : "Serial voice input fills the composer by default for you to review and send."}</p>
              </div>
              <label className="settings-toggle">
                <span><strong>{zh ? "发送前确认转写" : "Review transcript before sending"}</strong><small>{zh ? "关闭时，停止录音后会自动识别并发送。" : "When off, stopping a recording transcribes and sends it automatically."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-confirm-before-send"
                  checked={voicePreferences.confirmBeforeSend}
                  onChange={(event) => updateVoicePreferences({ confirmBeforeSend: event.target.checked })}
                />
              </label>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "回复朗读" : "Response reading"}</h2>
                <p>{zh ? "朗读只在完整回复生成后开始，录音开始时会自动停止。" : "Reading starts only after a response is complete and stops when recording begins."}</p>
              </div>
              <label className="settings-toggle">
                <span><strong>{zh ? "自动朗读完整回复" : "Automatically read completed responses"}</strong><small>{zh ? "默认关闭；不会朗读流式生成中的内容。" : "Off by default; streaming output is never read."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-auto-read"
                  checked={voicePreferences.autoReadResponses}
                  onChange={(event) => updateVoicePreferences({ autoReadResponses: event.target.checked })}
                />
              </label>
              <label className="settings-toggle" title={remoteSynthesisAvailable ? undefined : onlineSynthesisUnavailableReason}>
                <span><strong>{zh ? "允许在线朗读" : "Allow online speech synthesis"}</strong><small>{remoteSynthesisAvailable ? (zh ? "允许将回复文本发送给当前配置的语音服务；关闭后仅使用 Windows 本地朗读。" : "Allow response text to be sent to the configured speech provider; when off, only Windows system speech is used.") : onlineSynthesisUnavailableReason}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-remote-tts-consent"
                  disabled={!remoteSynthesisAvailable}
                  checked={voicePreferences.remoteTtsConsent}
                  onChange={(event) => updateVoicePreferences({
                    remoteTtsConsent: event.target.checked,
                    ...(event.target.checked ? {} : { synthesisMode: "system" as const }),
                  })}
                />
              </label>
              <div className="settings-row">
                <span><strong>{zh ? "朗读引擎" : "Reading engine"}</strong><small>{remoteSynthesisAvailable ? (zh ? "Provider 不可用时会显示错误；切换到 Windows 系统声音需由你确认。" : "Provider failures are shown explicitly; switching to Windows system speech requires your choice.") : onlineSynthesisUnavailableReason}</small></span>
                <select
                  data-testid="voice-synthesis-mode"
                  value={voicePreferences.synthesisMode}
                  onChange={(event) => updateVoicePreferences({ synthesisMode: event.target.value as "system" | "provider" })}
                  aria-describedby={remoteSynthesisAvailable ? undefined : "voice-online-synthesis-unavailable"}
                >
                  <option value="system">{zh ? "Windows 系统声音" : "Windows system speech"}</option>
                  <option value="provider" disabled={!voicePreferences.remoteTtsConsent || !remoteSynthesisAvailable}>{zh ? "语音服务 Provider" : "Speech provider"}</option>
                </select>
              </div>
              {!remoteSynthesisAvailable ? <p id="voice-online-synthesis-unavailable" className="settings-privacy-note" role="note" data-testid="voice-online-synthesis-unavailable">{onlineSynthesisUnavailableReason}</p> : null}
              <div className="settings-row">
                <span><strong>{zh ? "语速" : "Reading speed"}</strong><small>{voicePreferences.playbackRate.toFixed(1)}x</small></span>
                <input
                  type="range"
                  data-testid="voice-playback-rate"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={voicePreferences.playbackRate}
                  onChange={(event) => updateVoicePreferences({ playbackRate: Number(event.target.value) })}
                  aria-label={zh ? "朗读语速" : "Reading speed"}
                />
              </div>
              <div className="settings-row">
                <span><strong>{zh ? "系统声音" : "System voice"}</strong><small>{zh ? "声音由 Windows 和已安装语言包提供。" : "Voices are provided by Windows and installed language packs."}</small></span>
                <select
                  data-testid="voice-system-voice"
                  value={voicePreferences.voiceName}
                  onChange={(event) => updateVoicePreferences({ voiceName: event.target.value })}
                >
                  <option value="">{zh ? "自动选择" : "Automatic"}</option>
                  {systemVoices.map((voice) => (
                    <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>
                  ))}
                </select>
              </div>
            </section>
            <section className="settings-section">
              <div>
                <h2>{zh ? "语音输入" : "Voice input"}</h2>
                <p>{zh ? "只在点击麦克风后采集；停止后才提交整段音频进行识别。" : "Audio is captured only after clicking the microphone and submitted after recording stops."}</p>
              </div>
              <label className="settings-toggle">
                <span><strong>{zh ? "允许在线语音识别" : "Allow online transcription"}</strong><small>{zh ? "允许在停止录音后，将本次音频发送给当前配置的 Voice STT 服务。" : "Allow the recorded audio to be sent to the configured Voice STT provider after recording stops."}</small></span>
                <input
                  type="checkbox"
                  data-testid="voice-remote-stt-consent"
                  checked={voicePreferences.remoteSttConsent}
                  onChange={(event) => updateVoicePreferences({ remoteSttConsent: event.target.checked })}
                />
              </label>
              <div className="settings-row">
                <span><strong>{zh ? "识别语言" : "Transcription language"}</strong><small>{zh ? "自动检测适用于中英文混合输入。" : "Automatic detection works well for mixed Chinese and English."}</small></span>
                <select
                  data-testid="voice-input-language"
                  value={voicePreferences.inputLanguage}
                  onChange={(event) => updateVoicePreferences({ inputLanguage: event.target.value as "auto" | "zh-CN" | "en-US" })}
                >
                  <option value="auto">{zh ? "自动检测" : "Automatic"}</option>
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
              <div className="settings-privacy-note" role="note">
                <strong>{zh ? "数据说明" : "Data handling"}</strong>
                <p>{zh ? "系统朗读在本机完成。语音识别可能按当前 Voice STT Runtime 的配置发送到服务提供方；临时录音按任务生命周期清理。" : "System speech runs locally. Transcription may be sent to the configured Voice STT provider; temporary recordings are cleaned up with the task lifecycle."}</p>
              </div>
            </section>
          </>
        )}

        {activePane === "agent-defaults" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "智能体配置" : "Agent configuration"}</h2>
              <p>{zh ? "选择一个当前可用的智能体并配置其模型与运行偏好。" : "Choose an available Agent and configure its models and runtime preferences."}</p>
            </header>
            <div className="agent-configuration-tabs" role="tablist" aria-label={zh ? "智能体运行来源" : "Agent runtime source"}>
              {visibleConfigurationAgents.map((agent) => {
                const selected = activeConfigurationAgent?.id === agent.id;
                return <button key={agent.id} type="button" role="tab" aria-selected={selected} className={selected ? "active" : ""} onClick={() => selectConfigurationAgent(agent)}>
                  <AgentLogo agent={agent} />
                  <span>{agent.name}</span>
                </button>
              })}
              {configurationAgents.length > 3 && <button type="button" className="agent-configuration-more" aria-expanded={agentConfigurationTabsExpanded} aria-label={agentConfigurationTabsExpanded ? (zh ? "收起智能体" : "Show fewer Agents") : (zh ? "显示更多智能体" : "Show more Agents")} onClick={() => setAgentConfigurationTabsExpanded((expanded) => !expanded)}>
                {agentConfigurationTabsExpanded ? <ChevronUp size={16} /> : <><span aria-hidden="true">＋</span><small>{configurationAgents.length - 3}</small></>}
              </button>}
            </div>
            <section className="settings-section agent-configuration-panel" role="tabpanel">
              <div>
                <h2>{activeAgentConfigurationTab === "opendrsai" ? (zh ? "本机 OpenDrSai" : "Local OpenDrSai") : activeAgentConfigurationTab === "codex" ? (zh ? "本机 Codex" : "Local Codex") : (zh ? "AI 平台智能体" : "AI platform Agent")}</h2>
                <p>{activeConfigurationAgent?.description || (zh ? "当前环境中尚未发现此类智能体。" : "No Agent of this type was found in the current environment.")}</p>
              </div>
              {activeAgentConfigurationTab === "platform" && (
                <div className="settings-row">
                  <span><strong>{zh ? "平台智能体" : "Platform Agent"}</strong><small>{zh ? "选择需要独立配置的 AI 平台智能体。" : "Choose the AI platform Agent to configure independently."}</small></span>
                  <select value={platformConfigurationAgent?.id ?? ""} onChange={(event) => setPlatformConfigurationAgentId(event.target.value)} disabled={platformConfigurationAgents.length === 0}>
                    {platformConfigurationAgents.length === 0 && <option value="">{zh ? "暂无平台智能体" : "No platform Agent"}</option>}
                    {platformConfigurationAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </div>
              )}
              <div className="settings-row">
                <span><strong>{zh ? "主模型" : "Primary model"}</strong><small>{zh ? "与聊天输入框使用同一个模型，用于对话、推理和工具调用。" : "Shared with the chat composer for conversations, reasoning, and tool calls."}</small></span>
                <div className="settings-model-control">
                  <select data-testid="agent-text-model-select" aria-label={zh ? "主模型" : "Primary model"} value={activeAgentModel} onChange={(event) => {
                    if (!activeConfigurationAgent) return;
                    if (activeAgentConfigurationTab !== "opendrsai") { onConfigureAgentModel(activeConfigurationAgent.id, event.target.value); return; }
                    const [providerId, modelId] = event.target.value.split("::").map(decodeURIComponent);
                    const descriptor = activeAgentModels.find((model) => model.provider_id === providerId && model.alias === modelId);
                    const efforts = descriptor?.operations?.includes("reasoning") ? descriptor.reasoning_efforts ?? [] : [];
                    setAgentModelPolicyDraft((current) => current ? {
                      ...current,
                      primary_model: { mode: "explicit", ref: { provider_id: providerId, model_id: modelId } },
                      reasoning_effort: current.reasoning_effort && efforts.includes(current.reasoning_effort)
                        ? current.reasoning_effort
                        : efforts.includes("high") ? "high" : efforts[0] ?? null,
                    } : current);
                    setAgentModelPolicyDirty(true);
                    setAgentModelPolicyMessage(null);
                  }} disabled={!activeConfigurationAgent || activeAgentModels.length === 0}>
                    {activeAgentModels.length === 0 && <option value="">{zh ? "暂无可用模型" : "No model available"}</option>}
                    {Object.entries(activeAgentModelGroups).map(([provider, providerModels]) => <optgroup key={provider} label={provider}>
                      {providerModels.map((model) => {
                        const selected = model.provider_id === displayedPrimaryModelRef?.provider_id && model.alias === displayedPrimaryModelRef?.model_id;
                        const usable = isSelectableModelAvailability(model.availability);
                        const primaryReady = supportsFullAgentPrimaryRuntime(model);
                        const status = !primaryReady
                          ? (zh ? " · 不可作主模型" : " · not a primary model")
                          : usable ? "" : ` · ${model.availability}`;
                        return <option key={`${model.provider_id || "backend"}:${model.alias}`} disabled={(!usable || !primaryReady) && !selected} value={activeAgentConfigurationTab === "opendrsai" ? `${encodeURIComponent(model.provider_id || "") }::${encodeURIComponent(model.alias)}` : model.alias}>{`${model.display_name || model.alias}${status}`}</option>;
                      })}
                    </optgroup>)}
                  </select>
                  {activeAgentModelProvider && <small className="settings-model-provider" data-testid="agent-text-model-provider">{zh ? `提供方：${activeAgentModelProvider}` : `Provider: ${activeAgentModelProvider}`}</small>}
                </div>
              </div>
              {activeAgentConfigurationTab === "opendrsai" && (activeAgentModels.length === 0 || activeAgentModelUnavailable || modelCatalogState !== "fresh") && <div className="model-catalog-recovery" data-testid="agent-model-catalog-recovery" role="status" aria-live="polite" data-state={activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability : modelCatalogState}>
                <strong>{modelCatalogRecoveryCopy(activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability ?? "error" : modelCatalogState, zh).title}</strong>
                <p>{modelCatalogRecoveryCopy(activeAgentModelUnavailable ? activeAgentModelDescriptor?.availability ?? "error" : modelCatalogState, zh).message}</p>
                <div>
                  <button type="button" data-testid="agent-model-refresh" onClick={onRefreshAgentModels}>{zh ? "刷新模型" : "Refresh models"}</button>
                  {(modelCatalogState === "unauthorized" || activeAgentModelDescriptor?.availability === "unauthorized") && <button type="button" data-testid="agent-model-sign-in" onClick={() => void onLogout()}>{zh ? "重新登录" : "Sign in again"}</button>}
                </div>
              </div>}
              {activeAgentConfigurationTab === "opendrsai" && capabilityModelSettings.map((setting) => {
                const value = setting.selection?.mode === "explicit" && setting.selection.ref
                  ? `${encodeURIComponent(setting.selection.ref.provider_id)}::${encodeURIComponent(setting.selection.ref.model_id)}`
                  : "";
                const groups = setting.models.reduce<Record<string, MyDrSaiModelConfig[]>>((result, model) => {
                  (result[model.provider_id || (zh ? "其他来源" : "Other sources")] ??= []).push(model);
                  return result;
                }, {});
                const selectedProvider = setting.selection?.mode === "explicit" && setting.selection.ref ? setting.selection.ref.provider_id : undefined;
                return <div className="settings-row" data-testid={setting.testId} key={setting.role}>
                  <span><strong>{setting.label}</strong><small>{setting.description}</small></span>
                  <div className="settings-model-control">
                    <select aria-label={setting.label} value={value} onChange={(event) => {
                      const selection = event.target.value
                        ? (() => {
                            const [providerId, modelId] = event.target.value.split("::").map(decodeURIComponent);
                            return { mode: "explicit" as const, ref: { provider_id: providerId, model_id: modelId } };
                          })()
                        : null;
                      setAgentModelPolicyDraft((current) => current ? { ...current, [setting.role]: selection } : current);
                      setAgentModelPolicyDirty(true);
                      setAgentModelPolicyMessage(null);
                    }} disabled={setting.models.length === 0}>
                      <option value="">{setting.models.length === 0
                        ? (zh ? "暂无匹配模型" : "No matching model")
                        : setting.role === "image_generation_model"
                          ? (zh ? "默认" : "Default")
                          : (zh ? "未指定" : "Not assigned")}</option>
                      {Object.entries(groups).map(([provider, providerModels]) => <optgroup key={provider} label={provider}>
                        {providerModels.map((model) => {
                          const selected = setting.selection?.mode === "explicit"
                            && setting.selection.ref?.provider_id === model.provider_id
                            && setting.selection.ref?.model_id === model.alias;
                          const usable = ["available", "configured_unverified"].includes(model.availability ?? "");
                          const status = !usable
                            ? (model.availability === "unauthorized"
                              ? (zh ? "（需重新登录）" : " (sign in again)")
                              : model.availability === "unavailable" || model.availability === "offline"
                                ? (zh ? "（维护中/不可用）" : " (unavailable)")
                                : (zh ? "（不可选）" : " (not selectable)"))
                            : "";
                          return <option
                            key={`${model.provider_id}:${model.alias}`}
                            disabled={!usable && !selected}
                            value={`${encodeURIComponent(model.provider_id || "")}::${encodeURIComponent(model.alias)}`}
                          >{`${model.display_name || model.alias}${status}`}</option>;
                        })}
                      </optgroup>)}
                    </select>
                    {selectedProvider && <small className="settings-model-provider" data-testid={`agent-${setting.role.replaceAll("_", "-")}-provider`}>{zh ? `提供方：${selectedProvider}` : `Provider: ${selectedProvider}`}</small>}
                  </div>
                </div>;
              })}
              {activeAgentConfigurationTab === "opendrsai" && <div className="model-capability-status" data-testid="agent-model-capability-status" aria-live="polite">
                <div>
                  <strong>{zh ? "模型能力验证" : "Model capability verification"}</strong>
                  <small>{zh ? "区分已声明、Provider 已验证和 Runtime 已验证；未验证状态不会放行回归测试。" : "Distinguishes declared, Provider-verified, and Runtime-verified capabilities. Unverified states do not pass regression preflight."}</small>
                </div>
                <button type="button" disabled={modelCapabilityStatusBusy} onClick={() => void refreshModelCapabilityStatus()}>{modelCapabilityStatusBusy ? (zh ? "读取中…" : "Loading…") : (zh ? "刷新状态" : "Refresh status")}</button>
                {modelCapabilityStatusError && <p role="alert">{modelCapabilityStatusError}</p>}
                {!modelCapabilityStatusError && !modelCapabilityStatusBusy && (modelCapabilityStatus?.capabilities.length ?? 0) === 0 && <p>{zh ? "尚无真实能力探针结果。请先运行 P2 模型探针。" : "No real capability probe results yet. Run the P2 model probe first."}</p>}
                {(modelCapabilityStatus?.capabilities ?? []).map((capability) => <div className="model-capability-status-row" key={`${capability.model_id}:${capability.operation}`}>
                  <span><code>{capability.model_id}</code><small>{capability.operation} · {capability.protocol}</small></span>
                  <em data-state={capability.status}>{capability.status === "runtime_verified" ? (zh ? "Runtime 已验证" : "Runtime verified") : capability.status === "verified" ? (zh ? "Provider 已验证" : "Provider verified") : capability.status}</em>
                </div>)}
              </div>}
              <div className="settings-row">
                <span><strong>{zh ? "思考强度" : "Thinking effort"}</strong><small>{zh ? "可在每次发送前从聊天输入区临时调整。" : "Can still be changed in the composer before sending."}</small></span>
                <select value={activeAgentThinkingEfforts.includes(activeAgentThinkingEffort) ? activeAgentThinkingEffort : activeAgentThinkingEfforts.includes("high") ? "high" : activeAgentThinkingEfforts[0] ?? ""} disabled={!activeConfigurationAgent || activeAgentThinkingEfforts.length === 0} onChange={(event) => {
                  if (!activeConfigurationAgent) return;
                  const effort = event.target.value as ThinkingEffort;
                  if (activeAgentConfigurationTab !== "opendrsai") { void onConfigureAgentThinkingEffort(activeConfigurationAgent.id, effort); return; }
                  setAgentModelPolicyDraft((current) => current ? { ...current, reasoning_effort: effort } : current);
                  setAgentModelPolicyDirty(true);
                  setAgentModelPolicyMessage(null);
                }}>
                  {activeAgentThinkingEfforts.length === 0 && <option value="">{zh ? "当前模型不支持" : "Not supported by this model"}</option>}
                  {activeAgentThinkingEfforts.includes("none") && <option value="none">{zh ? "不思考" : "Off"}</option>}
                  {activeAgentThinkingEfforts.includes("low") && <option value="low">{zh ? "低" : "Low"}</option>}
                  {activeAgentThinkingEfforts.includes("medium") && <option value="medium">{zh ? "中" : "Medium"}</option>}
                  {activeAgentThinkingEfforts.includes("high") && <option value="high">{zh ? "高" : "High"}</option>}
                  {activeAgentThinkingEfforts.includes("xhigh") && <option value="xhigh">{zh ? "极高" : "Extra high"}</option>}
                  {activeAgentThinkingEfforts.includes("max") && <option value="max">{zh ? "最大" : "Max"}</option>}
                </select>
              </div>
              {activeAgentConfigurationTab === "opendrsai" && <div className="settings-actions agent-model-policy-actions">
                <button type="button" className="primary" data-testid="save-agent-model-policy" disabled={!agentModelPolicyDirty || agentModelPolicySaving || !agentModelPolicyDraft || !openDrSaiConfigurationAgent} onClick={() => void saveAgentModelConfiguration()}>
                  {agentModelPolicySaving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存模型配置" : "Save model configuration")}
                </button>
                {agentModelPolicyMessage && <span className="settings-message" role="status" aria-live="polite">{agentModelPolicyMessage}</span>}
              </div>}
            </section>
            {activeAgentConfigurationTab === "opendrsai" && <section className="settings-section">
              <div><h2>{zh ? "执行与上下文" : "Execution and context"}</h2><p>{zh ? "这些选项保存到当前 OpenDrSai 配置，并受现有审批策略约束。" : "These options are saved to the current OpenDrSai configuration and remain governed by approval policy."}</p></div>
              <label className="settings-toggle"><span><strong>{zh ? "先规划再执行" : "Plan mode"}</strong><small>{zh ? "让智能体先生成计划，再开始执行。" : "Ask the Agent to create a plan before acting."}</small></span><input type="checkbox" checked={Boolean(myDrSaiConfig?.config.plan_mode)} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ plan_mode: event.target.checked })} /></label>
              <label className="settings-toggle"><span><strong>{zh ? "限制在当前工作区" : "Restrict to current workspace"}</strong><small>{zh ? "文件操作优先限制在当前工作区，越界操作继续走审批。" : "Prefer file operations inside the current workspace; out-of-scope actions still require approval."}</small></span><input type="checkbox" checked={myDrSaiConfig?.config.workspace_enabled !== false} disabled={agentConfigSaving || !myDrSaiConfig?.ready} onChange={(event) => void updateAgentConfig({ workspace_enabled: event.target.checked })} /></label>
              {agentConfigMessage && <div className="settings-message">{agentConfigMessage}</div>}
            </section>}
            {activeAgentConfigurationTab === "opendrsai" && activeConfigurationAgent && <AgentResourcesSettings agentId={activeConfigurationAgent.id} zh={zh} onManagePerceptors={() => setActivePane("perceptors")} />}
          </>
        )}

        {activePane === "perceptors" && <PerceptorSettingsPanel language={language} />}

        {activePane === "executors" && (
          <>
            <header className="settings-content-header"><h2>{zh ? "执行器配置" : "Executor configuration"}</h2><p>{zh ? "管理会运行操作或改变外部状态的可复用执行环境。执行权限和审批策略仍由具体智能体绑定决定。" : "Manage reusable execution environments that run operations or change external state. Agent bindings still own permissions and approval policy."}</p></header>
            <section className="settings-section settings-empty-state"><TerminalIcon size={25} /><strong>{zh ? "执行器注册表将在下一阶段开放" : "Executor registry is coming next"}</strong><span>{zh ? "本地 Shell、沙箱、远程 Runtime、浏览器控制和大装置控制将作为独立执行器接入；感知与控制不会混用授权。" : "Local shell, sandboxes, remote runtimes, browser control, and facility control will be registered independently; sensing and control never share authorization."}</span></section>
          </>
        )}

        {activePane === "memories" && (
          <>
            <header className="settings-content-header"><h2>{zh ? "记忆器配置" : "Memory configuration"}</h2><p>{zh ? "管理交互形成的用户、任务与情境状态。知识库继续保存外部事实与文档，两者生命周期相互独立。" : "Manage user, task, and situational state formed through interaction. Knowledge bases continue to hold external facts and documents with a separate lifecycle."}</p></header>
            <section className="settings-section settings-empty-state"><History size={25} /><strong>{zh ? "记忆器注册表将在下一阶段开放" : "Memory registry is coming next"}</strong><span>{zh ? "后续将提供存储范围、保留周期、自动召回、显式写入和加密状态；默认不会把大装置数据自动写入长期记忆。" : "The next stage adds storage scope, retention, automatic recall, explicit writes, and encryption status; facility data is never written to long-term memory by default."}</span></section>
          </>
        )}

        {activePane === "agent-task" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "智能体任务" : "Agent tasks"}</h2>
              <p>{zh ? "创建独立的智能体任务，并在会话中继续管理执行过程。" : "Create an isolated Agent task and manage its run from the conversation."}</p>
            </header>
            <section className="settings-section settings-action-section">
              <Bot size={22} />
              <div>
                <h2>{zh ? "新建智能体任务" : "New Agent task"}</h2>
                <p>{zh ? "基于当前工作区创建新的智能体任务会话。" : "Start a new Agent task for the current workspace."}</p>
              </div>
              <button type="button" onClick={onNewAgentTask}>{zh ? "创建任务" : "Create task"}</button>
            </section>
          </>
        )}

        {activePane === "approvals" && <div className="settings-embedded-view">{approvalCenterPanel}</div>}
        {activePane === "analytics" && <div className="settings-embedded-view">{usageAnalyticsPanel}</div>}
        {activePane === "channels" && <>
          <div className="settings-embedded-view">{channelsPanel}</div>
          {dataPerceptorsPanel ? <div className="settings-embedded-view settings-data-perceptors">{dataPerceptorsPanel}</div> : null}
        </>}

        {activePane === "codex" && <CodexIntegrationSettings
          busy={updateBusy}
          health={health}
          language={language}
          status={codexStatus}
          onRefresh={onCodexRefresh}
          onRestart={onCodexRestart}
          onRepair={onCodexRepair}
          onLogin={onCodexLogin}
          onLogout={onCodexLogout}
          onUseCodex={onUseCodex}
          workspaces={workspaces}
          onSyncWorkspaceSessions={onSyncWorkspaceSessions}
        />}

        {activePane === "integrations" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "通用设置" : "General"}</h2>
              <p>{zh ? "管理可选的本机智能体，以及外部消息、工具和桌面上下文入口。" : "Manage optional local Agents, external messaging, tools, and desktop context."}</p>
            </header>
            <div className="settings-connection-card-list" data-testid="agent-integration-cards">
              <article className={`settings-connection-card ${expandedIntegrationCard === "codex" ? "is-expanded" : ""}`}>
                <div className="settings-connection-card-header">
                  <button type="button" className="settings-connection-card-summary" aria-expanded={expandedIntegrationCard === "codex"} onClick={() => setExpandedIntegrationCard((current) => current === "codex" ? null : "codex")}>
                    <span className="settings-connection-card-logo"><OpenAiBrandIcon size={25} /></span>
                    <span><strong>Codex</strong><small>{zh ? "OpenAI 官方编程智能体，通过 OpenDrSai Codex Adapter 接入。" : "OpenAI's official coding Agent, connected through the OpenDrSai Codex Adapter."}</small></span>
                    <em className={codexIntegrationUnavailableReason ? "" : codexConfigurationAgent ? "is-ready" : ""}>{codexIntegrationUnavailableReason ? (zh ? "不可用" : "Unavailable") : codexConfigurationAgent ? (zh ? "已启用" : "Enabled") : (zh ? "未启用" : "Disabled")}</em>
                    {expandedIntegrationCard === "codex" ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {expandedIntegrationCard === "codex" && <div className="settings-connection-card-body">
                  <p>{codexIntegrationUnavailableReason ?? (zh ? "任务过程遵循 OpenDrSai 智能体执行协议，可保留运行记录，并将工作区数据和技能资产沉淀下来。" : "Runs follow the OpenDrSai Agent execution protocol so records remain reproducible and workspace data and skills can be retained.")}</p>
                  <div className="settings-integration-actions"><button type="button" disabled={Boolean(codexIntegrationUnavailableReason)} title={codexIntegrationUnavailableReason ?? undefined} onClick={() => { if (codexIntegrationUnavailableReason) return; setActivePane("codex"); }}>{zh ? "管理 Codex" : "Manage Codex"}</button></div>
                </div>}
              </article>
              <article className={`settings-connection-card ${expandedIntegrationCard === "deepseek-harness" ? "is-expanded" : ""}`}>
                <div className="settings-connection-card-header">
                  <button type="button" className="settings-connection-card-summary" aria-expanded={expandedIntegrationCard === "deepseek-harness"} onClick={() => setExpandedIntegrationCard((current) => current === "deepseek-harness" ? null : "deepseek-harness")}>
                    <span className="settings-connection-card-logo"><ModelProviderLogo provider="deepseek" /></span>
                    <span><strong>DeepSeek Harness</strong><small>{zh ? "可选的本机编程智能体集成。" : "An optional local coding Agent integration."}</small></span>
                    <em className={deepSeekHarnessAgent ? "is-ready" : ""}>{deepSeekHarnessAgent ? (zh ? "已启用" : "Enabled") : (zh ? "未启用" : "Disabled")}</em>
                    {expandedIntegrationCard === "deepseek-harness" ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {expandedIntegrationCard === "deepseek-harness" && <div className="settings-connection-card-body">
                  <p>{deepSeekHarnessAgent ? (zh ? "当前 Runtime 已发现 DeepSeek Harness，可在智能体配置中设置模型和运行偏好。" : "The Runtime has discovered DeepSeek Harness. Configure its model and runtime preferences in Agent configuration.") : (zh ? "当前未启用。启用对应 Runtime 集成后，它会出现在智能体列表中。" : "It is currently disabled. Once its Runtime integration is enabled, it appears in the Agent list.")}</p>
                  <div className="settings-integration-actions"><button type="button" disabled={!deepSeekHarnessAgent || Boolean(agentDefaultsUnavailableReason)} title={agentDefaultsUnavailableReason ?? undefined} onClick={() => { if (!deepSeekHarnessAgent) return; selectConfigurationAgent(deepSeekHarnessAgent); setActivePane("agent-defaults"); }}>{zh ? "配置智能体" : "Configure Agent"}</button></div>
                </div>}
              </article>
            </div>
            <section className="settings-section settings-integration-list settings-context-integrations">
              <div><h2>{zh ? "上下文与工具" : "Context and tools"}</h2><p>{zh ? "这些入口按当前桌面能力自动显示。" : "These entries follow the capabilities available to this desktop."}</p></div>
              {featureCapabilities?.channels === true && <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "频道" : "Channels"}</strong><small>{zh ? "连接消息渠道并导入只读上下文。" : "Connect message channels and import reviewed context."}</small></span><button type="button" onClick={() => setActivePane("channels")}>{zh ? "管理" : "Manage"}</button></div>}
              {featureCapabilities?.mcp === true && featureCapabilities?.approvals === true && <div className="settings-integration-row"><Plug size={18} /><span><strong>{zh ? "工具连接" : "MCP"}</strong><small>{zh ? "在审批中心管理外部工具连接和操作确认。" : "Manage MCP sessions and tool approvals in Approval Center."}</small></span><button type="button" onClick={() => setActivePane("approvals")}>{zh ? "管理" : "Manage"}</button></div>}
              <div className="settings-integration-row"><FileText size={18} /><span><strong>IDE</strong><small>{ideContext?.currentFile?.path || (zh ? "当前没有 IDE 文件上下文" : "No IDE file context is active")}</small></span><em>{ideContext ? (zh ? "已连接" : "Connected") : (zh ? "未连接" : "Not connected")}</em></div>
              {featureCapabilities?.browser === true && <div className="settings-integration-row"><Globe2 size={18} /><span><strong>{zh ? "浏览器" : "Browser"}</strong><small>{zh ? "使用右侧浏览器面板查看和附加网页上下文。" : "Use the right browser panel to inspect and attach web context."}</small></span><button type="button" onClick={onOpenBrowserPanel}>{zh ? "打开" : "Open"}</button></div>}
              {(featureCapabilities?.serialVoice === true || featureCapabilities?.streamingVoice === true) && <div className="settings-integration-row"><MessageSquare size={18} /><span><strong>{zh ? "语音" : "Voice"}</strong><small>{zh ? "聊天输入区使用的语音转写运行时。" : "Voice transcription runtime used by the chat composer."}</small></span><em>{voiceIntegrationState === null ? (zh ? "检查中" : "Checking") : voiceIntegrationState}</em></div>}
            </section>
          </>
        )}

        {activePane === "remote-workspace" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "远程工作区" : "Remote Workspace"}</h2>
              <p>{zh ? "管理可用于远程工作区的计算机，以及 Android 端访问此电脑的连接。" : "Manage computers available to remote workspaces and Android access to this computer."}</p>
            </header>
            <div className="remote-workspace-settings" data-testid="remote-workspace-settings">
              <section className="settings-section settings-integration-list remote-computers-card">
                <div className="settings-integration-row" data-testid="remote-computers-entry"><TerminalIcon size={18} /><span><strong>{zh ? "远程计算机" : "Remote computers"}</strong><small>{zh ? "已配置、可用于远程工作区的计算机。" : "Configured computers available to remote workspaces."}</small></span><em>{remoteHostCount === null ? (zh ? "检查中" : "Checking") : zh ? `${remoteHostCount} 台计算机` : `${remoteHostCount} computers`}</em></div>
              </section>
              <div className={`settings-connection-card android-remote-panel ${androidPanelExpanded ? "is-expanded" : ""}`} data-testid="android-remote-panel">
                <div className="settings-connection-card-header android-remote-header">
                  <button type="button" className="settings-connection-card-summary" aria-expanded={androidPanelExpanded} onClick={() => setAndroidPanelExpanded((expanded) => !expanded)}>
                    <span className="settings-connection-card-logo android"><Smartphone size={19} /></span>
                    <span>
                      <strong>Android</strong>
                      <small>{zh ? "OpenDrSai Android 远程连接与设备管理。" : "OpenDrSai Android remote connection and device management."}</small>
                    </span>
                    <em className={mobilePairingUnavailableReason ? "" : androidRemoteEnabled ? "is-ready" : ""}>{mobilePairingUnavailableReason ? (zh ? "不可用" : "Unavailable") : androidRemoteEnabled ? (zh ? "可用" : "Available") : (zh ? "未启用" : "Disabled")}</em>
                    {androidPanelExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <div className="settings-integration-actions">
                    <button type="button" role="switch" aria-checked={androidRemoteEnabled} aria-label={androidRemoteEnabled ? (zh ? "暂停 Android 远程访问" : "Pause Android remote access") : (zh ? "恢复 Android 远程访问" : "Resume Android remote access")} className={`settings-connection-switch ${androidRemoteEnabled ? "is-enabled" : ""}`} data-testid="android-remote-toggle" title={mobilePairingUnavailableReason ?? undefined} disabled={Boolean(mobilePairingUnavailableReason) || mobileEnrollmentBusy || mobileAssociationsState === "loading"} onClick={() => { if (mobilePairingUnavailableReason) return; if (androidRemoteEnabled) void pauseMobileRemoteAccess(); else void enableMobileRemoteAccess(); }}><span aria-hidden="true" /></button>
                  </div>
                </div>
                {androidPanelExpanded && <div className="settings-connection-card-body android-remote-body">
                {mobilePairingUnavailableReason ? (
                  <p className="android-remote-message" data-state="unavailable" data-testid="android-device-state">{mobilePairingUnavailableReason}</p>
                ) : (<>
                <div className="android-remote-counts" data-testid="android-device-counts">
                  <span>{zh ? `已授权设备 ${activeAndroidAssociations.length}` : `Authorized devices ${activeAndroidAssociations.length}`}</span>
                  <span>{zh ? `当前在线 ${androidOnlineDeviceCount}` : `Online now ${androidOnlineDeviceCount}`}</span>
                </div>
                {androidPanelMessage ? <p className="android-remote-message" data-state={mobileAssociationsState} data-testid="android-device-state">{androidPanelMessage}</p> : null}
                {activeAndroidAssociations.length > 0 ? (
                  <div className="android-device-list" data-testid="android-device-list">
                    {activeAndroidAssociations.map((association) => (
                      <div key={association.association_id} className="android-device-row" data-state={association.access_state} data-testid="android-device-row">
                        <span className="android-device-presence" aria-hidden="true" />
                        <span><strong>{association.device_name}</strong><small>{association.device_type === "android" ? (zh ? "Android 设备" : "Android device") : association.device_type} · {association.workspace_scope === "selected" ? (zh ? `${association.workspace_ids?.length ?? 0} 个指定工作区` : `${association.workspace_ids?.length ?? 0} selected workspaces`) : (zh ? "全部工作区" : "All workspaces")} · {association.permissions.map((permission) => androidPermissionText[permission]).join(" / ")} · {zh ? "授权于" : "Authorized"} {new Date(association.created_at).toLocaleDateString()}</small></span>
                        <em data-testid="android-device-status">{androidDeviceStateText[association.access_state]}{association.last_seen_at ? ` · ${androidRelativeTime(association.last_seen_at, language)}` : ""}</em>
                        <div className="android-device-actions">
                          <button type="button" disabled={mobileEnrollmentBusy} data-testid="android-device-scope" onClick={() => void openAndroidDeviceScopeEditor(association)}><Settings size={13} aria-hidden="true" />{zh ? "管理范围" : "Manage scope"}</button>
                          {association.permissions.some((permission) => permission !== "read") ? <button type="button" disabled={mobileEnrollmentBusy} data-testid="android-device-read-only" onClick={() => void makeAndroidDeviceReadOnly(association)}><ShieldCheck size={13} aria-hidden="true" />{zh ? "设为只读" : "Make read-only"}</button> : null}
                          <button type="button" className="danger" disabled={mobileEnrollmentBusy} data-testid="android-device-revoke" onClick={() => void revokeAndroidDevice(association)}><Trash2 size={13} aria-hidden="true" />{zh ? "撤销" : "Revoke"}</button>
                        </div>
                        {mobileScopeEditor?.association.association_id === association.association_id ? (
                          <div className="android-device-scope-editor" data-testid="android-device-scope-editor">
                            <strong>{zh ? "允许的操作" : "Allowed actions"}</strong>
                            {mobileScopeEditor.association.permissions.map((permission) => (
                              <label key={permission}>
                                <input
                                  type="checkbox"
                                  checked={mobileScopeEditor.selectedPermissions.has(permission)}
                                  onChange={(event) => setMobileScopeEditor((current) => {
                                    if (!current) return current;
                                    const selectedPermissions = new Set(current.selectedPermissions);
                                    if (event.target.checked) selectedPermissions.add(permission); else selectedPermissions.delete(permission);
                                    return {
                                      ...current,
                                      ...mobileAssociationScopeEditorState(
                                        current.association,
                                        current.workspaces,
                                        current.selectedIds,
                                        selectedPermissions,
                                      ),
                                    };
                                  })}
                                />
                                <span>{androidPermissionText[permission]}</span>
                              </label>
                            ))}
                            <strong>{zh ? "仅允许以下工作区" : "Allow only these workspaces"}</strong>
                            <small>{zh ? "保存后只能继续缩小；扩大范围需要重新连接设备。" : "After saving, this can only be narrowed further. Re-pair the device to expand access."}</small>
                            {mobileScopeEditor.workspaces.map((workspace) => (
                              <label key={workspace.id}>
                                <input
                                  type="checkbox"
                                  checked={mobileScopeEditor.selectedIds.has(workspace.id)}
                                  onChange={(event) => setMobileScopeEditor((current) => {
                                    if (!current) return current;
                                    const selectedIds = new Set(current.selectedIds);
                                    if (event.target.checked) selectedIds.add(workspace.id); else selectedIds.delete(workspace.id);
                                    return {
                                      ...current,
                                      ...mobileAssociationScopeEditorState(
                                        current.association, current.workspaces, selectedIds,
                                        current.selectedPermissions,
                                      ),
                                    };
                                  })}
                                />
                                <span>{workspace.name}</span>
                              </label>
                            ))}
                            <div className="settings-integration-actions">
                              <button type="button" onClick={() => setMobileScopeEditor(null)}>{zh ? "取消" : "Cancel"}</button>
                              <button type="button" disabled={mobileEnrollmentBusy || !mobileScopeEditor.canSave} onClick={() => void saveAndroidDeviceScope()} data-testid="android-device-scope-save">{zh ? "保存较小范围" : "Save narrower scope"}</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="settings-button-row settings-danger-actions" data-testid="android-danger-actions">
                  <button type="button" className={`android-refresh-button ${mobileAssociationsState === "loading" ? "is-loading" : ""}`} onClick={() => void refreshAndroidDevices()} disabled={mobileAssociationsState === "loading"} aria-busy={mobileAssociationsState === "loading"} data-testid="android-refresh"><RefreshCw size={14} aria-hidden="true" />{zh ? "刷新" : "Refresh"}</button>
                  <button type="button" onClick={onOpenMobilePairing} disabled={!androidRemoteEnabled || mobileEnrollmentBusy} data-testid="android-connect"><Smartphone size={14} aria-hidden="true" />{zh ? "连接 Android" : "Connect Android"}</button>
                  <button type="button" disabled={mobileEnrollmentBusy || mobilePairingReadiness?.state === "not_registered"} onClick={() => void renameAndroidRuntime()} data-testid="android-runtime-rename">{zh ? "重命名此电脑" : "Rename this computer"}</button>
                  <button type="button" disabled={mobileEnrollmentBusy} onClick={() => void diagnoseAndroidRuntime()} data-testid="android-runtime-diagnose">{zh ? "连接诊断" : "Diagnose connection"}</button>
                  <button type="button" className="danger" disabled={mobileEnrollmentBusy || activeAndroidAssociations.length === 0} onClick={() => void revokeAllAndroidDevices()} data-testid="android-revoke-all">{zh ? "撤销全部设备" : "Revoke all devices"}</button>
                  <button type="button" className="danger" disabled={mobileEnrollmentBusy || mobilePairingReadiness?.state === "not_registered"} onClick={() => void revokeMobileEnrollment()} data-testid="android-revoke-enrollment">{zh ? "注销此电脑" : "Unregister this computer"}</button>
                </div>
                </>)}
                </div>}
              </div>
            </div>
          </>
        )}

        {activePane === "archived-sessions" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "已归档会话" : "Archived sessions"}</h2>
              <p>{zh ? "集中查找和恢复已归档的 OpenDrSai 与 Codex 会话。归档不会删除消息或工作区内容。" : "Find and restore archived OpenDrSai and Codex sessions. Archiving preserves messages and workspace content."}</p>
            </header>
            <section className="settings-section archived-threads-settings" data-testid="archived-threads-settings">
              <div>
                <h2>{zh ? `会话（${archivedThreads.length}）` : `Sessions (${archivedThreads.length})`}</h2>
                <p>{archiveSearch.trim() ? (zh ? "显示与当前搜索匹配的归档会话。" : "Showing archived sessions matching the current search.") : (zh ? "按标题搜索，或取消归档以将会话恢复到侧边栏。" : "Search by title, or unarchive a session to restore it to the sidebar.")}</p>
              </div>
              <div className="settings-component-list">
                <input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder={zh ? "搜索已归档会话" : "Search archived sessions"} aria-label={zh ? "搜索已归档会话" : "Search archived sessions"} />
                {archivedThreads.length === 0 ? <small>{zh ? "没有匹配的已归档会话。" : "No archived sessions match."}</small> : archivedThreads.map((thread) => (
                  <div className="settings-row" key={thread.id}><span><strong>{thread.title}</strong><small>{thread.archiveSource === "codex" ? "Codex" : "OpenDrSai"}</small></span><button type="button" onClick={() => void Promise.resolve(onArchiveThread(thread.id, false)).catch(() => showAppNotice({ id: "unarchive-failed", title: zh ? "无法恢复会话" : "Conversation could not be restored", description: zh ? "取消归档失败，请重试。" : "Unarchive failed. Please retry." }))}>{zh ? "取消归档" : "Unarchive"}</button></div>
                ))}
                {archivedThreadsHasMore && !archiveSearch.trim() ? <button type="button" disabled={archivedThreadsLoading} onClick={() => void onLoadArchivedThreads()}>{archivedThreadsLoading ? (zh ? "正在加载…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
              </div>
            </section>
          </>
        )}

        {activePane === "other" && (
          <>
            <header className="settings-content-header">
              <h2>{zh ? "系统与路径" : "System and paths"}</h2>
              <p>{zh ? "查看 OpenDrSai 使用的本地运行环境。" : "Inspect the local runtime used by OpenDrSai."}</p>
            </header>
            <section className="settings-section">
              <h2>{zh ? "路径" : "Paths"}</h2>
              <dl>
                <div><dt>{zh ? "OpenDrSai 主目录" : "OpenDrSai home"}</dt><dd>{health?.install.home || (zh ? "未知" : "unknown")}</dd>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开" : "Open"}</button>}</div>
                <div><dt>{zh ? "仓库" : "Repository"}</dt><dd>{health?.install.repoPath || (zh ? "未知" : "unknown")}</dd>{health?.install.repoPath && <button type="button" onClick={() => onOpenPath(health.install.repoPath)}>{zh ? "打开" : "Open"}</button>}</div>
                <div><dt>Python</dt><dd>{health?.install.pythonPath || (zh ? "未知" : "unknown")}</dd></div>
              </dl>
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "应用与更新" : "App and updates"}</h2><p>{zh ? "检查 OpenDrSai 桌面端更新。" : "Check for OpenDrSai Desktop updates."}</p></div>
              <div className="settings-row"><span><strong>{zh ? "更新状态" : "Update status"}</strong><small>{formatUpdateStatus(health, language)}</small></span><button type="button" onClick={onCheckUpdates} disabled={updateBusy}>{updateBusy ? (zh ? "检查中..." : "Checking...") : (zh ? "检查更新" : "Check updates")}</button></div>
              {updateMessage && <div className="settings-message">{updateMessage}</div>}
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "数据与隐私" : "Data and privacy"}</h2><p>{zh ? "导出数据、清除 OpenDrSai 应用数据，或仅重置桌面偏好。" : "Export data, clear OpenDrSai app data, or reset desktop preferences only."}</p></div>
              <div className="settings-data-boundary" data-testid="data-cleanup-boundary">
                <p><strong>{zh ? "应用数据" : "App data"}</strong>{zh ? "：账户登录、会话、缓存、记忆、任务和设置，可以在这里清除。" : ": sign-in, conversations, cache, memory, tasks, and settings can be cleared here."}</p>
                <p><strong>{zh ? "用户原始材料" : "Your original files"}</strong>{zh ? "：工作区中的 PDF、PPT、数据文件和生成成果。清理应用数据或从 Windows 卸载 OpenDrSai 都不会删除这些文件。" : ": PDFs, presentations, data files, and generated results in your workspaces. Clearing app data or uninstalling OpenDrSai from Windows does not delete them."}</p>
              </div>
              <div className="settings-button-row"><button type="button" data-testid="export-local-data" onClick={onExportLocalData}>{zh ? "导出本地数据" : "Export local data"}</button><button type="button" onClick={() => void requestAppDecision({ id: "reset-desktop-preferences", title: zh ? "重置桌面偏好？" : "Reset desktop preferences?", description: zh ? "将恢复界面、侧边栏和默认选项。" : "Appearance, sidebar, and default choices will be reset.", impact: zh ? "本地会话和工作区文件会保留。" : "Local conversations and workspace files will be preserved.", confirmLabel: zh ? "重置偏好" : "Reset preferences" }).then((confirmed) => { if (confirmed) onResetPreferences(); })}>{zh ? "重置偏好" : "Reset preferences"}</button></div>
              <div className="settings-button-row settings-danger-actions"><button type="button" data-testid="clear-session-data" disabled={cleanupBusy} onClick={() => void openDataCleanup("sessions")}>{zh ? "清除会话" : "Clear conversations"}</button><button type="button" className="danger" data-testid="clear-all-local-data" disabled={cleanupBusy} onClick={() => void openDataCleanup("all_local_data")}>{zh ? "清除全部应用数据" : "Clear all app data"}</button></div>
              {cleanupStatus ? <p className="settings-message" role="status" data-testid="data-cleanup-status">{cleanupStatus}</p> : null}
            </section>
            <section className="settings-section">
              <div><h2>{zh ? "日志与诊断" : "Logs and diagnostics"}</h2><p>{zh ? "复制当前运行状态，便于排查桌面端问题。" : "Copy the current runtime state for desktop troubleshooting."}</p></div>
              <div className="settings-button-row"><button type="button" onClick={onCopyDiagnostics}>{zh ? "复制诊断信息" : "Copy diagnostics"}</button>{health?.install.home && <button type="button" onClick={() => onOpenPath(health.install.home)}>{zh ? "打开 OpenDrSai 目录" : "Open OpenDrSai home"}</button>}</div>
            </section>
            {developerModeAvailable && <section className="settings-section"><div><h2>{zh ? "开发者选项" : "Developer options"}</h2><p>{zh ? "切换后会重新加载桌面界面。" : "Changing this option reloads the desktop interface."}</p></div><label className="settings-toggle"><span><strong>{zh ? "开发者模式" : "Developer mode"}</strong><small>{zh ? "显示详细状态和调试输出。" : "Show detailed status and debugging output."}</small></span><input type="checkbox" checked={developerMode} onChange={(event) => onDeveloperModeChange(event.target.checked)} /></label></section>}
          </>
        )}
        {cleanupPreview ? (
          <section className="data-cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="data-cleanup-title" data-scope={cleanupPreview.scope} data-testid="data-cleanup-dialog">
            <h2 id="data-cleanup-title">{cleanupPreview.scope === "sessions" ? (zh ? "清除会话？" : "Clear conversations?") : (zh ? "清除全部应用数据？" : "Clear all app data?")}</h2>
            <p>{zh ? "将清除以下 OpenDrSai 应用数据：" : "The following OpenDrSai app data will be removed:"}</p>
            <ul data-testid="data-cleanup-categories">{cleanupPreview.applicationData.map((item) => <li key={item.category}><strong>{item.label}</strong><span>{item.description}</span></li>)}</ul>
            <p className="data-cleanup-preserved" data-testid="data-cleanup-preserved"><strong>{zh ? "不会删除用户原始材料" : "Your original files will not be deleted"}</strong>{zh ? `。已登记 ${cleanupPreview.preservedUserMaterials.length} 个工作区；其中的 PDF、PPT、数据文件和成果都会保留。` : `. Files and results in ${cleanupPreview.preservedUserMaterials.length} registered workspace(s) are preserved.`}</p>
            {cleanupPreview.scope === "all_local_data" ? <label><span>{zh ? `输入“${cleanupPreview.confirmationPhrase}”确认；完成后需要重新登录。` : `Type “${cleanupPreview.confirmationPhrase}” to confirm; you will need to sign in again.`}</span><input data-testid="data-cleanup-confirmation" value={cleanupConfirmation} onChange={(event) => setCleanupConfirmation(event.target.value)} /></label> : null}
            <div className="settings-button-row"><button type="button" data-testid="data-cleanup-cancel" onClick={() => setCleanupPreview(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" className="danger" data-testid="data-cleanup-confirm" disabled={cleanupBusy || (cleanupPreview.scope === "all_local_data" && cleanupConfirmation !== cleanupPreview.confirmationPhrase)} onClick={() => void confirmDataCleanup()}>{cleanupBusy ? (zh ? "正在清除…" : "Clearing…") : (zh ? "确认清除" : "Confirm clear")}</button></div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
