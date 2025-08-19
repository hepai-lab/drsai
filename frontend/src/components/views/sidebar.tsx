import { Dropdown, Menu, Tooltip } from "antd";
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
  Sailboat
} from "lucide-react";
import React, { useMemo, useRef, useEffect } from "react";
import { Button } from "../common/Button";
import SubMenu from "../common/SubMenu";
import LearnPlanButton from "../features/Plans/LearnPlanButton";
import type { RunStatus, Session } from "../types/datamodel";



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
}) => {
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
                {/* {s.id && (
                  <div className="flex-shrink-0 transition-all session-status-indicator">
                    <SessionRunStatusIndicator
                      status={sessionRunStatuses[s.id]}
                    />
                  </div>
                )} */}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                <Dropdown
                  trigger={["click"]}
                  overlay={
                    <Menu>
                      <Menu.Item
                        key="edit"
                        onClick={(e) => {
                          e.domEvent.stopPropagation();
                          onEditSession(s);
                        }}
                      >
                        <Edit className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                        Edit
                      </Menu.Item>
                      <Menu.Item
                        key="stop"
                        onClick={(e) => {
                          e.domEvent.stopPropagation();
                          if (isActive && s.id) onStopSession(s.id);
                        }}
                        disabled={!isActive}
                        danger
                      >
                        <StopCircle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                        Disconnect
                      </Menu.Item>
                      <Menu.Item
                        key="delete"
                        onClick={(e) => {
                          e.domEvent.stopPropagation();
                          if (s.id) onDeleteSession(s.id);
                        }}
                        danger
                      >
                        <Trash2 className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />{" "}
                        Delete
                      </Menu.Item>
                      <Menu.Item
                        key="learn-plan"
                        onClick={(e) => e.domEvent.stopPropagation()}
                      >
                        <LearnPlanButton
                          sessionId={Number(s.id)}
                          messageId={-1}
                        />
                      </Menu.Item>
                    </Menu>
                  }
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
  ]);

  return sidebarContent;
};
