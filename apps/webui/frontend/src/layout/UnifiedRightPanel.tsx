import React, { useContext, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileEdit,
  FilePlus,
  FileText,
  Library,
  Megaphone,
  Presentation,
  Scale,
  X,
} from 'lucide-react';import { appContext } from '../hooks/provider';
import { useLang } from '../i18n/useLang';
import { useRightPanelStore, type UnifiedRightTab } from '../store/rightPanel';
import { useCloudFilesStore } from '../store/cloudFiles';
import { MENU_IDS } from '../components/views/menuRoutes';

interface UnifiedRightPanelProps {
  isCompact?: boolean;
  /** Whether the active agent is DocMaster — controls visibility of the DocMaster tab. */
  isDocMasterAgent?: boolean;
  /** The currently active menu item id — tabs only show on the chat tab. */
  activeSubMenuItem?: string;
  templatesContent?: React.ReactNode;
  guanlianyewuContent?: React.ReactNode;
  zongheCailiaoContent?: React.ReactNode;
  /** 试用 button next to 申请资料审查 — seeds demo files and fires the audit prompt. */
  onTryGuanlianyewu?: () => void;
  /** 试用 button next to 综合材料撰写 — seeds demo files and fires the expert-recommendation prompt. */
  onTryZonghe?: () => void;
}

interface CollapsibleSectionProps {
  id: 'templates' | 'guanlianyewu';
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ id, icon, label, children }) => {
  const expanded = useCloudFilesStore((s) => s.sectionExpanded[id]);
  const toggle = useCloudFilesStore((s) => s.toggleSection);

  return (
    <div className="rounded-lg border border-border-primary/20 bg-tertiary/5">
      <button
        type="button"
        onClick={() => toggle(id)}
        className="flex items-center gap-1.5 w-full px-2.5 py-2 text-[1em] font-medium text-secondary hover:text-primary transition-colors"
      >
        <span className="flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="flex-shrink-0 opacity-70">{icon}</span>
        <span>{label}</span>
      </button>
      {expanded && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
};

/** Sub-collapsible inside 关联业务. State is local — no need for a store entry. */
interface SubCollapsibleProps {
  icon: React.ReactNode;
  label: string;
  comingSoon?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
  /** Optional inline action rendered to the right of the label.
   * Click handlers should call e.stopPropagation() so the section
   * doesn't toggle open/closed when the action is used. */
  headerAction?: React.ReactNode;
}

const SubCollapsible: React.FC<SubCollapsibleProps> = ({
  icon,
  label,
  comingSoon = false,
  defaultExpanded = false,
  children,
  headerAction,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-md border border-border-primary/15 bg-tertiary/[0.03]">
      <div className="flex items-center w-full px-2.5 py-2 text-[1em] font-medium text-secondary">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:text-primary transition-colors"
        >
          <span className="flex-shrink-0">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <span className="flex-shrink-0 opacity-70">{icon}</span>
          <span className="flex-1 text-left">{label}</span>
          {comingSoon && (
            <span className="flex-shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[0.85em] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              即将上线
            </span>
          )}
        </button>
        {headerAction && !comingSoon && (
          <span className="flex-shrink-0 ml-1">{headerAction}</span>
        )}
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5">
          {comingSoon ? (
            <div className="text-center py-3 text-[0.92em] font-medium text-amber-700 dark:text-amber-300">
              功能开发中，敬请期待
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Unified right sidebar — single collapse/width/resize, with a tab bar at the top.
 * DocMaster tab is conditional on the active agent; Logs tab is always visible.
 * The files/cloud panel has moved to LeftMenu.
 */
const UnifiedRightPanel: React.FC<UnifiedRightPanelProps> = ({
  isCompact = false,
  isDocMasterAgent = false,
  activeSubMenuItem,
  templatesContent,
  guanlianyewuContent,
  zongheCailiaoContent,
  onTryGuanlianyewu,
  onTryZonghe,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();

  const isOpen = useRightPanelStore((s) => s.isRightPanelOpen);
  const setIsOpen = useRightPanelStore((s) => s.setRightPanelOpen);
  const width = useRightPanelStore((s) => s.rightPanelWidth);
  const activeTab = useRightPanelStore((s) => s.activeRightTab);
  const setActiveTab = useRightPanelStore((s) => s.setActiveRightTab);
  const isDark = darkMode === 'dark';
  const panelWidth = isCompact ? '100%' : isOpen ? width : 36;

  // Scale text with viewport height: 1.2vh = 13px at 1080p (original design),
  // 17px at 1440p, 20px at 4K. Clamped to [11, 20] to stay readable.
  const [panelFontSize, setPanelFontSize] = useState(() =>
    typeof window === 'undefined' ? 13 : Math.round(Math.min(Math.max(window.innerHeight * 0.012, 11), 20))
  );
  useEffect(() => {
    const update = () =>
      setPanelFontSize(Math.round(Math.min(Math.max(window.innerHeight * 0.012, 11), 20)));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (isCompact && !isOpen) {
    return null;
  }

  const isChatTab = activeSubMenuItem === MENU_IDS.currentSession;

  const tabs: { id: UnifiedRightTab; label: string; icon: React.ReactNode }[] = [
    ...(isDocMasterAgent && isChatTab
      ? [{ id: 'docmaster' as const, label: '专属功能', icon: <FileText className="w-4 h-4" /> }]
      : []),
  ];

  return (
    <div
      className={`flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden shadow-modern ${isOpen && !isCompact ? 'rounded-2xl' : isCompact ? 'rounded-none' : 'rounded-lg'
        } ${isDark
          ? 'bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg'
          : 'bg-white/90 border border-gray-200/70 backdrop-blur-md'
        }`}
      style={{ width: panelWidth, fontSize: panelFontSize }}
    >
      {isOpen ? (
        <>
          {/* Tab bar */}
          <div
            className={`flex-shrink-0 flex items-stretch ${isDark ? 'bg-white/[0.02]' : 'border-b border-gray-200/80 bg-white/70'
              }`}
          >
            <div
              className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-3 py-2 text-[1em] font-medium transition-all select-none shrink-0 ${isActive
                      ? 'text-accent bg-accent/[0.11]'
                      : 'text-secondary hover:text-primary hover:bg-tertiary/25'
                      }`}
                  >
                    <span className={`transition-transform ${isActive ? 'scale-110' : ''}`}>
                      {tab.icon}
                    </span>
                    <span className={isActive ? 'font-semibold' : ''}>{tab.label}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title={t('rightpanel.collapse')}
              className={`flex-shrink-0 flex min-h-[3.5vh] min-w-[34px] items-center justify-center transition-colors ${isDark
                ? 'text-secondary hover:text-primary hover:bg-white/5'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/60'
                }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {isDocMasterAgent && isChatTab && (
              <div className={activeTab === 'docmaster' ? 'h-full flex flex-col overflow-y-auto' : 'hidden'}>
                <div className="space-y-1.5 p-2">
                  <CollapsibleSection
                    id="templates"
                    icon={<Library className="w-[18px] h-[18px]" />}
                    label={t('rightpanel.tab.templates')}
                  >
                    <div className="max-h-[38vh] overflow-y-auto -mx-3 -mb-3">
                      {templatesContent ?? (
                        <div className="text-center py-4 text-[1em] text-tertiary">
                          {t('rightpanel.empty.templates')}
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="guanlianyewu"
                    icon={<Scale className="w-[18px] h-[18px]" />}
                    label="科研计划任务"
                  >
                    <div className="space-y-1.5">
                      <SubCollapsible
                        icon={<ClipboardCheck className="w-4 h-4" />}
                        label="申请资料审查"
                        headerAction={onTryGuanlianyewu ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onTryGuanlianyewu();
                            }}
                            className="text-[0.92em] rounded px-2 py-1 font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                            title="加载演示文件并自动开始审核"
                          >
                            试用
                          </button>
                        ) : undefined}
                      >
                        {guanlianyewuContent ? (
                          <div className="max-h-[38vh] overflow-y-auto">{guanlianyewuContent}</div>
                        ) : (
                          <div className="text-center py-3 text-[0.92em] text-tertiary">
                            暂无审查内容
                          </div>
                        )}
                      </SubCollapsible>

                      <SubCollapsible
                        icon={<FileEdit className="w-4 h-4" />}
                        label="综合材料撰写"
                        headerAction={onTryZonghe ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onTryZonghe();
                            }}
                            className="text-[0.92em] rounded px-2 py-1 font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                            title="加载演示文件并自动生成专家意见表"
                          >
                            试用
                          </button>
                        ) : undefined}
                      >
                        {zongheCailiaoContent ? (
                          <div className="max-h-[38vh] overflow-y-auto">{zongheCailiaoContent}</div>
                        ) : (
                          <div className="text-center py-3 text-[0.92em] text-tertiary">
                            暂未启用
                          </div>
                        )}
                      </SubCollapsible>

                      <SubCollapsible
                        icon={<Megaphone className="w-4 h-4" />}
                        label="公示信息生成"
                        comingSoon
                      />
                    </div>
                  </CollapsibleSection>

                  <div className="rounded-lg border border-border-primary/20 bg-tertiary/5 flex items-center px-2.5 py-2 text-[1em] font-medium text-secondary">
                    <span className="flex items-center gap-1.5 flex-1 min-w-0">
                      <Presentation className="w-[18px] h-[18px] flex-shrink-0 opacity-70" />
                      <span>ppt生成</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('drsai:chatinput:setValue', {
                            detail: {
                              text: '请总结当前对话内容，根据总结内容生成一份ppt，使用浅色背景',
                            },
                          })
                        )
                      }
                      className="text-[0.92em] rounded px-2 py-1 font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-shrink-0 ml-1"
                      title="把生成 ppt 的提示语写入聊天输入框"
                    >
                      试用
                    </button>
                  </div>

                  <div className="rounded-lg border border-border-primary/20 bg-tertiary/5 flex items-center px-2.5 py-2 text-[1em] font-medium text-secondary">
                    <span className="flex items-center gap-1.5 flex-1 min-w-0">
                      <FilePlus className="w-[18px] h-[18px] flex-shrink-0 opacity-70" />
                      <span>docx生成</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('drsai:chatinput:setValue', {
                            detail: {
                              text: '给我写一份docx文件，主要内容是一首小诗，诗歌题材不限。字体使用宋体',
                            },
                          })
                        )
                      }
                      className="text-[0.92em] rounded px-2 py-1 font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-shrink-0 ml-1"
                      title="把生成 docx 的提示语写入聊天输入框"
                    >
                      试用
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Collapsed strip */
        <div className="flex flex-col items-center pt-2">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            title={t('rightpanel.expand')}
            className={`flex items-center justify-center w-full h-10 transition-colors ${isDark
              ? 'text-secondary hover:text-primary hover:bg-white/5'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/60'
              }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex flex-col items-center gap-1 mt-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setIsOpen(true);
                  setActiveTab(tab.id);
                }}
                title={tab.label}
                className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${activeTab === tab.id
                  ? 'text-accent bg-accent/10'
                  : isDark
                    ? 'text-secondary hover:text-primary hover:bg-white/5'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/60'
                  }`}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedRightPanel;
