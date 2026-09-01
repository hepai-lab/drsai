import React, { useMemo, useState, useEffect, useRef } from "react";
import { Spin } from "antd";
import {
  Download, Pencil, BookmarkPlus, BookmarkMinus, Check, Share2, Trash2, Lock, Heart,
  Calendar, List, Info, FileText, Globe, GitBranch, Tag, AlignLeft,
} from "lucide-react";
import MarkdownRenderer from "../components/common/markdownrender";
import type { SkillsPublicDetail } from "../components/views/api";
import { resolveSkillAssetUrl } from "./skills-square/utils";

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

type DetailTab = "info" | "description" | "content";

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
  if (source === "created") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  return "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300";
}

const CARD_CLS = "rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden dark:border-white/[0.06] dark:bg-slate-900";

const SkillDetailPanel: React.FC<SkillDetailPanelProps> = ({
  skillDetail, loading, onClose, onDownload, renderSkillIcon, t,
  onEdit, onTogglePublic, showToggleButton,
  isCollected, isImporting, onImport, onShare,
  source, onDelete, onUncollect,
}) => {
  const [locale] = useState(() => (typeof navigator !== "undefined" ? navigator.language : "zh-CN"));
  const isZh = locale.startsWith("zh");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("info");

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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300/80 bg-gray-50/50 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.02]">
        <p className="text-base font-medium text-gray-700 dark:text-gray-200">{t("skillSquare.notFound")}</p>
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
      default: "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.08]",
      danger: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/15",
      warning: "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/15",
      accent: "text-accent hover:bg-accent/8",
      disabled: "text-gray-400 cursor-not-allowed dark:text-gray-500",
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
  const profileSrc = resolveSkillAssetUrl(skillDetail.profile);

  return (
    <div className="flex flex-col gap-5 max-w-full">
      {/* ═══ TOP CARD: Skill info + actions ═══ */}
      <div className={`shrink-0 ${CARD_CLS}`}>
        {/* Subtle gradient accent bar at top */}
        <div className="h-1 w-full bg-gradient-to-r from-accent/60 via-purple-400/40 to-blue-400/30" />
        <div className="p-5">
        <div className="flex flex-col md:flex-row md:items-start gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {profileSrc ? (
              <img src={profileSrc} alt={skillDetail.name} className="h-14 w-14 rounded-2xl object-cover shrink-0 shadow-sm ring-1 ring-gray-200/80 dark:ring-white/10" />
            ) : (
              renderSkillIcon(skillDetail.icon, "h-14 w-14 rounded-2xl shrink-0", "h-7 w-7")
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="break-words text-xl font-bold text-gray-900 dark:text-white leading-tight">{skillDetail.name}</h1>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${sourceColor(skillSource)}`}>
                  <Globe className="h-3 w-3" />{sourceLabel(skillSource, isZh)}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {skillDetail.version && skillDetail.version !== "0.0.0" && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <GitBranch className="h-3 w-3" /> v{skillDetail.version}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                  <Download className="h-3 w-3" />{skillDetail.downloads ?? 0}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                  <Heart className="h-3 w-3" />{skillDetail.collects ?? 0}
                </span>
                {ownerLabel && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">{ownerAvatar}</span>
                    <span className="truncate max-w-[120px]" title={ownerLabel}>{ownerLabel}</span>
                  </span>
                )}
                {skillDetail.created_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400" title={new Date(skillDetail.created_at).toLocaleDateString()}>
                    <Calendar className="h-3 w-3" />{formatRelativeTime(skillDetail.created_at, isZh)}
                  </span>
                )}
              </div>

              {skillDetail.category && skillDetail.category.trim() !== "" && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skillDetail.category.split(",").map((t) => {
                    const trimmed = t.trim();
                    if (!trimmed) return null;
                    return <span key={trimmed} className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400">{trimmed}</span>;
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex md:flex-col gap-2 shrink-0">
            {restricted ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-xs font-medium text-gray-400 cursor-not-allowed whitespace-nowrap dark:bg-white/[0.05] dark:text-gray-500 w-full">
                <Download className="h-4 w-4" />{t("skillSquare.downloadBtn")}
              </div>
            ) : (
              <button type="button" onClick={() => void onDownload(skillDetail.slug)}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-purple-600 hover:shadow-md active:scale-[0.98] whitespace-nowrap w-full">
                <Download className="h-4 w-4" />{t("skillSquare.downloadBtn")}
              </button>
            )}
            {isCollected !== undefined && onImport && (
              isCollected ? (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-xs font-medium text-blue-400 dark:bg-blue-500/10 dark:text-blue-400/60 cursor-default whitespace-nowrap w-full">
                  <Check className="h-4 w-4" strokeWidth={2.5} />{t("skillSquare.collected")}
                </div>
              ) : (
                <button type="button" disabled={isImporting} onClick={() => onImport?.(skillDetail.slug, skillDetail.name)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap w-full">
                  {isImporting ? <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <BookmarkPlus className="h-4 w-4" />}
                  {isImporting ? t("skillSquare.collecting") : t("skillSquare.importBtn")}
                </button>
              )
            )}
            {hasOtherActions && (
              <div className="hidden md:flex flex-col gap-1 rounded-xl border border-gray-200/70 bg-gray-50/50 p-1.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
                {otherActions}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* ═══ BOTTOM CARD: Tabs + content ═══ */}
      <div className={`flex flex-col ${CARD_CLS}`}>
        {/* Tab bar */}
        <div className="shrink-0 flex items-center gap-1 border-b border-gray-200/70 bg-gray-50/30 px-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <button type="button" onClick={() => setActiveTab("info")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${activeTab === "info" ? "border-accent text-accent bg-white dark:bg-slate-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"}`}>
            <Info className="h-3.5 w-3.5" />{isZh ? "基本信息" : "Info"}
          </button>
          <button type="button" onClick={() => setActiveTab("description")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${activeTab === "description" ? "border-accent text-accent bg-white dark:bg-slate-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"}`}>
            <AlignLeft className="h-3.5 w-3.5" />{isZh ? "描述" : "Description"}
          </button>
          <button type="button" onClick={() => setActiveTab("content")}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium rounded-t-lg transition-all duration-200 border-b-2 -mb-[1px] ${activeTab === "content" ? "border-accent text-accent bg-white dark:bg-slate-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/[0.04]"}`}>
            <FileText className="h-3.5 w-3.5" />{isZh ? "技能内容" : "Skill Content"}
          </button>
        </div>

        {/* Tab body */}
        <div className="p-5">
          {activeTab === "info" ? (
            <div className="space-y-5">
              {/* Info grid — only fields NOT already shown in the top card */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {compatibility && (
                  <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{isZh ? "兼容性" : "Compatibility"}</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{compatibility}</p>
                  </div>
                )}
                <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{isZh ? "标识符" : "Slug"}</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 font-mono text-[12px]">{skillDetail.slug}</p>
                </div>
                {skillDetail.created_at && (
                  <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{isZh ? "创建时间" : "Created"}</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100" title={new Date(skillDetail.created_at).toLocaleDateString()}>{formatRelativeTime(skillDetail.created_at, isZh)}</p>
                  </div>
                )}
                {skillDetail.updated_at && (
                  <div className="group rounded-xl border border-gray-200/70 bg-gradient-to-b from-gray-50/50 to-white px-4 py-3.5 transition-all duration-200 hover:border-accent/20 hover:shadow-sm dark:border-white/[0.08] dark:from-white/[0.03] dark:to-transparent dark:hover:border-accent/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{isZh ? "更新时间" : "Updated"}</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100" title={new Date(skillDetail.updated_at).toLocaleDateString()}>{formatRelativeTime(skillDetail.updated_at, isZh)}</p>
                  </div>
                )}
              </div>

              {skillDetail.changelog && (
                <div className="rounded-lg border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-xs dark:border-amber-800/40 dark:bg-amber-900/15">
                  <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200 mb-1"><Tag className="h-3.5 w-3.5" />{t("skillSquare.changelog")}</p>
                  <p className="break-words leading-relaxed text-amber-700 dark:text-amber-300">{skillDetail.changelog}</p>
                </div>
              )}
              {restricted && (
                <div className="rounded-lg border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-xs dark:border-amber-800/40 dark:bg-amber-900/20">
                  <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><Lock className="h-3.5 w-3.5" />{t("skillSquare.restrictedTitle")}</p>
                  <p className="mt-1.5 leading-relaxed text-amber-700 dark:text-amber-300">{t("skillSquare.restrictedDesc")}</p>
                </div>
              )}
            </div>
          ) : activeTab === "description" ? (
            <div>
              {skillDetail.description ? (
                <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{skillDetail.description}</p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">{isZh ? "暂无描述" : "No description"}</p>
              )}
            </div>
          ) : (
            /* Skill Content tab: body (left) + TOC (right) */
            <div className="flex gap-5 min-h-0">
              <div className="min-w-0 flex-1">
                {skillDetail.body && !restricted ? (
                  <div ref={bodyRef} className="overflow-x-auto rounded-xl border border-gray-200/70 bg-gray-50/50 p-6 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <MarkdownRenderer content={skillDetail.body} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{isZh ? "暂无技能内容" : "No skill content available"}</p>
                  </div>
                )}
              </div>
              {/* TOC — only on content tab */}
              {tocItems.length > 1 && (
                <div className="hidden lg:block w-44 shrink-0">
                  <div className="sticky top-0 rounded-lg border border-gray-200/70 bg-gray-50/50 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                      <List className="h-3 w-3" />{isZh ? "目录" : "On this page"}
                    </p>
                    <nav className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                      {tocItems.map((item) => (
                        <a key={item.id} href={`#${item.id}`}
                          onClick={(e) => { e.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                          className="block truncate rounded-md px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
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