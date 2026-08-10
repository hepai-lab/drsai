import React from "react";
import { Spin } from "antd";
import { Download, Pencil, BookmarkPlus, BookmarkMinus, Check, Share2, Trash2 } from "lucide-react";
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
  // Private tab actions
  onEdit?: () => void;
  onTogglePublic?: (slug: string, makePublic: boolean) => void;
  showToggleButton?: boolean; // true=show 上架, false=show 下架, undefined=hide
  // Public tab actions
  isCollected?: boolean;
  isImporting?: boolean;
  onImport?: (slug: string, displayName: string) => void;
  // Private tab — share
  onShare?: () => void;
  // Private tab — delete / unfavorite
  source?: "created" | "imported";
  onDelete?: (slug: string, displayName: string) => void;
  onUncollect?: (slug: string, displayName: string) => void;
}

const SkillDetailPanel: React.FC<SkillDetailPanelProps> = ({
  skillDetail,
  loading,
  onClose,
  onDownload,
  renderSkillIcon,
  t,
  onEdit,
  onTogglePublic,
  showToggleButton,
  isCollected,
  isImporting,
  onImport,
  onShare,
  source,
  onDelete,
  onUncollect,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spin />
      </div>
    );
  }

  if (!skillDetail) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-16 text-center">
        <p className="text-base font-medium text-primary">{t("skillSquare.notFound")}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-sm text-accent hover:text-accent/80 transition-colors"
        >
          {t("skillSquare.backToList")}
        </button>
      </div>
    );
  }

  // SVG icons for toggle buttons
  const eyeOffIcon = (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

  const eyeIcon = (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const editIcon = (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );

  const hasToggleButton = showToggleButton !== undefined;

  return (
    <div className="flex flex-col gap-6 md:flex-row max-w-full">
      {/* Main content */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-tertiary/5 p-5 dark:bg-white/[0.02]">
        <div className="flex items-start gap-4">
          {skillDetail.profile ? (
            <img
              src={skillDetail.profile}
              alt={skillDetail.name}
              className="h-14 w-14 rounded-xl object-cover shrink-0 shadow-sm"
            />
          ) : (
            renderSkillIcon(skillDetail.icon, "h-14 w-14", "h-7 w-7")
          )}
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold text-primary">{skillDetail.name}</h1>
            {skillDetail.description && (
              <p className="mt-2 break-words text-sm leading-relaxed text-secondary">{skillDetail.description}</p>
            )}
          </div>
          {/* category */}
          {skillDetail.category && skillDetail.category.trim() !== "" && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {skillDetail.category.split(",").map((tag) => {
                const trimmed = tag.trim();
                if (!trimmed) return null;
                return (
                  <span
                    key={trimmed}
                    className="inline-block rounded-full border border-border-primary/40 bg-tertiary/20 px-2 py-0.5 text-[10px] font-medium text-secondary/80"
                  >
                    {trimmed}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {skillDetail.body ? (
          <div className="mt-6 overflow-x-auto rounded-xl border border-border-primary/40 bg-tertiary/10 p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <MarkdownRenderer content={skillDetail.body} />
          </div>
        ) : null}
      </div>

      {/* Sidebar */}
      <div className="w-full shrink-0 md:w-48">
        <div className="space-y-4 md:sticky md:top-6">
          {/* Meta info */}
          <div className="space-y-2.5 rounded-xl border border-border-primary/30 bg-tertiary/10 px-3.5 py-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
            {skillDetail.version && skillDetail.version !== "0.0.0" && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-secondary/70">{t("skillSquare.version")}</span>
                <span className="rounded-full border border-border-primary/60 bg-tertiary/25 px-2 py-0.5 font-agent-mono text-[10px] font-medium uppercase tracking-wide text-secondary">
                  v{skillDetail.version}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-secondary/70">{t("skillSquare.downloads")}</span>
              <span className="inline-flex items-center gap-1 text-secondary/80">
                <Download className="h-3 w-3" aria-hidden />
                {skillDetail.downloads || 0}
              </span>
            </div>

            {skillDetail.owner && (
              <div className="border-t border-border-primary/20 pt-2.5 dark:border-white/[0.04]">
                <p className="text-xs text-secondary/70">
                  {t("skillSquare.by")} <span className="font-medium text-secondary">{skillDetail.owner}</span>
                </p>
                {skillDetail.created_at && (
                  <p className="mt-1 text-[11px] text-secondary/60">
                    {t("skillSquare.created", new Date(skillDetail.created_at).toLocaleDateString())}
                  </p>
                )}
                {skillDetail.updated_at && (
                  <p className="text-[11px] text-secondary/60">
                    {t("skillSquare.updated", new Date(skillDetail.updated_at).toLocaleDateString())}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Changelog */}
          {skillDetail.changelog && (
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-200">
              <span className="flex items-center gap-1.5 font-medium">
                {t("skillSquare.changelog")}
                {editIcon}
              </span>
              <p className="mt-1 break-words leading-relaxed">{skillDetail.changelog}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => void onDownload(skillDetail.slug)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/8"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("skillSquare.downloadBtn")}
            </button>

            {/* Private tab: share */}
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-tertiary/50"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                {t("skillSquare.shareBtn")}
              </button>
            )}

            {/* Public tab: collect */}
            {isCollected !== undefined && onImport && (
              <>
                {isCollected ? (
                  <button
                    type="button"
                    disabled
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-accent/70 cursor-default"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    {t("skillSquare.collected")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isImporting}
                    onClick={() => onImport && onImport(skillDetail.slug, skillDetail.name)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-tertiary/50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isImporting ? (
                      <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-secondary/30 border-t-accent" />
                    ) : (
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {isImporting ? t("skillSquare.collecting") : t("skillSquare.importBtn")}
                  </button>
                )}
              </>
            )}

            {/* Private tab: edit + toggle visibility */}
            {onEdit && isCollected === undefined && (
              <button
                type="button"
                onClick={onEdit}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-tertiary/50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {t("skillSquare.editBtn")}
              </button>
            )}
            {hasToggleButton && onTogglePublic && (
              showToggleButton ? (
                <button
                  type="button"
                  onClick={() => onTogglePublic(skillDetail.slug, false)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/15"
                >
                  {eyeOffIcon}
                  {t("skillSquare.hideBtn")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTogglePublic(skillDetail.slug, true)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/15"
                >
                  {eyeIcon}
                  {t("skillSquare.makePublicBtn")}
                </button>
              )
            )}

            {/* Private tab: delete (my creations) / unfavorite (my collections) */}
            {source === "created" && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(skillDetail.slug, skillDetail.name)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/15"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t("skillSquare.deleteOk")}
              </button>
            )}
            {source === "imported" && onUncollect && (
              <button
                type="button"
                onClick={() => onUncollect(skillDetail.slug, skillDetail.name)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/15"
              >
                <BookmarkMinus className="h-3.5 w-3.5" aria-hidden />
                {t("skillSquare.uncollectOk")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SkillDetailPanel;
