import React from "react";

export interface SkillListItemProps {
    slug: string;
    name: string;
    icon: string;
    version: string;
    description?: string;
    /** Image URL — shown instead of the skill icon when provided. */
    profile?: string;
    /** Extra badges rendered after the version pill (e.g. "已发布", "未公开"). */
    badges?: React.ReactNode;
    /** Bottom row (e.g. uploader badge + relative time). */
    meta?: React.ReactNode;
    onClick: (slug: string) => void;
    renderSkillIcon: (
        icon: string,
        containerClass: string,
        iconClass: string,
    ) => React.ReactNode;
}

const LI_CLS =
    "group cursor-pointer bg-primary transition-[background-color,box-shadow] duration-200 hover:bg-tertiary/5 dark:hover:bg-white/[0.03]";

const VERSION_PILL_CLS =
    "inline-flex shrink-0 items-center rounded-full border border-border-primary/60 bg-tertiary/25 px-2 py-0.5 font-agent-mono text-[10px] font-medium uppercase tracking-wide text-secondary dark:border-white/10 dark:bg-white/[0.05]";

const SkillListItem: React.FC<SkillListItemProps> = ({
    slug,
    name,
    icon,
    version,
    description,
    profile,
    badges,
    meta,
    onClick,
    renderSkillIcon,
}) => {
    return (
        <li key={slug} onClick={() => onClick(slug)} className={LI_CLS}>
            <div className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:py-4">
                {/* ── left: icon or profile image ── */}
                {profile ? (
                    <img
                        src={profile}
                        alt={name}
                        className="h-11 w-11 rounded-xl object-cover shrink-0 shadow-sm"
                    />
                ) : (
                    renderSkillIcon(icon, "h-11 w-11", "h-[22px] w-[22px]")
                )}

                {/* ── center ── */}
                <div className="min-w-0 flex-1">
                    {/* row 1: title + version pill + badges */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div
                            className="truncate text-[15px] font-medium leading-snug text-primary"
                            title={name}
                        >
                            {name}
                        </div>
                        <span className={VERSION_PILL_CLS}>v{version}</span>
                        {badges}
                    </div>

                    {/* row 2: description */}
                    {description ? (
                        <p className="mt-1.5 line-clamp-1 text-[13px] leading-relaxed text-secondary">
                            {description}
                        </p>
                    ) : null}

                    {/* row 3: meta (uploader, time, etc.) */}
                    {meta}
                </div>
            </div>
        </li>
    );
};

export default SkillListItem;
