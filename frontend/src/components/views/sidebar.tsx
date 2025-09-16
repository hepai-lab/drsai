import { Dropdown, Tooltip, Modal } from "antd";
import {
  Archive,
  Edit,
  FileText,
  InfoIcon,
  MoreVertical,
  PanelLeftClose,
  Plus,
  RefreshCcw,
  StopCircle,
  Trash2,
  Sailboat,
  Settings,
  User,
  LogOut
} from "lucide-react";
import React, { useMemo, useRef, useEffect, useState } from "react";
import { Button } from "../common/Button";
import SubMenu from "../common/SubMenu";
import LearnPlanButton from "../features/Plans/LearnPlanButton";
import type { RunStatus, Session } from "../types/datamodel";
import { SessionRunStatusIndicator } from "./statusicon";
import { appContext } from "../../hooks/provider";
import UserProfileModal from "../userProfile";
import SettingsMenu from "../settings";
import { agentAPI, sessionAPI } from "./api";
import { useModeConfigStore } from "../../store/modeConfig";
import { useMessageCacheStore } from "../../store/messageCache";
import magneticOneIcon from "../../assets/magnetic-one.png";
import magneticTwoIcon from "../../assets/magnetic-two.svg";
import type { Agent as ModeAgent } from "../../store/modeConfig";



interface SidebarProps {
  isOpen: boolean;
  sessions: Session[];
  currentSession: Session | null;
  onToggle: () => void;
  onSelectSession: (session: Session) => void;
  onEditSession: (session?: Session) => void;
  onDeleteSession: (sessionId: number) => void;
  isLoading?: boolean;
  sessionRunStatuses: { [sessionId: number]: RunStatus };
  activeSubMenuItem: string;
  onSubMenuChange: (tabId: string) => void;
  onStopSession: (sessionId: number) => void;
  onLogoClick?: () => void;
  agents?: ModeAgent[];
  selectedAgent?: ModeAgent | null;
  onAgentSelect?: (agent: ModeAgent) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  sessions,
  currentSession,
  onToggle,
  onSelectSession,
  onEditSession,
  onDeleteSession,
  isLoading = false,
  sessionRunStatuses,
  activeSubMenuItem,
  onSubMenuChange,
  onStopSession,
  onLogoClick,
  agents = [],
  selectedAgent = null,
  onAgentSelect,
}) => {
  const { user } = React.useContext(appContext);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const { setMode, setConfig, setSelectedAgent: setPersistedSelectedAgent, lastSelectedAgentMode, setLastSelectedAgentMode } = useModeConfigStore();
  const { getSessionRun } = useMessageCacheStore();
  const [sessionMessageStatus, setSessionMessageStatus] = useState<{ [sessionId: number]: boolean }>({});

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_name");
    window.location.href = "/umt/logout";
  };

  // 根据智能体模式返回对应的图标
  const getAgentIcon = (mode: string) => {
    switch (mode) {
      case "magentic-one":
        return magneticOneIcon;
      case "besiii":
        return magneticTwoIcon;
      default:
        return null;
    }
  };

  // 检查当前session是否已经发送过消息（带缓存）
  const computeSessionHasMessages = useMemo(() => {
    if (!currentSession?.id) return false;
    const cached = getSessionRun(currentSession.id);
    if (cached && cached.messages && cached.messages.length > 0) return true;
    return sessionMessageStatus[currentSession.id] || false;
  }, [currentSession?.id, getSessionRun, sessionMessageStatus]);

  const checkSessionHasMessages = async (sessionId: number): Promise<boolean> => {
    if (!user?.email) return false;
    try {
      const sessionRuns = await sessionAPI.getSessionRuns(sessionId, user.email);
      const hasMessages = sessionRuns.runs && sessionRuns.runs.length > 0 && sessionRuns.runs.some((run: any) => run.messages && run.messages.length > 0);
      setSessionMessageStatus((prev) => ({ ...prev, [sessionId]: hasMessages }));
      return hasMessages;
    } catch {
      return false;
    }
  };

  const performAgentSwitch = async (agent: ModeAgent) => {
    const newCustomAgent: ModeAgent = {
      mode: agent.mode,
      name: agent.name,
      config: {} as any,
    } as any;

    try {
      await agentAPI.saveAgentConfig(newCustomAgent as any);
      const res2 = await agentAPI.getAgentConfig("", agent.mode);
      if (res2) {
        setConfig(res2.config);
        setMode(res2.mode);
      }
      setPersistedSelectedAgent(agent as any);
      setLastSelectedAgentMode(agent.mode);
      onAgentSelect && onAgentSelect(newCustomAgent as any);
    } catch (error) {
      setPersistedSelectedAgent(agent as any);
      setLastSelectedAgentMode(agent.mode);
      onAgentSelect && onAgentSelect(newCustomAgent as any);
    }
  };

  const handleAgentItemClick = async (agent: ModeAgent) => {
    let actualHasMessages = computeSessionHasMessages;
    if (currentSession?.id && !computeSessionHasMessages) {
      actualHasMessages = await checkSessionHasMessages(currentSession.id);
    }

    if (actualHasMessages && selectedAgent && selectedAgent.mode !== agent.mode) {
      Modal.confirm({
        title: "智能体切换警告",
        content: (
          <div>
            <p>当前会话已发送消息，切换智能体可能导致程序无法正常响应。</p>
            <p>因为后端暂未完全实现此功能，建议创建新会话使用其他智能体。</p>
            <p>是否仍要继续切换？</p>
          </div>
        ),
        okText: "继续切换",
        cancelText: "取消",
        onOk: async () => {
          await performAgentSwitch(agent);
        },
      });
      return;
    }
    await performAgentSwitch(agent);
  };
  // Group sessions by time period
  const groupSessions = (sessions: Session[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);
    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);

    return {
      today: sessions.filter((s) => {
        const date = new Date(s.created_at || "");
        return date >= today;
      }),
      yesterday: sessions.filter((s) => {
        const date = new Date(s.created_at || "");
        return date >= yesterday && date < today;
      }),
      last7Days: sessions.filter((s) => {
        const date = new Date(s.created_at || "");
        return date >= last7Days && date < yesterday;
      }),
      last30Days: sessions.filter((s) => {
        const date = new Date(s.created_at || "");
        return date >= last30Days && date < last7Days;
      }),
      older: sessions.filter((s) => {
        const date = new Date(s.created_at || "");
        return date < last30Days;
      }),
    };
  };

  // Sort sessions by date in descending order (most recent first)
  const sortedSessions = useMemo(
    () =>
      Array.isArray(sessions) && sessions
        ? [...sessions].sort((a, b) => {
          return (
            new Date(b.created_at || "").getTime() -
            new Date(a.created_at || "").getTime()
          );
        })
        : [],
    [sessions]
  );

  const groupedSessions = useMemo(
    () => groupSessions(sortedSessions),
    [sortedSessions]
  );

  // Helper function to render session group
  const renderSessionGroup = (sessions: Session[]) => (
    <>
      {sessions.map((s) => {
        const status = s.id !== undefined ? sessionRunStatuses[s.id as number] : undefined;
        // const status = sessionRunStatuses[s.id];
        const isActive = [
          "active",
          "awaiting_input",
          "pausing",
          "paused",
        ].includes(status as string);
        return (
          <div key={s.id} className="relative mb-0.5">
            <div
              className={`group flex items-center justify-between px-3 py-1.5 rounded-lg transition-all duration-200 ${isLoading
                ? "pointer-events-none opacity-50"
                : "cursor-pointer hover:bg-tertiary/20"
                } ${currentSession?.id === s.id
                  ? "bg-purple-100/50"
                  : ""
                }`}
              onClick={() => !isLoading && onSelectSession(s)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={`rounded-full flex-shrink-0 ${currentSession?.id === s.id
                  ? "bg-accent"
                  : "bg-secondary/50"
                  }`} />
                <div className="session-title-container">
                  <Tooltip
                    title={s.name}
                    placement="top"
                    mouseEnterDelay={0.5}
                  >
                    <span
                      className={`text-sm font-medium session-title ${currentSession?.id === s.id
                        ? "text-primary font-semibold"
                        : "text-primary"
                        } ${s.id && sessionRunStatuses[s.id] ? 'session-title-with-status' : ''
                        }`}
                    >
                      {s.name}
                    </span>
                  </Tooltip>
                </div>
                {s.id && (
                  <div className="flex-shrink-0 transition-all session-status-indicator">
                    <SessionRunStatusIndicator
                      status={sessionRunStatuses[s.id]}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "edit",
                        label: (
                          <>
                            <Edit className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                            Edit
                          </>
                        ),
                        onClick: (e) => {
                          e.domEvent.stopPropagation();
                          onEditSession(s);
                        },
                      },
                      {
                        key: "stop",
                        label: (
                          <>
                            <StopCircle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                            Disconnect
                          </>
                        ),
                        onClick: (e) => {
                          e.domEvent.stopPropagation();
                          if (isActive && s.id) onStopSession(s.id);
                        },
                        disabled: !isActive,
                        danger: true,
                      },
                      {
                        key: "delete",
                        label: (
                          <>
                            <Trash2 className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                            Delete
                          </>
                        ),
                        onClick: (e) => {
                          e.domEvent.stopPropagation();
                          if (s.id) onDeleteSession(s.id);
                        },
                        danger: true,
                      },
                      {
                        key: "learn-plan",
                        label: (
                          <LearnPlanButton
                            sessionId={Number(s.id)}
                            messageId={-1}
                          />
                        ),
                        onClick: (e) => e.domEvent.stopPropagation(),
                      },
                    ],
                  }}
                  placement="bottomRight"
                >
                  <Button
                    variant="tertiary"
                    size="sm"
                    icon={<MoreVertical className="w-3.5 h-3.5 text-secondary" />}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.blur()}
                    className="!p-0 min-w-[20px] h-5 sidebar-dropdown-button hover:bg-tertiary/30"
                    style={{
                      outline: 'none',
                      border: 'none',
                      boxShadow: 'none',
                      '--tw-ring-shadow': '0 0 #0000',
                      '--tw-ring-offset-shadow': '0 0 #0000'
                    } as React.CSSProperties}
                  />
                </Dropdown>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // 处理滚动事件，添加滚动时的样式
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let scrollTimeout: NodeJS.Timeout;

    const handleScroll = () => {
      scrollElement.classList.add('scrolling');

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        scrollElement.classList.remove('scrolling');
      }, 1000);
    };

    scrollElement.addEventListener('scroll', handleScroll);

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [isOpen]);

  const sidebarContent = useMemo(() => {
    if (!isOpen) {
      return null;
    }

    return (
      <div className="h-full flex flex-col bg-secondary/80 dark:bg-secondary/80 light:bg-gray-50/90">
        {/* 固定头部 */}
        <div className="flex-shrink-0 p-3">
          <div className="flex items-center justify-between mb-4">
            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={onLogoClick}
            >
              <img
                src="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview"
                alt="Dr.Sai Logo"
                className="w-6 h-6 rounded-md object-cover"
              />

            </div>

            {/* 侧边栏切换按钮 */}
            <Tooltip title="Close Sidebar">
              <Button
                variant="tertiary"
                size="sm"
                icon={<PanelLeftClose strokeWidth={1.5} className="h-4 w-4" />}
                onClick={onToggle}
                className="!px-1 transition-colors hover:text-accent"
              />
            </Tooltip>
          </div>
          <div className="animate-fade-in">
            <SubMenu
              items={[
                {
                  id: "current_session",
                  label: "Current Session",
                  icon: <FileText className="w-4 h-4" />,
                },
                {
                  id: "saved_plan",
                  label: "Saved Plans",
                  icon: <Archive className="w-4 h-4" />,
                },
                {
                  id: "agent_square",
                  label: "Dr.Sai Hub",
                  icon: <Sailboat className="w-4 h-4" />
                }
              ]}
              activeItem={activeSubMenuItem}
              onClick={onSubMenuChange}
            />
          </div>
        </div>

        {/* 可滚动内容区域 */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Agents 平铺列表 */}
          {Array.isArray(agents) && agents.length > 0 && (
            <div className="px-3 pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-primary font-medium">Agents</span>
                <span className="text-xs text-secondary bg-tertiary/30 px-2 py-0.5 rounded">{agents.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                {agents.map((agent) => {
                  const isSelected = selectedAgent?.mode === agent.mode;
                  const icon = getAgentIcon(agent.mode || "");
                  return (
                    <button
                      key={agent.mode}
                      type="button"
                      onClick={() => handleAgentItemClick(agent)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors duration-150 ${isSelected ? "bg-[#e7e5f2] text-[#4d3dc3] hover:bg-[#e7e5f2]" : "text-[#4a5568] hover:bg-[#f9fafb]"}`}
                    >
                      {icon ? (
                        <img
                          src={icon}
                          alt={agent.name}
                          className="w-6 h-6"
                          style={{
                            borderRadius: "4px",
                            padding: "2px",
                            filter: agent.mode === "magentic-one" ? "brightness(0) saturate(100%)" : "none",
                          }}
                        />
                      ) : (
                        <div className="w-6 h-6 rounded bg-tertiary/40" />
                      )}
                      <div className="flex-1 text-left">
                        <div className="truncate">{agent.name}</div>
                        {/* {agent.description && (
                          <div className="text-xs truncate mt-1 text-[#4a5568]">{agent.description}</div>
                        )} */}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex-shrink-0 px-3 pt-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-primary font-medium">Sessions</span>
                <span className="text-xs text-secondary bg-tertiary/30 px-2 py-0.5 rounded">
                  {sortedSessions.length}
                </span>
              </div>

              {isLoading && (
                <div className="flex items-center text-sm text-secondary">
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>

            <div className="mb-3">
              <Tooltip title="Create new session">
                <Button
                  className="w-full bg-accent hover:bg-accent/90"
                  variant="primary"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={() => onEditSession()}
                  disabled={isLoading}
                >
                  New Session
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* 会话列表 - 可滚动区域 */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 pb-3 sidebar-scroll"
          >
            {sortedSessions.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 rounded-2xl bg-tertiary/30 flex items-center justify-center mx-auto mb-3">
                  <InfoIcon className="w-6 h-6 text-secondary" />
                </div>
                <p className="text-secondary text-sm">No recent sessions found</p>
                <p className="text-secondary/60 text-xs mt-1">Create a new session to get started</p>
              </div>
            ) : (
              <>
                {groupedSessions.today.length > 0 && (
                  <div>
                    <div className="py-1 text-xs text-secondary">Today</div>
                    {renderSessionGroup(groupedSessions.today)}
                  </div>
                )}
                {groupedSessions.yesterday.length > 0 && (
                  <div>
                    <div className="py-1 text-xs text-secondary">
                      Yesterday
                    </div>
                    {renderSessionGroup(groupedSessions.yesterday)}
                  </div>
                )}
                {groupedSessions.last7Days.length > 0 && (
                  <div>
                    <div className="py-1 text-xs text-secondary">
                      Last 7 Days
                    </div>
                    {renderSessionGroup(groupedSessions.last7Days)}
                  </div>
                )}
                {groupedSessions.last30Days.length > 0 && (
                  <div>
                    <div className="py-1 text-xs text-secondary">
                      Last 30 Days
                    </div>
                    {renderSessionGroup(groupedSessions.last30Days)}
                  </div>
                )}
                {groupedSessions.older.length > 0 && (
                  <div>
                    <div className="py-1 text-xs text-secondary">Older</div>
                    {renderSessionGroup(groupedSessions.older)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 用户菜单 - 固定在底部 */}
        {user && (
          <div className="flex-shrink-0 p-3 border-t border-border-primary/20">
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "profile",
                    label: "用户信息",
                    icon: <User className="w-4 h-4" />,
                    onClick: () => setIsProfileModalOpen(true),
                  },
                  {
                    key: "settings",
                    label: "设置",
                    icon: <Settings className="w-4 h-4" />,
                    onClick: () => setIsSettingsOpen(true),
                  },
                  // 只在非开发模式下显示退出登录按钮
                  ...(process.env.GATSBY_SERVICE_MODE !== "DEV" ? [
                    {
                      type: "divider" as const,
                    },
                    {
                      key: "logout",
                      label: "退出登录",
                      icon: <LogOut className="w-4 h-4" />,
                      onClick: handleLogout,
                      danger: true,
                    },
                  ] : []),
                ],
              }}
              placement="topLeft"
            >
              <button
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left text-secondary hover:text-accent hover:bg-tertiary/20"
              >
                <div className="flex items-center justify-center w-5 h-5">
                  {user.avatar_url ? (
                    <img
                      className="h-5 w-5 rounded-full"
                      src={user.avatar_url}
                      alt={user.name}
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-accent text-white flex items-center justify-center text-xs font-medium">
                      {(user.name || user.email || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="flex-1 truncate">
                  {user.name || user.email}
                </span>
              </button>
            </Dropdown>
          </div>
        )}
      </div>
    );
  }, [
    isOpen,
    activeSubMenuItem,
    onSubMenuChange,
    sortedSessions,
    groupedSessions,
    isLoading,
    onEditSession,
    renderSessionGroup,
    user,
    isProfileModalOpen,
    isSettingsOpen,
  ]);

  return (
    <>
      {sidebarContent}
      <UserProfileModal
        isVisible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user || { name: '', email: '' }}
      />
      <SettingsMenu
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
};
