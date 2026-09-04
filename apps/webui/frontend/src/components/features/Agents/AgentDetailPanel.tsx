import React, { useState } from "react";
import {
  ArrowLeft,
  Bot,
  Globe,
  Network,
  User,
  Copy,
  Check,
  Info,
  Settings,
  Play,
  ExternalLink,
  Key,
  Shield,
  Code,
  List,
  Database,
  MessageSquare,
} from "lucide-react";
import type { AgentMode } from "@/types/common";
import type { AgentCardData } from "./AgentCard";
import { getLocalizedDescription } from "../../utils";
import { useLang } from "../../../i18n/useLang";

export interface AgentDetailPanelProps {
  agent: AgentCardData;
  onBack: () => void;
  onStartChat: (agent: AgentCardData) => void;
  onEdit?: (agent: AgentCardData) => void;
  onRemove?: (agent: AgentCardData) => void;
}

type DetailTab = "overview" | "config" | "usage";

const DEFAULT_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "***";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function modeLabelConfig(mode: AgentMode | undefined): {
  text: string;
  className: string;
  dotClass: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (mode) {
    case "remote":
      return {
        text: "Remote",
        className:
          "bg-[#f1f5fb] text-[#587090] dark:bg-[#243247] dark:text-[#dbe8ff]",
        dotClass: "bg-[#86a0c7]",
        Icon: Network,
      };
    case "custom":
      return {
        text: "Custom",
        className:
          "bg-[#f3f1fb] text-[#665d94] dark:bg-[#32284a] dark:text-[#ece4ff]",
        dotClass: "bg-[#9286d1]",
        Icon: User,
      };
    case "besiii":
      return {
        text: "BESIII",
        className:
          "bg-[#f0faf0] text-[#3d7a3d] dark:bg-[#1a3020] dark:text-[#a3d9a3]",
        dotClass: "bg-[#5ba85b]",
        Icon: Bot,
      };
    case "ddf":
      return {
        text: "DDF",
        className:
          "bg-[#fff8ed] text-[#b87a14] dark:bg-[#2e2210] dark:text-[#f5c96a]",
        dotClass: "bg-[#e8a838]",
        Icon: Bot,
      };
    default:
      return {
        text: "Local",
        className:
          "bg-[#f5f5f8] text-[#39404e] dark:bg-[#2b2837] dark:text-[#eff1f7]",
        dotClass: "bg-[#af99f6]",
        Icon: Globe,
      };
  }
}

const CARD_CLS =
  "rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden dark:border-white/[0.06] dark:bg-slate-900";

const AgentDetailPanel: React.FC<AgentDetailPanelProps> = ({
  agent,
  onBack,
  onStartChat,
  onEdit,
  onRemove,
}) => {
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [copied, setCopied] = useState(false);

  const modeInfo = modeLabelConfig(agent.mode);
  const config = agent.config || {};
  const description = getLocalizedDescription(agent.description, lang);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isZh = lang === "zh";

  return (
    <div className="relative flex flex-col gap-5 max-w-full animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-secondary hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("agentDetail.back")}
      </button>

      {/* TOP CARD: Agent info + actions */}
      <div className={`shrink-0 ${CARD_CLS}`}>
        <div className="h-1 w-full bg-gradient-to-r from-accent/60 via-purple-400/40 to-blue-400/30" />
        <div className="p-5">
          <div className="flex flex-col md:flex-row md:items-start gap-4">
            {/* Left: icon + name + meta */}
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <div className="relative shrink-0">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent/15 to-accent/5 shadow-sm ring-1 ring-border-primary/20">
                  <img
                    src={agent.logo}
                    alt=""
                    className="h-8 w-8 max-h-full max-w-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                    }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="break-words text-xl font-bold text-gray-900 dark:text-white leading-tight">
                    {agent.name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${modeInfo.className}`}
                  >
                    <modeInfo.Icon className="h-3 w-3" />
                    {modeInfo.text}
                  </span>
                  {agent.featured && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 shrink-0">
                      <Shield className="h-3 w-3" />
                      {t("agentDetail.featured")}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {agent.owner && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">
                        {agent.owner.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate max-w-[160px]" title={agent.owner}>
                        {agent.owner}
                      </span>
                    </span>
                  )}
                  {agent.url && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <ExternalLink className="h-3 w-3" />
                      <span className="truncate max-w-[200px]" title={agent.url}>
                        {agent.url}
                      </span>
                    </span>
                  )}
                </div>

                {agent.id && (
                  <div className="mt-1.5">
                    <code className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500 dark:bg-white/[0.05] dark:text-gray-400">
                      ID: {agent.id}
                    </code>
                  </div>
                )}
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex md:flex-col gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onStartChat(agent)}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 hover:shadow-md active:scale-[0.98] whitespace-nowrap"
              >
                <Play className="h-4 w-4" />
                {t("agentDetail.startChat")}
              </button>

              {agent.mode === "custom" && onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(agent)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 transition-all hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400 dark:hover:border-purple-500/30 dark:hover:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  {t("agentDetail.edit")}
                </button>
              )}

              {(agent.mode === "remote" || agent.mode === "custom") && onRemove && agent.is_public !== true && (
                <button
                  type="button"
                  onClick={() => onRemove(agent)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-red-500 transition-all hover:border-red-300 hover:bg-red-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-red-400 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"
                >
                  {t("agentDetail.remove")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM CARD: Tabs + content */}
      <div className={`flex flex-col ${CARD_CLS}`}>
        {/* Tab bar */}
        <div className="shrink-0 flex items-center gap-1 border-b border-gray-200/70 bg-gray-50/30 px-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${
              activeTab === "overview"
                ? "border-accent text-accent bg-white dark:bg-slate-900"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            {isZh ? "概览" : "Overview"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("config")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${
              activeTab === "config"
                ? "border-accent text-accent bg-white dark:bg-slate-900"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            {isZh ? "配置" : "Configuration"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("usage")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${
              activeTab === "usage"
                ? "border-accent text-accent bg-white dark:bg-slate-900"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"
            }`}
          >
            <Play className="h-3.5 w-3.5" />
            {isZh ? "使用" : "Usage"}
          </button>
        </div>

        {/* Tab body */}
        <div className="p-5">
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Description */}
              {description && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {isZh ? "描述" : "Description"}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {description}
                  </p>
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                    {isZh ? "模式" : "Mode"}
                  </p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {agent.mode || "default"}
                  </p>
                </div>

                {agent.api_key && (
                  <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      <Key className="inline h-3 w-3 mr-1" />
                      {isZh ? "API Key" : "API Key"}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-100">
                        {maskApiKey(agent.api_key)}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopy(agent.api_key!)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title={isZh ? "复制" : "Copy"}
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {agent.url && (
                  <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      <ExternalLink className="inline h-3 w-3 mr-1" />
                      {isZh ? "连接地址" : "URL"}
                    </p>
                    <p className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[220px]" title={agent.url}>
                      {agent.url}
                    </p>
                  </div>
                )}
              </div>

              {/* System message if present */}
              {config.system_message && (
                <div className="rounded-lg border border-blue-200/60 bg-blue-50/50 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-900/15">
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
                    <Code className="h-3.5 w-3.5" />
                    {isZh ? "系统提示词" : "System Message"}
                  </h3>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-blue-700 dark:text-blue-300 font-mono">
                    {config.system_message}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === "config" && (
            <div className="space-y-5">
              {Object.keys(config).length > 0 ? (
                <>
                  {/* Model client */}
                  {config.model_client && (
                    <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        <Bot className="h-3.5 w-3.5" />
                        {isZh ? "模型客户端" : "Model Client"}
                      </h3>
                      <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-700 dark:text-gray-300">
                        {typeof config.model_client === "string"
                          ? config.model_client
                          : JSON.stringify(config.model_client, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* MCP SSE list */}
                  {config.mcp_sse_list && Array.isArray(config.mcp_sse_list) && config.mcp_sse_list.length > 0 && (
                    <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        <List className="h-3.5 w-3.5" />
                        {isZh ? "MCP SSE 服务列表" : "MCP SSE Services"}
                      </h3>
                      <div className="space-y-1.5">
                        {config.mcp_sse_list.map((item: any, idx: number) => (
                          <div
                            key={idx}
                            className="rounded-md bg-white px-3 py-2 text-xs font-mono text-gray-700 dark:bg-white/[0.04] dark:text-gray-300 border border-gray-100 dark:border-white/[0.05]"
                          >
                            {typeof item === "string" ? item : JSON.stringify(item)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* RAG Flow configs */}
                  {config.ragflow_configs && Array.isArray(config.ragflow_configs) && config.ragflow_configs.length > 0 && (
                    <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        <Database className="h-3.5 w-3.5" />
                        {isZh ? "RAG Flow 配置" : "RAG Flow Configs"}
                      </h3>
                      <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-700 dark:text-gray-300">
                        {JSON.stringify(config.ragflow_configs, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Full config raw */}
                  <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                      <Code className="h-3.5 w-3.5" />
                      {isZh ? "完整配置" : "Full Configuration"}
                    </h3>
                    <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto">
                      {JSON.stringify(config, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Settings className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {isZh ? "暂无配置信息" : "No configuration available"}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "usage" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-accent/20 bg-accent/[0.02] px-4 py-3 dark:border-accent/15 dark:bg-accent/5">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <Play className="h-3.5 w-3.5" />
                  {isZh ? "快速开始" : "Quick Start"}
                </h3>
                <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {isZh
                    ? "点击下方按钮即可开始与该智能体对话。智能体将根据其配置的模型、系统提示词和工具来响应您的请求。"
                    : "Click the button below to start a conversation with this agent. The agent will respond based on its configured model, system message, and tools."}
                </p>
                <button
                  type="button"
                  onClick={() => onStartChat(agent)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-600 hover:shadow-md active:scale-[0.98]"
                >
                  <Play className="h-4 w-4" />
                  {t("agentDetail.startChat")}
                </button>
              </div>

              {description && (
                <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    <Info className="h-3.5 w-3.5" />
                    {isZh ? "智能体描述" : "Agent Description"}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {description}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentDetailPanel;