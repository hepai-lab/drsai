import React, { useMemo, useState, useEffect, useRef } from "react";
import { Spin } from "antd";
import {
  Download, Pencil, BookmarkPlus, BookmarkMinus, Check, Share2, Trash2, Lock,
  Calendar, List, Info, FileText, Globe, GitBranch, Tag,
} from "lucide-react";
import MarkdownRenderer from "../components/common/markdownrender";
import type { SkillsPublicDetail } from "../components/views/api";

export interface SkillDetailPanelProps {
  skillDetail: SkillsPublicDetail;
  loading: boolean;
  onClose: () => void;
  onDownload: (slug: string) => void;
  renderSkillIcon: (icon: string, containerClass: string, iconClass: string) => React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: any, ...args: any[]) => string;
  onEdit?: () => void;
  onTogglePublic?: (slug: string, makePublic: boolean) => void;
  showToggleButton?: boolean;
  isCollected?: boolean;
  isImporting?: boolean;
  onImport?: (slug: string, displayName: string) => void;
  onShare?: () => void;
  source?: "created" | "imported";
  onDelete?: (slug: string, displayName: string) => void;
  onUncollect?: (slug: string, displayName: string) => void;
}

type DetailTab = "overview" | "content";

function formatRelativeTime(dateStr: string, isZh: boolean): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return isZh ? "刚刚" : "just now";
  if (mins < 60) return isZh ? `${mins} 分钟前` : `${mins}m ago`;
  if (hours < 24) return isZh ? `${hours} 小时前` : `${hours}h ago`;
  if (days < 30) return isZh ? `${days} 天前` : `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(isZh ? "zh-CN" : "en-US");
}

function extractToc(body: string): { id: string; level: number; text: string }[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const items: { id: string; level: number; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(body)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = `md-h-${text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")}`;
    items.push({ id, level, text });
  }
  return items;
}

function sourceLabel(source: string | undefined, isZh: boolean): string {
  if (source === "imported") return isZh ? "收藏" : "Imported";
  if (source === "higraf") return "Higraf";
  return isZh ? "我的创建" : "My Creation";
}

function sourceColor(source: string | undefined): string {
  if (source === "imported") return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (source === "higraf") return "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
}

const SkillDetailPanel: React.FC<SkillDetailPanelProps> = ({
  skillDetail, loading, onClose, onDownload, renderSkillIcon, t,
  onEdit, onTogglePublic, showToggleButton,
  isCollected, isImporting, onImport, onShare,
  source, onDelete, onUncollect,
}) => {
  const [locale] = useState(() => (typeof navigator !== "undefined" ? navigator.language : "zh-CN"));
  const isZh = locale.startsWith("zh");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const tocItems = useMemo(
    () => (skillDetail?.body ? extractToc(skillDetail.body) : []),
    [skillDetail?.body],
  );

  useEffect(() => {
    if (!bodyRef.current || activeTab !== "content") return;
    const headings = bodyRef.current.querySelectorAll("h1, h2, h3");
    headings.forEach((h) => {
      const text = (h.textContent || "").trim();
      const id = `md-h-${text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")}`;
      h.id = id;
    });
  }, [skillDetail?.body, activeTab]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spin /></div>;
  }

  if (!skillDetail) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-16 text-center">
        <p className="text-base font-medium text-primary">{t("skillSquare.notFound")}</p>
        <button type="button" onClick={onClose} className="mt-3 text-sm text-accent hover:text-accent/80 transition-colors">
          {t("skillSquare.backToList")}
        </button>
      </div>
    );
  }

  const restricted = skillDetail.restricted === true;
  const hasToggleButton = showToggleButton !== undefined;
  const ownerLabel = (skillDetail.owner || "").trim();
  const ownerAvatar = ownerLabel ? ownerLabel.charAt(0).toUpperCase() : "";
  const skillSource = (skillDetail as any).source as string | undefined || source;
  const compatibility = (skillDetail as any).compatibility as string | undefined;

  const ActionBtn = ({
    icon, label, onClick, variant = "default", disabled = false,
  }: {
    icon: React.ReactNode; label: string; onClick?: () => void;
    variant?: "default" | "danger" | "warning" | "accent" | "disabled"; disabled?: boolean;
  }) => {
    const v = {
      default: "text-secondary hover:bg-tertiary/50",
      danger: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/15",
      warning: "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/15",
      accent: "text-accent hover:bg-accent/8",
      disabled: "text-secondary/50 cursor-not-allowed",
    }[variant];
    return (
      <button type="button" disabled={disabled || variant === "disabled"} onClick={onClick}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${v}`}>
        {icon}{label}
      </button>
    );
  };

  const otherActions = (
    <>
      {onShare && <ActionBtn icon={<Share2 className="h-3.5 w-3.5" />} label={t("skillSquare.shareBtn")} onClick={onShare} />}
      {onEdit && isCollected === undefined && <ActionBtn icon={<Pencil className="h-3.5 w-3.5" />} label={t("skillSquare.editBtn")} onClick={onEdit} />}
      {hasToggleButton && onTogglePublic && (
        showToggleButton ? (
          <ActionBtn icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>}
            label={t("skillSquare.hideBtn")} onClick={() => onTogglePublic(skillDetail.slug, false)} variant="danger" />
        ) : (
          <ActionBtn icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
            label={t("skillSquare.makePublicBtn")} onClick={() => onTogglePublic(skillDetail.slug, true)} variant="accent" />
        )
      )}
      {source === "created" && onDelete && <ActionBtn icon={<Trash2 className="h-3.5 w-3.5" />} label={t("skillSquare.deleteOk")} onClick={() => onDelete(skillDetail.slug, skillDetail.name)} variant="danger" />}
      {source === "imported" && onUncollect && <ActionBtn icon={<BookmarkMinus className="h-3.5 w-3.5" />} label={t("skillSquare.uncollectOk")} onClick={() => onUncollect(skillDetail.slug, skillDetail.name)} variant="warning" />}
    </>
  );

  const hasOtherActions = !!(onShare || (onEdit && isCollected === undefined) || (hasToggleButton && onTogglePublic) || (source === "created" && onDelete) || (source === "imported" && onUncollect));

  return (
    <div className="flex flex-col h-full max-w-full">
      {/* ═══ Top: info (left) + buttons (right) ═══ */}
      <div className="shrink-0 flex flex-col md:flex-row md:items-start gap-4">
        {/* Left: skill info */}
        <div className="flex items-start gap-4 min-w-0 flex-1">
          {skillDetail.profile ? (
            <img src={skillDetail.profile} alt={skillDetail.name} className="h-14 w-14 rounded-2xl object-cover shrink-0 shadow-sm ring-1 ring-border-primary/20" />
          ) : (
            renderSkillIcon(skillDetail.icon, "h-14 w-14 rounded-2xl", "h-7 w-7")
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="break-words text-xl font-bold text-primary leading-tight">{skillDetail.name}</h1>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${sourceColor(skillSource)}`}>
                <Globe className="h-3 w-3" />{sourceLabel(skillSource, isZh)}
              </span>
            </div>
            {skillDetail.description && (
              <p className="mt-1 break-words text-sm leading-relaxed text-secondary line-clamp-2">{skillDetail.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {skillDetail.version && skillDetail.version !== "0.0.0" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <GitBranch className="h-3 w-3" /> v{skillDetail.version}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-secondary/70">
                <Download className="h-3 w-3" />{skillDetail.downloads ?? 0}
              </span>
              {ownerLabel && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-secondary/70">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">{ownerAvatar}</span>
                  <span className="truncate max-w-[120px]" title={ownerLabel}>{ownerLabel}</span>
                </span>
              )}
              {skillDetail.created_at && (
                <span className="inline-flex items-center gap-1 text-[11px] text-secondary/60" title={new Date(skillDetail.created_at).toLocaleDateString()}>
                  <Calendar className="h-3 w-3" />{formatRelativeTime(skillDetail.created_at, isZh)}
                </span>
              )}
            </div>
            {skillDetail.category && skillDetail.category.trim() !== "" && (
              <div className="mt-2 flex flex-wrap gap-1">
                {skillDetail.category.split(",").map((t) => {
                  const trimmed = t.trim();
                  if (!trimmed) return null;
                  return <span key={trimmed} className="inline-block rounded-full border border-border-primary/40 bg-tertiary/20 px-2 py-0.5 text-[10px] font-medium text-secondary/80">{trimmed}</span>;
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex md:flex-col gap-2 shrink-0">
          {restricted ? (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-tertiary/20 px-4 py-2 text-xs font-medium text-secondary/50 cursor-not-allowed whitespace-nowrap">
              <Download className="h-4 w-4" />{t("skillSquare.downloadBtn")}
            </div>
          ) : (
            <button type="button" onClick={() => void onDownload(skillDetail.slug)}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-purple-600 hover:shadow-md active:scale-[0.98] whitespace-nowrap">
              <Download className="h-4 w-4" />{t("skillSquare.downloadBtn")}
            </button>
          )}
          {isCollected !== undefined && onImport && (
            isCollected ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-xs font-medium text-blue-400 dark:bg-blue-500/10 dark:text-blue-400/60 cursor-default whitespace-nowrap">
                <Check className="h-4 w-4" strokeWidth={2.5} />{t("skillSquare.collected")}
              </div>
            ) : (
              <button type="button" disabled={isImporting} onClick={() => onImport?.(skillDetail.slug, skillDetail.name)}
                className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap">
                {isImporting ? <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <BookmarkPlus className="h-4 w-4" />}
                {isImporting ? t("skillSquare.collecting") : t("skillSquare.importBtn")}
              </button>
            )
          )}
          {hasOtherActions && (
            <div className="hidden md:flex flex-col gap-1 rounded-xl border border-border-primary/30 bg-tertiary/5 p-1.5 dark:border-white/[0.05] dark:bg-white/[0.01]">
              {otherActions}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Bottom: tabs + content ═══ */}
      <div className="flex-1 min-h-0 mt-5 flex flex-col">
        {/* Tab bar */}
        <div className="shrink-0 flex items-center border-b border-border-primary/30">
          <button type="button" onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "overview" ? "border-accent text-accent" : "border-transparent text-secondary hover:text-primary"}`}>
            <Info className="h-3.5 w-3.5" />{isZh ? "概览" : "Overview"}
          </button>
          <button type="button" onClick={() => setActiveTab("content")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${activeTab === "content" ? "border-accent text-accent" : "border-transparent text-secondary hover:text-primary"}`}>
            <FileText className="h-3.5 w-3.5" />{isZh ? "技能内容" : "Skill Content"}
          </button>
        </div>

        {/* Tab body */}
        <div className="flex-1 min-h-0 overflow-y-auto mt-4">
          {activeTab === "overview" ? (
            <div className="space-y-5">
              {/* Info cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{t("skillSquare.version")}</p>
                  <p className="text-sm font-medium text-primary">{skillDetail.version && skillDetail.version !== "0.0.0" ? `v${skillDetail.version}` : "—"}</p>
                </div>
                <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "下载量" : "Downloads"}</p>
                  <p className="text-sm font-medium text-primary">{skillDetail.downloads ?? 0}</p>
                </div>
                {ownerLabel && (
                  <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "作者" : "Author"}</p>
                    <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">{ownerAvatar}</span>{ownerLabel}
                    </p>
                  </div>
                )}
                {compatibility && (
                  <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "兼容性" : "Compatibility"}</p>
                    <p className="text-sm font-medium text-primary">{compatibility}</p>
                  </div>
                )}
                <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "来源" : "Source"}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceColor(skillSource)}`}>{sourceLabel(skillSource, isZh)}</span>
                </div>
                <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "标识符" : "Slug"}</p>
                  <p className="text-sm font-medium text-primary font-mono text-[12px]">{skillDetail.slug}</p>
                </div>
                {skillDetail.created_at && (
                  <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "创建时间" : "Created"}</p>
                    <p className="text-sm font-medium text-primary" title={new Date(skillDetail.created_at).toLocaleDateString()}>{formatRelativeTime(skillDetail.created_at, isZh)}</p>
                  </div>
                )}
                {skillDetail.updated_at && (
                  <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{isZh ? "更新时间" : "Updated"}</p>
                    <p className="text-sm font-medium text-primary" title={new Date(skillDetail.updated_at).toLocaleDateString()}>{formatRelativeTime(skillDetail.updated_at, isZh)}</p>
                  </div>
                )}
              </div>

              {skillDetail.changelog && (
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-xs dark:border-amber-800/40 dark:bg-amber-900/15">
                  <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200 mb-1"><Tag className="h-3.5 w-3.5" />{t("skillSquare.changelog")}</p>
                  <p className="break-words leading-relaxed text-amber-700 dark:text-amber-300">{skillDetail.changelog}</p>
                </div>
              )}
              {restricted && (
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-xs dark:border-amber-800/40 dark:bg-amber-900/20">
                  <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><Lock className="h-3.5 w-3.5" />{t("skillSquare.restrictedTitle")}</p>
                  <p className="mt-1.5 leading-relaxed text-amber-700 dark:text-amber-300">{t("skillSquare.restrictedDesc")}</p>
                </div>
              )}
              {skillDetail.description && (
                <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary/50 mb-1">{t("skillSquare.descriptionLabel")}</p>
                  <p className="text-sm leading-relaxed text-secondary">{skillDetail.description}</p>
                </div>
              )}
            </div>
          ) : (
            /* Skill Content tab: body (left) + TOC (right) */
            <div className="flex gap-5 min-h-0">
              <div className="min-w-0 flex-1">
                {skillDetail.body && !restricted ? (
                  <div ref={bodyRef} className="overflow-x-auto rounded-2xl border border-border-primary/40 bg-tertiary/10 p-6 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <MarkdownRenderer content={skillDetail.body} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-10 w-10 text-secondary/30 mb-3" />
                    <p className="text-sm text-secondary">{isZh ? "暂无技能内容" : "No skill content available"}</p>
                  </div>
                )}
              </div>
              {/* TOC — only on content tab */}
              {tocItems.length > 1 && (
                <div className="hidden lg:block w-44 shrink-0">
                  <div className="sticky top-0 rounded-xl border border-border-primary/30 bg-tertiary/5 p-3 dark:border-white/[0.05] dark:bg-white/[0.01]">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-secondary/70">
                      <List className="h-3 w-3" />{isZh ? "目录" : "On this page"}
                    </p>
                    <nav className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                      {tocItems.map((item) => (
                        <a key={item.id} href={`#${item.id}`}
                          onClick={(e) => { e.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                          className="block truncate rounded-md px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-tertiary/30 hover:text-primary"
                          style={{ paddingLeft: 8 + (item.level - 1) * 12 }}>
                          {item.text}
                        </a>
                      ))}
                    </nav>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillDetailPanel;