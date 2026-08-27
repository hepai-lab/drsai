import React from "react";
import { useLang } from "../i18n/useLang";

export interface SkillListItemProps {
    slug: string;
    name: string;
    icon: string;
    version: string;
    description?: string;
    profile?: string;
    owner?: string;
    tags?: string[];
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
    ops: "运维",
    other: "其他",
};

function isEmojiIcon(icon: string | undefined): boolean {
    if (!icon) return false;
    if (/^https?:\/\//.test(icon) || icon === "__profile__") return false;
    return /[^\x00-\x7F]/.test(icon) && icon.length <= 8;
}

function formatTags(raw: string[] | undefined, isZh: boolean): string {
    if (!raw || raw.length === 0) return "";
    const first = raw[0];
    if (!first) return "";
    if (isZh) return CATEGORY_ZH[first] || first;
    return first;
}

const CARD_CLS =
    "group flex h-full w-full cursor-pointer flex-col rounded-2xl border border-border-primary/35 bg-primary p-5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/25 hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)] dark:border-white/[0.08] dark:shadow-none dark:hover:border-accent/30 dark:hover:shadow-[0_12px_32px_rgba(0,0,0,0.35)]";

const SkillListItem: React.FC<SkillListItemProps> = ({
    slug,
    name,
    icon,
    version,
    description,
    profile,
    owner,
    tags,
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
    const avatarChar = ownerLabel ? ownerLabel.charAt(0) : "?";
    const tagLabel = formatTags(tags, isZh);

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
            <div className="flex items-start gap-3">
                {profile ? (
                    <img
                        src={profile}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-10 w-10 shrink-0 rounded-xl object-cover"
                    />
                ) : isEmojiIcon(icon) ? (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg leading-none dark:bg-accent/16">
                        {icon}
                    </div>
                ) : (
                    renderSkillIcon(icon, "h-10 w-10 rounded-xl", "h-5 w-5")
                )}
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-semibold leading-snug text-primary" title={name}>
                        {name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {isPreset ? (
                            <span className="inline-flex items-center rounded-md bg-tertiary/80 px-1.5 py-0.5 text-[10px] font-medium text-secondary dark:bg-white/[0.08]">
                                {t("skillSquare.presetBadge")}
                            </span>
                        ) : null}
                        {version && version !== "0.0.0" ? (
                            <span className="inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                {version.startsWith("v") ? version : `v${version}`}
                            </span>
                        ) : null}
                        {badges}
                    </div>
                </div>
            </div>

            <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-[13px] leading-relaxed text-secondary">
                {description?.trim() || t("skillSquare.noPreviewContent")}
            </p>

            {tagLabel ? (
                <span className="mt-3 inline-flex w-fit max-w-full truncate rounded-md bg-tertiary/70 px-2 py-0.5 text-[11px] text-secondary dark:bg-white/[0.07]">
                    {tagLabel}
                </span>
            ) : (
                <span className="mt-3 h-[22px]" />
            )}

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-primary/20 pt-3 dark:border-white/[0.06]">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                        {avatarChar}
                    </span>
                    <span className="truncate text-xs text-secondary" title={ownerLabel}>
                        {ownerLabel || "—"}
                    </span>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-secondary/80">
                    {t("skillSquare.callCount", downloads)}
                </span>
            </div>
        </article>
    );
};

export default SkillListItem;
