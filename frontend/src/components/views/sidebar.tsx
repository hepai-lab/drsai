import { Dropdown, Tooltip } from "antd";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Edit,
  FileText,
  InfoIcon,
  LogOut,
  MoreVertical,
  PanelLeftClose,
  Plus,
  RefreshCcw,
  Sailboat,
  Settings,
  StopCircle,
  Trash2,
  User
} from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import magneticOneIcon from "../../assets/magentic-one.png";
import magneticTwoIcon from "../../assets/magentic-two.svg";
import { appContext } from "../../hooks/provider";
import { Agent } from "../../types/common";
import { Button } from "../common/Button";
import SubMenu from "../common/SubMenu";
import LearnPlanButton from "../features/Plans/LearnPlanButton";
import SettingsMenu from "../settings";
import type { RunStatus, Session } from "../types/datamodel";
import UserProfileModal from "../userProfile";
import { SessionRunStatusIndicator } from "./statusicon";



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
  agents?: Agent[];
  selectedAgentMode?: string;
  selectedAgent?: Partial<Agent> | null;
  onAgentClick?: (agent: Agent) => void;
  onDeleteAgent?: (id: string) => void;
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
  selectedAgentMode,
  selectedAgent,
  onAgentClick,
  onDeleteAgent,
}) => {
  const { user } = React.useContext(appContext);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isAgentsExpanded, setIsAgentsExpanded] = React.useState(true);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_name");
    // 根据GATSBY_SSO环境变量决定跳转目标
    if (process.env.GATSBY_SERVICE_MODE === "DEV") {
      window.location.href = "/login";
    } else {
      window.location.href = "/umt/logout";
    }
  };

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
                        disabled: isLoading,
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
          <div className="flex items-center justify-between mb-2">
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
          {/* 当前 Agent 名称已移动到 ContentHeader 显示 */}
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
                <div className="flex items-center gap-2">
                  <span className="text-primary font-medium">Agents</span>
                  <span className="text-xs text-secondary bg-tertiary/30 px-2 py-0.5 rounded">
                    {agents.length}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={isAgentsExpanded ? "Collapse agents" : "Expand agents"}
                  className="text-secondary hover:text-primary text-sm px-2 py-0.5 rounded select-none hover:bg-tertiary/20 transition-colors"
                  onClick={() => setIsAgentsExpanded((v) => !v)}
                >
                  {isAgentsExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>
              {isAgentsExpanded && (
                <div className="grid grid-cols-1 gap-1">
                  {agents.map((agent) => {
                    // 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断选中状态
                    // 对于其他智能体，使用 mode 来判断选中状态
                    let isSelected = false;
                    if (agent.type === "add") {
                      // 自定义智能体优先使用 id，如果没有 id 则使用 name
                      if (agent.id && selectedAgent?.id) {
                        isSelected = agent.id === selectedAgent.id;
                      } else if (selectedAgent?.name) {
                        isSelected =
                          agent.name === selectedAgent.name && selectedAgentMode === agent.mode;
                      } else {
                        isSelected = false;
                      }
                    } else {
                      // 非自定义智能体使用 mode 判断
                      isSelected = selectedAgentMode === agent.mode;
                    }
                    const icon = getAgentIcon(agent.mode || "");
                    // 使用唯一标识作为 key：优先使用 id，其次使用 mode + name
                    const agentKey =
                      agent.id ||
                      (agent.mode && agent.name ? `${agent.mode}-${agent.name}` : agent.mode) ||
                      `agent-${agent.name}`;
                    return (
                      <div key={agentKey} className="relative group">
                        <button
                          type="button"
                          onClick={() => onAgentClick && onAgentClick(agent)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors duration-150 ${isSelected ? "bg-[#e7e5f2] text-[#4d3dc3] hover:bg-[#e7e5f2]" : "text-[#4a5568] hover:bg-[#f9fafb]"}`}
                        >
                          {agent.logo ? (
                            <img
                              src={agent.logo}
                              alt={agent.name}
                              className="w-6 h-6 rounded"
                              style={{
                                padding: "2px",
                                filter:
                                  agent.mode === "magentic-one"
                                    ? "brightness(0) saturate(100%)"
                                    : "none",
                              }}
                            />
                          ) : icon ? (
                            <img
                              src={icon}
                              alt={agent.name}
                              className="w-6 h-6"
                              style={{
                                borderRadius: "4px",
                                padding: "2px",
                                filter:
                                  agent.mode === "magentic-one"
                                    ? "brightness(0) saturate(100%)"
                                    : "none",
                              }}
                            />
                          ) : (
                            <div className="w-6 h-6 rounded bg-tertiary/40 flex items-center justify-center">
                              <span className="text-xs font-medium text-secondary">
                                {String(agent.name || '').charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="flex-1 text-left">
                            <div className="truncate font-medium">{agent.name}</div>
                          </div>
                        </button>

                        {agent.type === "add" && isSelected && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Dropdown
                              trigger={["hover"]}
                              menu={{
                                items: [
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
                                      if (onDeleteAgent && agent.id) {
                                        onDeleteAgent(agent.id);
                                      }
                                    },
                                    danger: true,
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
                                className="!p-0 min-w-[20px] h-5 hover:bg-tertiary/30"
                                style={{
                                  outline: "none",
                                  border: "none",
                                  boxShadow: "none",
                                  "--tw-ring-shadow": "0 0 #0000",
                                  "--tw-ring-offset-shadow": "0 0 #0000",
                                } as React.CSSProperties}
                              />
                            </Dropdown>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
                      {String(user.name || user.email || '?').charAt(0).toUpperCase()}
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
