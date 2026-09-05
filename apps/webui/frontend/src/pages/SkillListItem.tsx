import React from "react";
import { Download, GitBranch, Heart } from "lucide-react";
import { useLang } from "../i18n/useLang";
import { resolveSkillAssetUrl } from "./skills-square/utils";

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
    collects?: number;
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
    "group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200/60 bg-gradient-to-b from-white via-white to-gray-50/30 p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04),0_0_0_1px_rgba(15,23,42,0.02)] transition-all duration-300 hover:-translate-y-1 hover:border-accent/25 hover:shadow-[0_12px_32px_rgba(139,92,246,0.12),0_4px_8px_rgba(139,92,246,0.06)] dark:border-white/[0.07] dark:bg-gradient-to-b dark:from-white/[0.04] dark:via-white/[0.03] dark:to-white/[0.01] dark:shadow-none dark:hover:border-accent/20 dark:hover:shadow-[0_12px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(139,92,246,0.08)]";

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
    collects = 0,
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
    const profileSrc = resolveSkillAssetUrl(profile);

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
            {/* Subtle top accent bar — only visible on hover */}
            <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-xl bg-gradient-to-r from-accent/0 via-accent/40 to-accent/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            {/* Icon + name */}
            <div className="relative flex items-center gap-2.5">
                <div className="relative shrink-0">
                    {profileSrc ? (
                        <img
                            src={profileSrc}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-9 w-9 rounded-xl object-cover shadow-sm ring-1 ring-border-primary/20 transition-shadow duration-300 group-hover:shadow-md group-hover:ring-accent/30"
                        />
                    ) : isEmojiIcon(icon) ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-accent/5 text-base leading-none shadow-sm transition-shadow duration-300 group-hover:shadow-md dark:from-accent/20 dark:to-accent/5">
                            {icon}
                        </div>
                    ) : (
                        renderSkillIcon(icon, "h-9 w-9 rounded-xl transition-shadow duration-300 group-hover:shadow-md", "h-4.5 w-4.5")
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13px] font-semibold leading-tight text-primary transition-colors duration-300 group-hover:text-accent" title={name}>
                        {name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {isPreset ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-medium text-amber-700 ring-1 ring-amber-200/50 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20">
                                {t("skillSquare.presetBadge")}
                            </span>
                        ) : null}
                        {version && version !== "0.0.0" ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-medium text-emerald-700 ring-1 ring-emerald-200/50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20">
                                <GitBranch className="h-2.5 w-2.5" />
                                {version.startsWith("v") ? version : `v${version}`}
                            </span>
                        ) : null}
                        {badges}
                    </div>
                </div>
            </div>

            {/* Description */}
            <p className="relative mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-secondary min-h-[2rem]">
                {description?.trim() || t("skillSquare.noPreviewContent")}
            </p>

            {/* Subtle divider */}
            <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-gray-200/60 to-transparent dark:via-white/[0.06]" />

            {/* Footer */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                    {avatarChar ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-accent/10 text-[9px] font-bold text-accent ring-1 ring-accent/20 dark:from-accent/30 dark:to-accent/15">
                            {avatarChar}
                        </span>
                    ) : null}
                    {categoryLabel ? (
                        <span className="truncate rounded-full border border-gray-200/50 bg-gray-50/50 px-2 py-px text-[10px] text-secondary/70 dark:border-white/[0.06] dark:bg-white/[0.04]">
                            {categoryLabel}
                        </span>
                    ) : null}
                </div>
                <span className="shrink-0 inline-flex items-center gap-3 text-[10px] tabular-nums text-secondary/50">
                    <span className="inline-flex items-center gap-1">
                        <Download className="h-2.5 w-2.5" />
                        {downloads}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Heart className="h-2.5 w-2.5" />
                        {collects}
                    </span>
                </span>
            </div>
        </article>
    );
};

export default SkillListItem;