import { Dropdown, Menu, Tooltip } from "antd";
import {
  Archive,
  Edit,
  FileText,
  InfoIcon,
  MoreVertical,
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
          <div key={s.id} className="relative mb-1">
            <div
              className={`group flex items-center justify-between p-3 rounded-xl text-sm transition-smooth ${isLoading
                ? "pointer-events-none opacity-50"
                : "cursor-pointer hover:bg-tertiary/50 hover-lift"
                } ${currentSession?.id === s.id
                  ? "bg-accent/10 border border-accent/30 shadow-modern"
                  : "border border-transparent hover:border-border-primary"
                }`}
              onClick={() => !isLoading && onSelectSession(s)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0 transition-all group-hover:pr-10">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSession?.id === s.id
                  ? "bg-accent animate-pulse-glow"
                  : "bg-secondary"
                  }`} />
                <Tooltip
                  title={s.name}
                  placement="top"
                  mouseEnterDelay={0.5}
                >
                  <span className="text-sm font-medium text-primary flex-1 min-w-0 transition-all truncate">
                    <span className="group-hover:hidden">
                      {s.name}
                    </span>
                    <span className="hidden group-hover:inline">
                      {s.name.slice(0, 8)}
                      {s.name.length > 8 ? "..." : ""}
                    </span>
                  </span>
                </Tooltip>
                {s.id && (
                  <div className="flex-shrink-0 transition-all">
                    <SessionRunStatusIndicator
                      status={sessionRunStatuses[s.id]}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth absolute right-1 top-1/2 transform -translate-y-1/2">
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
                    icon={<MoreVertical className="w-4 h-4" />}
                    onClick={(e) => e.stopPropagation()}
                    className="!p-0 min-w-[24px] h-6"
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
      <div className="h-full flex flex-col border-r border-border-primary/50 bg-primary/50 backdrop-blur-sm">
        {/* 固定头部 */}
        <div className="flex-shrink-0 p-4 border-b border-border-primary/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-gradient-primary flex items-center justify-center animate-float">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary">Workspace</h2>
              <p className="text-xs text-secondary/60">Manage your sessions and plans</p>
            </div>
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
          <div className="flex-shrink-0 px-4 pt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-primary font-semibold">Sessions</span>
                <span className="text-xs text-secondary bg-tertiary/50 px-2 py-1 rounded-full">
                  {sortedSessions.length}
                </span>
              </div>

              {isLoading && (
                <div className="flex items-center text-sm text-secondary">
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>

            <div className="mb-4">
              <Tooltip title="Create new session">
                <Button
                  className="w-full bg-gradient-primary hover:shadow-modern-lg transition-smooth"
                  variant="primary"
                  size="md"
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
            className="flex-1 overflow-y-auto px-4 pb-4 sidebar-scroll"
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
                    <div className="py-2 text-sm text-secondary">Today</div>
                    {renderSessionGroup(groupedSessions.today)}
                  </div>
                )}
                {groupedSessions.yesterday.length > 0 && (
                  <div>
                    <div className="py-2 text-sm text-secondary">
                      Yesterday
                    </div>
                    {renderSessionGroup(groupedSessions.yesterday)}
                  </div>
                )}
                {groupedSessions.last7Days.length > 0 && (
                  <div>
                    <div className="py-2 text-sm text-secondary">
                      Last 7 Days
                    </div>
                    {renderSessionGroup(groupedSessions.last7Days)}
                  </div>
                )}
                {groupedSessions.last30Days.length > 0 && (
                  <div>
                    <div className="py-2 text-sm text-secondary">
                      Last 30 Days
                    </div>
                    {renderSessionGroup(groupedSessions.last30Days)}
                  </div>
                )}
                {groupedSessions.older.length > 0 && (
                  <div>
                    <div className="py-2 text-sm text-secondary">Older</div>
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
