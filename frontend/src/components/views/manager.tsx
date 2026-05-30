import { appContext } from "@/hooks/provider";
import { Dropdown, Input, message, Modal, Popconfirm, Spin, Button } from "antd";
import React, { Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MoreVertical, Search, Share2, Trash2, Library, Plus, Upload, X } from "lucide-react";
import { parse } from "yaml";
import { useConfigStore } from "../../hooks/store";
import { useModeConfigStore } from "../../store/modeConfig";
import { Agent } from "../../types/common";
import { useAgentInfo } from "../features/Agents/useAgentInfo";
import PlanList from "../features/Plans/PlanList";
import { GeneralConfig, useSettingsStore } from "../store";
import type { Session, FilesEvent, MessageFileItem } from "../types/datamodel";
import { sessionAPI, settingsAPI, userAPI, docmasterAPI, type DocMasterTemplateEntry } from "./api";
import ChatView from "../../pages/chat/chat";
import NewChatView from "../../pages/chat/NewChatView";
import { useAgentManager } from "./hooks/useAgentManager";
import { useLocation, useNavigate } from "../../hooks/useRouter";
import { useSessionManager } from "./hooks/useSessionManager";
import { useSessionStorage } from "./hooks/useSessionStorage";
import { useWebSocketManager } from "./hooks/useWebSocketManager";
import AgentManagementPage from "../../pages/AgentManagementPage";
import ChannelsPage from "../../pages/settings/ChannelsPage";
import FilePreviewPage from "../../pages/FilePreviewPage";
import LogsPage from "../../pages/settings/LogsPage";
import Config from "../../pages/settings/Config";
import UserManagementPage from "../../pages/UserManagementPage";
import type { ServerUploadedFileInfo } from "../../pages/chat/chat/hooks/useFileUpload";
import {
  MENU_LABELS,
  MENU_IDS,
  DEFAULT_MENU_ID,
  DEFAULT_VIEW_ID,
  type CanvasViewId,
  type MenuId,
  createSearchWithMenu,
  createSearchWithView,
  getCanvasViewFromSearch,
  getMenuIdFromSearch,
} from "./menuRoutes";
import {
  apiDatetimeToUtcMs,
  formatApiDateTimeZhCN,
  formatUnixForDisplayZhCN,
} from "../../utils/apiDatetime";
import { SessionEditor } from "./session_editor";
import { AppLayout } from "../../layout";
import { useRightPanelStore } from "../../store/rightPanel";
import { useIsCompactLayout } from "../../hooks/useMediaQuery";

const AgentSquare = React.lazy(() =>
  import("../features/Agents/AgentSquare").then((m) => ({ default: m.AgentSquare }))
);
const SkillsSquarePage = React.lazy(() => import("../../pages/SkillsSquarePage"));
const UsageAnalyticsPage = React.lazy(() => import("../../pages/settings/UsageAnalyticsPage"));
const LibraryPage = React.lazy(() => import("../../pages/library/LibraryPage"));

const MenuPanelFallback = () => (
  <div className="flex h-full items-center justify-center text-secondary">
    <Spin />
  </div>
);

/** Extensions treated as inline-previewable images in the right-panel file list */
const RIGHT_PANEL_IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

const extensionFromFilename = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

const isImageMessageFile = (file: MessageFileItem): boolean => {
  const mime = file.mime_type?.trim().toLowerCase() ?? "";
  if (mime.startsWith("image/")) return true;
  return RIGHT_PANEL_IMAGE_EXT.has(extensionFromFilename((file.name || "").trim()));
};

export const SessionManager: React.FC = () => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const isCompact = useIsCompactLayout();
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyScrollTopRef = useRef(0);
  /** 从「库」带入聊天输入框的已上传文件（短时清空引用，避免重复注入） */
  const [libraryAttachPrefill, setLibraryAttachPrefill] = useState<
    ServerUploadedFileInfo[] | null
  >(null);
  /** Survives NewChatView → ChatView/WelcomeScreen so example chips do not flash on first send */
  const [sampleTasksDismissed, setSampleTasksDismissed] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [baseUrl, setBaseUrl] = useState<string | undefined>();
  const [sessionFileEvents, setSessionFileEvents] = useState<Record<number, FilesEvent[]>>({});
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<MessageFileItem | null>(null);
  const [previewReadOnly, setPreviewReadOnly] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingMenuId, setPendingMenuId] = useState<MenuId | null>(null);

  const menuFromUrl = useMemo(
    () => getMenuIdFromSearch(location.search),
    [location.search]
  );
  const activeSubMenuItem = pendingMenuId ?? menuFromUrl;

  useEffect(() => {
    if (pendingMenuId !== null && menuFromUrl === pendingMenuId) {
      setPendingMenuId(null);
    }
  }, [pendingMenuId, menuFromUrl]);

  const activeCanvasView = useMemo(
    () => getCanvasViewFromSearch(location.search),
    [location.search]
  );
  const activeMenuLabel = useMemo(
    () => MENU_LABELS[activeSubMenuItem],
    [activeSubMenuItem]
  );

  // 登入后常为 / 无 query，补全默认 menu/view（走 history，不触发 Gatsby page-data）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    if (params.has("menu") && params.has("view")) return;
    const next = createSearchWithView(
      createSearchWithMenu(location.search, DEFAULT_MENU_ID),
      DEFAULT_VIEW_ID
    );
    navigate(next, { replace: true });
  }, [location.search, navigate]);

  const navigateToMenu = useCallback(
    (menuId: MenuId) => {
      const withMenu = createSearchWithMenu(location.search, menuId);
      navigate(createSearchWithView(withMenu, DEFAULT_VIEW_ID));
    },
    [location.search, navigate]
  );

  const navigateToView = useCallback(
    (viewId: CanvasViewId) => {
      navigate(createSearchWithView(location.search, viewId));
    },
    [location.search, navigate]
  );

  useEffect(() => {
    if (isCompact) {
      setIsSidebarOpen(false);
    }
  }, [isCompact]);

  useEffect(() => {
    if (isCompact) {
      setIsSidebarOpen(false);
    }
  }, [activeSubMenuItem, isCompact]);

  const handleSubMenuChange = useCallback(
    (tabId: string) => {
      const menuId = tabId as MenuId;
      flushSync(() => setPendingMenuId(menuId));
      navigateToMenu(menuId);
      if (isCompact) {
        setIsSidebarOpen(false);
      }
    },
    [isCompact, navigateToMenu]
  );

  const { user, darkMode } = useContext(appContext);
  const rightPanelTab = useRightPanelStore((s) => s.layoutTab);
  const [showAdminNav, setShowAdminNav] = useState(false);

  const deferAfterPaint = useCallback((fn: () => void) => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(fn, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(fn, 1);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const uid = user?.email;
    if (!uid) {
      setShowAdminNav(false);
      return () => {
        cancelled = true;
      };
    }
    const cancelDefer = deferAfterPaint(() => {
      userAPI
        .getAccess(uid)
        .then((a) => {
          if (!cancelled) setShowAdminNav(Boolean(a?.is_platform_admin));
        })
        .catch(() => {
          if (!cancelled) setShowAdminNav(false);
        });
    });
    return () => {
      cancelled = true;
      cancelDefer();
    };
  }, [user?.email, deferAfterPaint]);
  const formatFileSize = useCallback((size: number | null | undefined) => {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "-";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const buildDownloadHref = useCallback((file: MessageFileItem): string | null => {
    if (file.download_method === "url" && file.url) return file.url;
    if (file.download_method === "base64" && file.base64_content) {
      const mime = file.mime_type || "application/octet-stream";
      return `data:${mime};base64,${file.base64_content}`;
    }
    return null;
  }, []);

  const handleFileEventsChange = useCallback((sessionId: number, fileEvents: FilesEvent[]) => {
    setSessionFileEvents((prev) => {
      const current = prev[sessionId] || [];
      if (current === fileEvents) return prev;
      return {
        ...prev,
        [sessionId]: fileEvents,
      };
    });
  }, []);

  const { session, setSession, setSessions } = useConfigStore();
  const {
    selectedAgent,
    setSelectedAgent,
    setConfig,
    setAgentId,
    setMode,
    agentId,
  } = useModeConfigStore();
  const { saveSessionId } = useSessionStorage();
  const { config: settingsConfig, updateConfig: updateSettingsConfig } = useSettingsStore();

  // Session management
  const {
    sessions,
    isLoading: isSessionLoading,
    sessionRunStatuses,
    pendingFirstMessage,
    fetchSessions,
    selectSession,
    createNewChatSession,
    updateSession,
    updateSessionName,
    deleteSession,
    clearCurrentSession,
    updateSessionRunStatus,
    setPendingFirstMessage,
  } = useSessionManager({
    userEmail: user?.email,
    onSuccess: (msg) => messageApi.success(msg),
    onError: (msg) => messageApi.error(msg),
  });

  const handleClearCurrentSession = useCallback(() => {
    setSampleTasksDismissed(false);
    clearCurrentSession();
  }, [clearCurrentSession]);

  // WebSocket management
  const { getSessionSocket, closeSocket, stopSession } = useWebSocketManager();

  // Agent management
  const {
    agents,
    fetchAgentList,
    deleteAgent,
    agentCatalogLoaded,
    catalogRefreshing,
    catalogLoadingHint,
    platformAgentPolicy,
  } = useAgentManager(user?.email);

  const { agentInfo } = useAgentInfo(user?.email);

  // 延后拉配置，避免登入后占满主线程导致菜单点击无响应
  useEffect(() => {
    if (!user?.email) return;
    return deferAfterPaint(() => {
      void (async () => {
        try {
          const settings = (await settingsAPI.getSettings(user.email)) as GeneralConfig;
          const { default_agent_id: _omit, ...settingsForStore } = settings as GeneralConfig & {
            default_agent_id?: string;
          };
          updateSettingsConfig(settingsForStore as GeneralConfig);
          if (settings.model_configs) {
            try {
              const parsed = parse(settings.model_configs);
              const baseUrl = parsed.model_config?.config?.base_url;
              if (baseUrl) setBaseUrl(baseUrl);
            } catch (parseError) {
              console.warn("Failed to parse model_configs for baseUrl:", parseError);
            }
          }
        } catch (error) {
          console.error("Failed to load settings:", error);
        }
      })();
    });
  }, [user?.email, updateSettingsConfig, deferAfterPaint]);

  useEffect(() => {
    if (!user?.email) return;
    return deferAfterPaint(() => {
      const run = () => fetchAgentList();
      if (useModeConfigStore.persist.hasHydrated()) {
        run();
        return;
      }
      useModeConfigStore.persist.onFinishHydration(run);
    });
  }, [user?.email, fetchAgentList, deferAfterPaint]);

  useEffect(() => {
    const handleAgentListChanged = () => {
      fetchAgentList();
    };

    window.addEventListener(
      "agentListChanged",
      handleAgentListChanged as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "agentListChanged",
        handleAgentListChanged as unknown as EventListener
      );
    };
  }, [fetchAgentList]);

  useEffect(() => {
    if (!user?.email) return;
    return deferAfterPaint(() => {
      fetchSessions();
    });
  }, [user?.email, fetchSessions, deferAfterPaint]);

  // 库 → 聊天 时把文件放在 state 里传给 NewChatView；不要用短时定时器清空，否则智能体信息未加载完时
  // NewChatView 尚未挂载，prefill 已被清空，输入框收不到附件。
  useEffect(() => {
    if (activeSubMenuItem === MENU_IDS.currentSession) return;
    if (!libraryAttachPrefill) return;
    setLibraryAttachPrefill(null);
  }, [activeSubMenuItem, libraryAttachPrefill]);

  // Handle agent click
  const handleAgentClick = useCallback(async (agent: Agent) => {
    if (!user?.email) return;

    // 更新 agentId（在函数开始时就设置，确保及时触发 useAgentInfo）
    if (agent.id) {
      setAgentId(agent.id);
    } else {
      setAgentId(null);
    }
    setMode(agent.mode || "");
    // 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
    // 对于非自定义智能体，使用 mode 来判断
    const isDifferentAgent = agent.type === "add"
      ? (selectedAgent?.id !== agent.id && selectedAgent?.name !== agent.name)
      : (selectedAgent?.mode !== agent.mode);
    if (isDifferentAgent) {
      handleClearCurrentSession();
    }

    navigateToMenu(MENU_IDS.currentSession);

  }, [user?.email, selectedAgent, handleClearCurrentSession, setAgentId, setMode]);

  // Handle edit session
  const handleEditSession = useCallback(async (sessionData?: Session) => {
    navigateToMenu(MENU_IDS.currentSession);

    if (sessionData) {
      setEditingSession(sessionData);
      setIsEditorOpen(true);
    } else {
      // 不创建新会话，只是清空当前会话
      // 保持当前选中的 agent 不变
      // 会话将在用户发送第一条消息时创建
      handleClearCurrentSession();
    }
  }, [handleClearCurrentSession]);

  // Handle save session
  const handleSaveSession = useCallback(async (sessionData: Partial<Session>) => {
    await updateSession(sessionData);
    setIsEditorOpen(false);
    setEditingSession(undefined);
  }, [updateSession]);

  // Handle delete session
  const handleDeleteSession = useCallback(async (sessionId: number) => {
    const isDeletingCurrentSession = session?.id === sessionId;
    await deleteSession(sessionId, closeSocket);

    // 如果删除的是当前会话，确保显示 NewChatView
    if (isDeletingCurrentSession) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [deleteSession, closeSocket, session?.id]);

  const handleCopyShareLink = useCallback(
    async (sessionId: number) => {
      if (!user?.email) {
        messageApi.error("请先登录");
        return;
      }
      try {
        const { share_token } = await sessionAPI.setSessionShare(
          sessionId,
          user.email,
          true
        );
        const url = sessionAPI.buildShareUrl(share_token);
        await navigator.clipboard.writeText(url);
        messageApi.success("分享链接已复制，访客可只读查看");
      } catch (e) {
        messageApi.error(
          e instanceof Error ? e.message : "生成分享链接失败"
        );
      }
    },
    [user?.email, messageApi]
  );

  // Handle delete agent
  const handleDeleteAgent = useCallback(async (id: string) => {
    await deleteAgent(
      id,
      () => messageApi.success("Agent deleted successfully"),
      () => messageApi.error("Failed to delete agent")
    );
  }, [deleteAgent, messageApi]);

  // Handle stop session
  const handleStopSession = useCallback((sessionId: number) => {
    if (sessionId === undefined || sessionId === null) return;

    stopSession(sessionId);
    updateSessionRunStatus(sessionId, "stopped");
  }, [stopSession, updateSessionRunStatus]);

  // Handle create session from plan
  const handleCreateSessionFromPlan = useCallback((sessionId: number, planData: any) => {
    selectSession({ id: sessionId } as Session);

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("planReady", {
          detail: {
            planData: planData,
            sessionId: sessionId,
            messageId: `plan_${Date.now()}`,
          },
        })
      );
    }, 2000);
  }, [selectSession]);

  // Handle selecting a session from sidebar / plan list:
  // always switch back to "current_session" view so the chat is visible.
  const handleSelectSession = useCallback(
    async (selectedSession: Session) => {
      if (historyScrollRef.current) {
        historyScrollTopRef.current = historyScrollRef.current.scrollTop;
      }
      navigateToMenu(MENU_IDS.currentSession);
      selectSession(selectedSession);
    },
    [selectSession]
  );

  const setHistoryScrollContainer = useCallback((el: HTMLDivElement | null) => {
    historyScrollRef.current = el;
    if (el) {
      el.scrollTop = historyScrollTopRef.current;
    }
  }, []);

  useLayoutEffect(() => {
    if (rightPanelTab !== "history") return;
    const el = historyScrollRef.current;
    if (!el) return;
    el.scrollTop = historyScrollTopRef.current;
  }, [rightPanelTab, session?.id, sessions]);

  // Listen for switchToCurrentSession event
  useEffect(() => {
    const handleSwitchToCurrentSession = async (event: CustomEvent) => {
      const { agent, newSession, config, clearSession } = event.detail || {};

      navigateToMenu(MENU_IDS.currentSession);
      if (agent) {
        setSelectedAgent(agent);
      }
      if (config) {
        setConfig(config);
      }

      if (clearSession) {
        handleClearCurrentSession();
        return;
      }

      if (newSession) {
        try {
          const currentSessions = Array.isArray(sessions) ? sessions : [];
          setSessions([newSession, ...currentSessions]);
          setSession(newSession);

          window.history.pushState({}, "", `?sessionId=${newSession.id}`);
          saveSessionId(newSession.id);
        } catch (error) {
          console.error("Error setting new session:", error);
        }
      }
    };

    window.addEventListener(
      "switchToCurrentSession",
      handleSwitchToCurrentSession as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "switchToCurrentSession",
        handleSwitchToCurrentSession as unknown as EventListener
      );
    };
  }, [setSelectedAgent, sessions, setSessions, setSession, saveSessionId, setConfig, handleClearCurrentSession]);

  // Listen for sessionDeleted event and ensure NewChatView is shown
  useEffect(() => {
    const handleSessionDeleted = () => {
      navigateToMenu(MENU_IDS.currentSession);
    };

    window.addEventListener(
      "sessionDeleted",
      handleSessionDeleted as unknown as EventListener
    );

    return () => {
      window.removeEventListener(
        "sessionDeleted",
        handleSessionDeleted as unknown as EventListener
      );
    };
  }, []);

  // Ensure NewChatView is shown when session becomes null
  useEffect(() => {

    // Only enforce the chat menu when the user is already on chat.
    // Otherwise (e.g. agent_management), keep the current menu on refresh.
    if (
      activeSubMenuItem === MENU_IDS.currentSession &&
      !session &&
      selectedAgent &&
      selectedAgent.name
    ) {
      navigateToMenu(MENU_IDS.currentSession);
    }
  }, [activeSubMenuItem, session, selectedAgent, navigateToMenu]);

  // Chat views
  const chatViews = useMemo(() => {
    if (!Array.isArray(sessions) || !session) {
      return [];
    }

    return sessions.map((s: Session) => {
      if (!s.id) return null;

      // Always render ChatView for all sessions to preserve streamed messages when switching.
      // Non-current sessions are hidden via CSS (className="hidden").
      return (
        <div
          key={s.id}
          className={`${session?.id === s.id ? "block" : "hidden"} relative h-full min-h-0`}
        >
          <ChatView
            session={s}
            onSessionNameChange={updateSessionName}
            getSessionSocket={getSessionSocket}
            visible={session?.id === s.id}
            onRunStatusChange={updateSessionRunStatus}
            pendingFirstMessage={session?.id === s.id ? pendingFirstMessage : null}
            onPendingMessageSent={() => setPendingFirstMessage(null)}
            suppressSampleTasks={
              session?.id === s.id &&
              (sampleTasksDismissed || !!pendingFirstMessage)
            }
            libraryServerFilesPrefill={
              session?.id === s.id ? libraryAttachPrefill : null
            }
            onFileEventsChange={handleFileEventsChange}
          />
        </div>
      );
    });
  }, [
    sessions,
    session,
    updateSessionName,
    getSessionSocket,
    updateSessionRunStatus,
    pendingFirstMessage,
    sampleTasksDismissed,
    libraryAttachPrefill,
    handleFileEventsChange,
  ]);

  const rightPanelFiles = useMemo(() => {
    const currentSessionId = session?.id;
    if (!currentSessionId) return null;
    const events = sessionFileEvents[currentSessionId] || [];
    /** 与 apiDatetime 一致：数值很大视为毫秒，否则视为秒 */
    const filesEventTimeMs = (event: FilesEvent): number => {
      const raw = event.send_time_stamp ?? event.content?.send_time_stamp;
      if (raw == null) return 0;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return 0;
      return n > 1e12 ? n : n * 1000;
    };
    const isJsonFile = (file: MessageFileItem) => {
      const name = (file.name || "").trim().toLowerCase();
      if (name.endsWith(".json")) return true;
      const mime = (file.mime_type || "").trim().toLowerCase();
      return mime === "application/json" || mime === "text/json";
    };
    const fileRows = events
      .flatMap((event) => {
        const timeMs = filesEventTimeMs(event);
        const list = event.content?.files || [];
        return list
          .filter((file) => !isJsonFile(file))
          .map((file) => ({ file, timeMs }));
      })
      .sort((a, b) => b.timeMs - a.timeMs);
    if (fileRows.length === 0) return null;

    return (
      <div className="h-full overflow-y-auto p-3 space-y-2">
        {fileRows.map(({ file, timeMs }, index) => {
          const href = buildDownloadHref(file);
          return (
            <div
              key={`${file.name}-${index}`}
              className="rounded-lg border border-border-primary/30 bg-tertiary/10 p-3"
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedPreviewFile(file);
                  setPreviewReadOnly(false);
                  navigateToView("file_preview");
                }}
                className="text-sm font-medium text-primary break-all text-left hover:text-accent transition-colors"
                title="点击预览并编辑"
              >
                {file.name || `file-${index + 1}`}
              </button>
              <div className="mt-1 text-xs text-secondary">
                {timeMs > 0 ? formatUnixForDisplayZhCN(timeMs) : "—"}  · {formatFileSize(file.size)}
              </div>
              {href && isImageMessageFile(file) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreviewFile(file);
                    navigateToView("file_preview");
                  }}
                  className="mt-3 w-full h-20 flex items-center justify-center rounded-md overflow-hidden border border-border-primary/25 bg-tertiary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  title="点击查看完整预览"
                >
                  <img
                    src={href}
                    alt={file.name || "图片预览"}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                </button>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreviewFile(file);
                    setPreviewReadOnly(false);
                    navigateToView("file_preview");
                  }}
                  className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30 transition-colors"
                >
                  预览/编辑
                </button>
                {href ? (
                  <a
                    href={href}
                    download={file.name || `file-${index + 1}`}
                    target={file.download_method === "url" ? "_blank" : undefined}
                    rel={file.download_method === "url" ? "noreferrer" : undefined}
                    className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                  >
                    下载文件
                  </a>
                ) : (
                  <span className="text-xs text-secondary">暂无可用下载链接</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [
    session?.id,
    sessionFileEvents,
    buildDownloadHref,
    formatFileSize,
    navigateToView,
  ]);

  // Templates tab (DocMaster only) ------------------------------------------------
  const isDocMaster = useMemo(() => {
    const name =
      (agentInfo as { name?: string } | null | undefined)?.name ||
      selectedAgent?.name ||
      "";
    return name === "DocMaster";
  }, [agentInfo, selectedAgent]);

  const [docmasterTemplates, setDocmasterTemplates] = useState<{
    shared: DocMasterTemplateEntry[];
    mine: DocMasterTemplateEntry[];
  }>({ shared: [], mine: [] });
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!isDocMaster) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const data = await docmasterAPI.listTemplates({ userId: user?.email });
      setDocmasterTemplates(data);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "加载模板失败");
    } finally {
      setTemplatesLoading(false);
    }
  }, [isDocMaster, user?.email]);

  useEffect(() => {
    if (!isDocMaster) {
      setDocmasterTemplates({ shared: [], mine: [] });
      return;
    }
    void fetchTemplates();
  }, [isDocMaster, fetchTemplates]);

  // Allow chat-side template save/delete tool flows to refresh the catalog.
  useEffect(() => {
    if (!isDocMaster) return;
    const handler = () => {
      void fetchTemplates();
    };
    window.addEventListener("drsai:templateLibraryChanged", handler);
    return () => {
      window.removeEventListener("drsai:templateLibraryChanged", handler);
    };
  }, [isDocMaster, fetchTemplates]);

  const handleUseTemplate = useCallback((entry: DocMasterTemplateEntry) => {
    const alias =
      (Array.isArray(entry.aliases) && entry.aliases.find((a) => a && a.trim())) ||
      entry.name;
    if (!alias) return;
    const text = `请使用模板 ${alias}`;
    window.dispatchEvent(
      new CustomEvent("drsai:chatinput:setValue", { detail: { text } })
    );
    navigateToMenu(MENU_IDS.currentSession);
    navigateToView("chat");
  }, [navigateToMenu, navigateToView]);

  const handlePreviewTemplate = useCallback((entry: DocMasterTemplateEntry) => {
    const source = (entry.source as "shared" | "mine") || "shared";
    const templateId = typeof entry.id === "string" ? entry.id : entry.name;
    if (!templateId) return;
    const url = docmasterAPI.templateFileUrl({
      templateId,
      source,
      userId: source === "mine" ? user?.email : undefined,
    });
    const previewFile: MessageFileItem = {
      name: `${entry.name || templateId}.docx`,
      url,
      base64_content: "",
      size: 0,
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      description: entry.description || "模板预览（只读）",
      download_method: "url",
    };
    setSelectedPreviewFile(previewFile);
    setPreviewReadOnly(true);
    navigateToView("file_preview");
  }, [navigateToView, user?.email]);

  // --- Add / delete template flows --------------------------------------------
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [addTemplateName, setAddTemplateName] = useState("");
  const [addTemplateDescription, setAddTemplateDescription] = useState("");
  const [addTemplateCategory, setAddTemplateCategory] = useState("");
  const [addTemplateTags, setAddTemplateTags] = useState("");
  const [addTemplateAliases, setAddTemplateAliases] = useState("");
  const [addTemplateFile, setAddTemplateFile] = useState<File | null>(null);
  const [addTemplateSubmitting, setAddTemplateSubmitting] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const resetAddTemplateForm = useCallback(() => {
    setAddTemplateName("");
    setAddTemplateDescription("");
    setAddTemplateCategory("");
    setAddTemplateTags("");
    setAddTemplateAliases("");
    setAddTemplateFile(null);
  }, []);

  const openAddTemplate = useCallback(() => {
    resetAddTemplateForm();
    setAddTemplateOpen(true);
  }, [resetAddTemplateForm]);

  const parseCsvList = (raw: string): string[] =>
    raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmitAddTemplate = useCallback(async () => {
    if (!user?.email) {
      messageApi.error("未登录或无法识别用户邮箱");
      return;
    }
    if (!addTemplateFile) {
      messageApi.error("请选择 .docx 模板文件");
      return;
    }
    if (!addTemplateFile.name.toLowerCase().endsWith(".docx")) {
      messageApi.error("模板必须是 .docx 文件");
      return;
    }
    if (!addTemplateName.trim()) {
      messageApi.error("请填写模板名称");
      return;
    }
    setAddTemplateSubmitting(true);
    try {
      await docmasterAPI.saveTemplate({
        userId: user.email,
        name: addTemplateName.trim(),
        description: addTemplateDescription.trim(),
        category: addTemplateCategory.trim() || undefined,
        tags: parseCsvList(addTemplateTags),
        aliases: parseCsvList(addTemplateAliases),
        file: addTemplateFile,
      });
      messageApi.success("模板已保存");
      setAddTemplateOpen(false);
      resetAddTemplateForm();
      await fetchTemplates();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "保存模板失败");
    } finally {
      setAddTemplateSubmitting(false);
    }
  }, [
    user?.email,
    addTemplateFile,
    addTemplateName,
    addTemplateDescription,
    addTemplateCategory,
    addTemplateTags,
    addTemplateAliases,
    messageApi,
    fetchTemplates,
    resetAddTemplateForm,
  ]);

  const handleDeleteTemplate = useCallback(async (entry: DocMasterTemplateEntry) => {
    if (!user?.email) {
      messageApi.error("未登录或无法识别用户邮箱");
      return;
    }
    const templateId = typeof entry.id === "string" ? entry.id : "";
    if (!templateId) return;
    setDeletingTemplateId(templateId);
    try {
      await docmasterAPI.deleteTemplate({ templateId, userId: user.email });
      messageApi.success(`已删除模板 ${entry.name || templateId}`);
      await fetchTemplates();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "删除模板失败");
    } finally {
      setDeletingTemplateId(null);
    }
  }, [user?.email, messageApi, fetchTemplates]);

  const rightPanelTemplates = useMemo(() => {
    if (!isDocMaster) return null;

    const isDark = darkMode === "dark";
    const cardBase = isDark
      ? "rounded-lg border border-border-primary/30 bg-tertiary/10 p-3 hover:bg-tertiary/20"
      : "rounded-lg border border-gray-200/70 bg-white/70 p-3 hover:bg-gray-100/60";
    const chipBase = isDark
      ? "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-white/[0.06] text-secondary"
      : "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600";
    const aliasChip = isDark
      ? "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-accent/15 text-accent"
      : "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] bg-violet-100 text-violet-700";

    const actionBtn = isDark
      ? "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-white/[0.06] text-primary hover:bg-white/[0.12]"
      : "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-gray-100 text-gray-700 hover:bg-gray-200";
    const actionBtnAccent = isDark
      ? "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25"
      : "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200";

    const renderEntry = (entry: DocMasterTemplateEntry, idx: number) => {
      const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [];
      const tags = Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [];
      return (
        <div
          key={`${entry.name || "tpl"}-${idx}`}
          role="button"
          tabIndex={0}
          onClick={() => handlePreviewTemplate(entry)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handlePreviewTemplate(entry);
            }
          }}
          className={`block w-full text-left transition-colors cursor-pointer ${cardBase}`}
          title="点击预览模板内容"
        >
          <div className="text-sm font-medium text-primary break-all">
            {entry.name || `模板 ${idx + 1}`}
          </div>
          {entry.description && (
            <div className="mt-1 text-xs text-secondary break-all line-clamp-2">
              {entry.description}
            </div>
          )}
          {(entry.category || tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.category && (
                <span className={chipBase}>{entry.category}</span>
              )}
              {tags.map((t) => (
                <span key={t} className={chipBase}>#{t}</span>
              ))}
            </div>
          )}
          {aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {aliases.map((a) => (
                <span key={a} className={aliasChip}>{a}</span>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePreviewTemplate(entry);
              }}
              className={actionBtn}
            >
              预览
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUseTemplate(entry);
              }}
              className={actionBtnAccent}
              title="把 “请使用模板 …” 写入聊天输入框"
            >
              使用
            </button>
            {entry.source === "mine" && (
              <Popconfirm
                title="删除该模板？"
                description="只会从你的模板库移除，共享模板不受影响。"
                okText="删除"
                okButtonProps={{ danger: true, loading: deletingTemplateId === entry.id }}
                cancelText="取消"
                onConfirm={(e) => {
                  e?.stopPropagation?.();
                  void handleDeleteTemplate(entry);
                }}
                onCancel={(e) => e?.stopPropagation?.()}
              >
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className={`ml-auto inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    isDark
                      ? "text-red-300/80 hover:text-red-300 hover:bg-red-500/10"
                      : "text-red-500/80 hover:text-red-600 hover:bg-red-50"
                  }`}
                  title="删除该模板"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Popconfirm>
            )}
          </div>
        </div>
      );
    };

    const sectionHeader = (text: string, count: number) => (
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-semibold text-secondary tracking-wide uppercase">
          {text}
        </span>
        <span className="text-[11px] text-secondary opacity-70">{count}</span>
      </div>
    );

    const { shared, mine } = docmasterTemplates;
    const hasAny = shared.length > 0 || mine.length > 0;

    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 flex items-center justify-between px-3 pt-3 pb-2">
          <div className="text-[11px] text-secondary opacity-70">
            点击条目预览 · “使用” 写入聊天输入框
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openAddTemplate}
              className={`text-[11px] rounded-md px-2 py-1 inline-flex items-center gap-1 transition-colors ${
                isDark
                  ? "text-accent hover:bg-accent/10"
                  : "text-violet-700 hover:bg-violet-100"
              }`}
              title="上传新模板到我的模板库"
            >
              <Plus className="w-3.5 h-3.5" />
              添加
            </button>
            <button
              type="button"
              onClick={() => void fetchTemplates()}
              disabled={templatesLoading}
              className={`text-[11px] rounded-md px-2 py-1 transition-colors ${
                templatesLoading
                  ? "opacity-40 cursor-not-allowed"
                  : isDark
                    ? "text-secondary hover:text-primary hover:bg-white/5"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/60"
              }`}
            >
              {templatesLoading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
          {templatesError && (
            <div className="text-xs text-red-500/90 px-1">{templatesError}</div>
          )}
          {!templatesError && !templatesLoading && !hasAny && (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="text-center">
                <Library className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm opacity-50">暂无模板</p>
              </div>
            </div>
          )}
          {shared.length > 0 && (
            <div>
              {sectionHeader("共享模板", shared.length)}
              <div className="space-y-2">{shared.map(renderEntry)}</div>
            </div>
          )}
          {mine.length > 0 && (
            <div>
              {sectionHeader("我的模板", mine.length)}
              <div className="space-y-2">{mine.map(renderEntry)}</div>
            </div>
          )}
        </div>
      </div>
    );
  }, [
    isDocMaster,
    docmasterTemplates,
    templatesLoading,
    templatesError,
    darkMode,
    handleUseTemplate,
    handlePreviewTemplate,
    handleDeleteTemplate,
    deletingTemplateId,
    openAddTemplate,
    fetchTemplates,
  ]);

  const rightPanelHistory = useMemo(() => {
    const sortedSessions = Array.isArray(sessions)
      ? [...sessions].sort(
        (a, b) =>
          apiDatetimeToUtcMs(b.updated_at || b.created_at) -
          apiDatetimeToUtcMs(a.updated_at || a.created_at)
      )
      : [];

    if (sortedSessions.length === 0) {
      return null;
    }

    const q = historySearchQuery.trim().toLowerCase();
    const filteredSessions = q
      ? sortedSessions.filter((s) => {
        const name = (s.name || "").toLowerCase();
        const idStr = s.id != null ? String(s.id) : "";
        return name.includes(q) || idStr.includes(q);
      })
      : sortedSessions;

    const inputRing =
      darkMode === "dark"
        ? "border-border-primary/40 bg-white/[0.04] text-primary placeholder:text-secondary/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        : "border-gray-200/90 bg-white text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-200";

    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-shrink-0 px-3 pt-3 pb-2">
          <label className="sr-only" htmlFor="history-session-search">
            搜索会话
          </label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none"
              aria-hidden
            />
            <input
              id="history-session-search"
              type="search"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              placeholder="搜索会话名称或 ID…"
              autoComplete="off"
              className={`w-full rounded-lg pl-9 pr-3 py-2 text-sm border outline-none transition-shadow ${inputRing}`}
            />
          </div>
        </div>
        <div
          ref={setHistoryScrollContainer}
          onScroll={(e) => {
            historyScrollTopRef.current = e.currentTarget.scrollTop;
          }}
          className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1"
        >
          {filteredSessions.length === 0 ? (
            <div className="text-center text-sm text-secondary py-8 px-2">
              无匹配会话，请调整关键词
            </div>
          ) : (
            filteredSessions.map((historySession) => {
              const isCurrent = session?.id === historySession.id;
              const lastTime = historySession.updated_at || historySession.created_at;
              const sid = historySession.id;
              return (
                <div
                  key={sid ?? historySession.name}
                  className={`group relative flex items-center gap-0.5 rounded-lg transition-colors ${isCurrent ? "bg-accent/10" : "hover:bg-tertiary/15"
                    }`}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void handleSelectSession(historySession)}
                    className={`flex-1 min-w-0 text-left rounded-lg px-3 py-2 pr-1 transition-colors ${isCurrent ? "text-accent" : "text-primary"
                      }`}
                  >
                    <div className="text-sm font-medium truncate">
                      {historySession.name || `Session ${sid ?? ""}`}
                    </div>
                    <div className="text-xs text-secondary mt-1">
                      {lastTime ? formatApiDateTimeZhCN(lastTime) : "-"}
                    </div>
                  </button>
                  {sid != null && (
                    <div className="flex-shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                          items: [
                            {
                              key: "share",
                              disabled: isSessionLoading,
                              label: (
                                <>
                                  <Share2 className="w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle" />
                                  分享
                                </>
                              ),
                              onClick: (e) => {
                                e.domEvent.stopPropagation();
                                void handleCopyShareLink(sid);
                              },
                            },
                            {
                              key: "delete",
                              danger: true,
                              disabled: isSessionLoading,
                              label: (
                                <>
                                  <Trash2 className="w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle" />
                                  删除
                                </>
                              ),
                              onClick: (e) => {
                                e.domEvent.stopPropagation();
                                void handleDeleteSession(sid);
                              },
                            },
                          ],
                        }}
                      >
                        <button
                          type="button"
                          title="更多"
                          aria-haspopup="menu"
                          aria-label="会话操作"
                          disabled={isSessionLoading}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`flex items-center justify-center w-7 h-7 rounded-lg outline-none border-0 bg-transparent shadow-none ring-0 transition-colors ${isSessionLoading
                            ? "opacity-40 cursor-not-allowed"
                            : "text-secondary hover:text-primary hover:bg-tertiary/30"
                            }`}
                        >
                          <MoreVertical className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                      </Dropdown>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }, [
    sessions,
    session?.id,
    handleSelectSession,
    historySearchQuery,
    darkMode,
    isSessionLoading,
    handleDeleteSession,
    handleCopyShareLink,
  ]);

  return (
    <>
      {contextHolder}

      <AppLayout
        // TopNav
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}

        // LeftMenu
        activeSubMenuItem={activeSubMenuItem}
        activeMenuLabel={activeMenuLabel}
        onSubMenuChange={handleSubMenuChange}
        showAdminNav={showAdminNav}
        canvasActiveView={activeCanvasView}
        onCanvasViewChange={navigateToView}
        canvasFilePreviewContent={<FilePreviewPage file={selectedPreviewFile} sessionId={session?.id ?? null} readOnly={previewReadOnly} onFileEvent={(evt) => {
          const sid = session?.id;
          if (!sid) return;
          setSessionFileEvents((prev) => ({
            ...prev,
            [sid]: [...(prev[sid] || []), evt],
          }));
        }} />}
        rightPanelHistory={rightPanelHistory}
        rightPanelFiles={rightPanelFiles}
        rightPanelTemplates={isDocMaster ? rightPanelTemplates : undefined}
        onRightPanelTabChange={(tab) => {
          if (tab === "files" || tab === "templates") {
            // Keep the current canvas view when switching to a non-chat side tab.
            // The canvas should switch only on explicit user action (e.g. file preview).
            return;
          }
          navigateToView("chat");
        }}
        onNewSession={() => {
          navigateToMenu(MENU_IDS.currentSession);
          navigateToView("chat");
          handleClearCurrentSession();
        }}
        showNewSessionButton={Boolean(session)}
      >
        {/* Canvas content */}
        {activeSubMenuItem === MENU_IDS.currentSession ? (
          (() => {
            if (session) {
              return <div className="h-full min-h-0">{chatViews}</div>;
            } else if (agentInfo || selectedAgent) {
              const chatAgent = (agentInfo || selectedAgent) as Agent;
              return (
                <NewChatView
                  agent={chatAgent}
                  serverFilesPrefill={libraryAttachPrefill}
                  suppressSampleTasks={sampleTasksDismissed}
                  onDismissSampleTasks={() => setSampleTasksDismissed(true)}
                  onSubmit={async (agent, query, files, plan, llm) => {
                    setSampleTasksDismissed(true);
                    await createNewChatSession(agent, query, files, plan, llm);
                  }}
                />
              );
            } else if (!user?.email) {
              return (
                <div className="flex items-center justify-center h-full text-secondary">
                  <div className="text-center">
                    <Spin size="large" />
                    <p className="mt-4 text-sm">加载中…</p>
                  </div>
                </div>
              );
            } else if (!agentCatalogLoaded || (agentId && !agentInfo && !selectedAgent)) {
              return (
                <div className="flex items-center justify-center h-full text-secondary">
                  <div className="text-center px-6 max-w-md">
                    <Spin size="large" />
                    <p
                      key={catalogRefreshing ? catalogLoadingHint : "loading"}
                      className="mt-4 text-sm transition-opacity duration-300"
                    >
                      {catalogRefreshing && catalogLoadingHint
                        ? catalogLoadingHint
                        : "加载中…"}
                    </p>
                  </div>
                </div>
              );
            } else if (agents.length === 0) {
              return (
                <div className="flex items-center justify-center h-full text-secondary px-6">
                  <div className="text-center max-w-md">
                    <p className="text-base text-primary font-medium">暂无可用智能体</p>
                    <p className="mt-2 text-sm">请稍后再试或联系管理员为你开通权限。</p>
                  </div>
                </div>
              );
            }
            return (
              <div className="flex items-center justify-center h-full text-secondary px-6">
                <div className="text-center max-w-md space-y-4">
                  <p className="text-base text-primary font-medium">先选一个智能体再开始对话</p>
                  <p className="text-sm">
                    {platformAgentPolicy?.auto_load_default_agent === false
                      ? "你还没有选择聊天要用的智能体。请到智能体广场挑选一个开始试用。"
                      : "你还没有选择聊天要用的智能体。请到智能体广场挑选，或设置你的默认智能体。"}
                  </p>
                  <Button type="primary" size="large" onClick={() => navigateToMenu(MENU_IDS.agentSquare)}>
                    前往智能体广场
                  </Button>
                </div>
              </div>
            );
          })()
        ) : activeSubMenuItem === MENU_IDS.agentSquare || activeSubMenuItem === MENU_IDS.myAgents ? (
          <div className="h-full overflow-hidden">
            <Suspense fallback={<MenuPanelFallback />}>
              <AgentSquare agents={[]} handleAgentList={fetchAgentList} />
            </Suspense>
          </div>
        ) : activeSubMenuItem === MENU_IDS.skillsSquare ? (
          <Suspense fallback={<MenuPanelFallback />}>
            <SkillsSquarePage />
          </Suspense>
        ) : activeSubMenuItem === MENU_IDS.channels ? (
          <ChannelsPage />
        ) : activeSubMenuItem === MENU_IDS.logs ? (
          <LogsPage />
        ) : activeSubMenuItem === MENU_IDS.agentManagement ? (
          <AgentManagementPage />
        ) : activeSubMenuItem === MENU_IDS.userManagement ? (
          <UserManagementPage />
        ) : activeSubMenuItem === MENU_IDS.usageAnalytics ? (
          <Suspense fallback={<MenuPanelFallback />}>
            <UsageAnalyticsPage />
          </Suspense>
        ) : activeSubMenuItem === MENU_IDS.profile ? (
          <Config />
        ) : activeSubMenuItem === MENU_IDS.savedPlan ? (
          <div className="h-full overflow-hidden">
            <PlanList
              onTabChange={(tabId) => navigateToMenu(tabId as MenuId)}
              onSelectSession={handleSelectSession}
              onCreateSessionFromPlan={handleCreateSessionFromPlan}
            />
          </div>
        ) : activeSubMenuItem === MENU_IDS.library ? (
          <div className="h-full min-h-0 overflow-hidden">
            <Suspense fallback={<MenuPanelFallback />}>
            <LibraryPage
              onStartChat={async (files, query) => {
                const chatAgent = (agentInfo || selectedAgent) as import("../../types/common").Agent;
                if (!chatAgent) return;
                // 把文件放进 prefill 以便 ChatView 回显（不重新上传）
                flushSync(() => setLibraryAttachPrefill(files));
                // 直接创建会话并发送首条消息，跳过 NewChatView
                await createNewChatSession(chatAgent, query, files);
                // Use live URL after clearCurrentSession so sessionId is not re-applied from stale React location
                const withMenu = createSearchWithMenu(
                  window.location.search,
                  MENU_IDS.currentSession
                );
                navigate(createSearchWithView(withMenu, "chat"));
              }}
            />
            </Suspense>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-secondary">
            <div className="text-center">
              <p className="text-sm opacity-50">敬请期待</p>
            </div>
          </div>
        )}

        <SessionEditor
          session={editingSession}
          isOpen={isEditorOpen}
          onSave={handleSaveSession}
          onCancel={() => {
            setIsEditorOpen(false);
            setEditingSession(undefined);
          }}
        />
      </AppLayout>

      <Modal
        title="添加模板"
        open={addTemplateOpen}
        onCancel={() => {
          if (addTemplateSubmitting) return;
          setAddTemplateOpen(false);
        }}
        onOk={() => void handleSubmitAddTemplate()}
        okText="保存"
        cancelText="取消"
        confirmLoading={addTemplateSubmitting}
        destroyOnClose
        maskClosable={!addTemplateSubmitting}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-secondary mb-1">
              模板文件 <span className="text-red-500">*</span> <span className="opacity-60">(.docx)</span>
            </label>
            <div className="flex items-center gap-2">
              <label
                className="inline-flex items-center gap-1.5 cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
              >
                <Upload className="w-3.5 h-3.5" />
                选择文件
                <input
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setAddTemplateFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {addTemplateFile && (
                <div className="flex items-center gap-1 text-xs text-primary truncate max-w-[260px]">
                  <span className="truncate">{addTemplateFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAddTemplateFile(null)}
                    className="text-secondary hover:text-primary"
                    title="移除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">
              名称 <span className="text-red-500">*</span>
            </label>
            <Input
              value={addTemplateName}
              onChange={(e) => setAddTemplateName(e.target.value)}
              placeholder="例如：技术开发合同 3-1"
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">描述</label>
            <Input.TextArea
              value={addTemplateDescription}
              onChange={(e) => setAddTemplateDescription(e.target.value)}
              placeholder="可选，简短说明这个模板的用途"
              rows={2}
              maxLength={500}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">分类</label>
            <Input
              value={addTemplateCategory}
              onChange={(e) => setAddTemplateCategory(e.target.value)}
              placeholder="例如：合同/技术开发"
              maxLength={80}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">标签</label>
            <Input
              value={addTemplateTags}
              onChange={(e) => setAddTemplateTags(e.target.value)}
              placeholder="逗号分隔，例如：合同, 技术开发"
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">别名</label>
            <Input
              value={addTemplateAliases}
              onChange={(e) => setAddTemplateAliases(e.target.value)}
              placeholder="逗号分隔，便于 “请使用模板 …” 命中"
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

