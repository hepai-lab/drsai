import React from "react";
import { Download, GitBranch } from "lucide-react";
import { useLang } from "../i18n/useLang";

export interface SkillListItemProps {
    slug: string;
    name: string;
    icon: string;
    version: string;
    description?: string;
    profile?: string;
    owner?: string;
    category?: string;
    downloads?: number;
    source?: string;
    preset?: boolean;
    badges?: React.ReactNode;
    onClick: (slug: string) => void;
    renderSkillIcon: (
        icon: string,
        containerClass: string,
        iconClass: string,
    ) => React.ReactNode;
}

const CATEGORY_ZH: Record<string, string> = {
    "paper-research": "论文科研",
    "doc-process": "文档处理",
    "detector-monitor": "探测器监控",
    "data-analysis": "数据分析",
    "viz-doc": "可视化文档",
    "celestial-search": "天体检索",
    "ops": "运维",
    "other": "其他",
};

function isEmojiIcon(icon: string | undefined): boolean {
    if (!icon) return false;
    if (/^https?:\/\//.test(icon) || icon === "__profile__") return false;
    return /[^\x00-\x7F]/.test(icon) && icon.length <= 8;
}

function formatCategory(raw: string | undefined, isZh: boolean): string {
    const first = (raw || "").split(",")[0]?.trim() || "";
    if (!first) return "";
    if (isZh) return CATEGORY_ZH[first] || first;
    return first;
}

const CARD_CLS =
    "group flex h-full w-full cursor-pointer flex-col rounded-xl border border-gray-200/80 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_8px_24px_rgba(139,92,246,0.10)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-none dark:hover:border-accent/25 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]";

const SkillListItem: React.FC<SkillListItemProps> = ({
    slug,
    name,
    icon,
    version,
    description,
    profile,
    owner,
    category,
    downloads = 0,
    source,
    preset,
    badges,
    onClick,
    renderSkillIcon,
}) => {
    const { t, lang } = useLang();
    const isZh = lang === "zh";
    const isPreset = Boolean(preset || source === "higraf" || owner === "系统预置");
    const ownerLabel = (owner || "").trim() || (isPreset ? t("skillSquare.systemOwner") : "");
    const avatarChar = ownerLabel ? ownerLabel.charAt(0) : "";
    const categoryLabel = formatCategory(category, isZh);

    return (
        <article
            role="button"
            tabIndex={0}
            onClick={() => onClick(slug)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick(slug);
                }
            }}
            className={CARD_CLS}
        >
            {/* Icon + name */}
            <div className="flex items-center gap-2.5">
                {profile ? (
                    <img
                        src={profile}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-border-primary/20"
                    />
                ) : isEmojiIcon(icon) ? (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-base leading-none dark:bg-accent/16">
                        {icon}
                    </div>
                ) : (
                    renderSkillIcon(icon, "h-8 w-8 rounded-lg", "h-4 w-4")
                )}
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13px] font-semibold leading-tight text-primary" title={name}>
                        {name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {isPreset ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                {t("skillSquare.presetBadge")}
                            </span>
                        ) : null}
                        {version && version !== "0.0.0" ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                <GitBranch className="h-2.5 w-2.5" />
                                {version.startsWith("v") ? version : `v${version}`}
                            </span>
                        ) : null}
                        {badges}
                    </div>
                </div>
            </div>

            {/* Description */}
            <p className="mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-secondary min-h-[2rem]">
                {description?.trim() || t("skillSquare.noPreviewContent")}
            </p>

            {/* Footer */}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                    {avatarChar ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[9px] font-bold text-accent dark:bg-accent/25">
                            {avatarChar}
                        </span>
                    ) : null}
                    {categoryLabel ? (
                        <span className="truncate rounded-full bg-tertiary/60 px-2 py-px text-[10px] text-secondary/70 dark:bg-white/[0.06]">
                            {categoryLabel}
                        </span>
                    ) : null}
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] tabular-nums text-secondary/60">
                    <Download className="h-2.5 w-2.5" />
                    {downloads}
                </span>
            </div>
        </article>
    );
};

export default SkillListItem;