import { ArrowUpDown, Search, Tag } from "lucide-react";
import React, { useRef } from "react";
import { SEARCH_INPUT_CLS } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: any, ...args: any[]) => string;

interface SkillFilterBarProps {
  activeCategory: string;
  availableCategories: string[];
  search: string;
  searchExpanded: boolean;
  sortBy: "name" | "time" | "downloads" | "collects";
  sortOpen: boolean;
  isZh: boolean;
  t: TFn;
  sortRef: React.RefObject<HTMLDivElement | null>;
  isPlatformAdmin?: boolean;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSearchExpandedChange: (open: boolean) => void;
  onSortOpenChange: (open: boolean | ((v: boolean) => boolean)) => void;
  onSortByChange: (value: "name" | "time" | "downloads" | "collects") => void;
  onManageTags?: () => void;
}

const SkillFilterBar: React.FC<SkillFilterBarProps> = ({
  activeCategory,
  availableCategories,
  search,
  searchExpanded,
  sortBy,
  sortOpen,
  isZh,
  t,
  sortRef,
  isPlatformAdmin,
  onCategoryChange,
  onSearchChange,
  onSearchExpandedChange,
  onSortOpenChange,
  onSortByChange,
  onManageTags,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

  const tagChip = (categoryKey: string, label: string) => {
    const active = categoryKey === activeCategory;
    return (
      <button
        key={categoryKey || "__all__"}
        type="button"
        onClick={() => {
          onCategoryChange(categoryKey);
          rowRef.current?.querySelectorAll("button").forEach((btn) => btn.blur());
        }}
        className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap select-none border ${
          active
            ? "bg-purple-50 text-purple-600 !border-purple-400 focus:!border-purple-400 focus-visible:!border-purple-400 dark:bg-purple-500/15 dark:text-purple-300 dark:!border-purple-400/60 dark:focus:!border-purple-400/60 dark:focus-visible:!border-purple-400/60"
            : "bg-white text-gray-500 border-gray-200/60 hover:text-gray-700 hover:bg-gray-50 focus-visible:!border-gray-200/60 dark:bg-white/[0.03] dark:text-gray-400 dark:border-white/[0.08] dark:hover:text-gray-200 dark:hover:bg-white/[0.06] dark:focus-visible:!border-white/[0.08]"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="shrink-0 pb-2 pr-4">
      <div className="flex items-center gap-2">
        {/* Category tabs - scrollable */}
        <div
          ref={rowRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none"
        >
          {tagChip("", t("skillSquare.allCategories") || "全部")}
          {availableCategories.map((cat) => tagChip(cat, cat))}
        </div>

        {/* Right controls: admin + search + sort */}
        <div className="flex shrink-0 items-center gap-1">
          {isPlatformAdmin && (
            <button
              type="button"
              onClick={onManageTags}
              className="shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-secondary hover:text-accent hover:bg-accent/5 transition-colors dark:hover:bg-white/[0.04]"
            >
              <Tag className="h-3 w-3" />
              {isZh ? "管理标签" : "Manage tags"}
            </button>
          )}
          {searchExpanded ? (
            <div className="relative max-w-[160px]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
                aria-hidden
              />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={() => {
                  if (!search.trim()) onSearchExpandedChange(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onSearchChange("");
                    onSearchExpandedChange(false);
                  }
                }}
                placeholder={t("skillSquare.searchPlaceholder")}
                className={SEARCH_INPUT_CLS}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onSearchExpandedChange(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
              title={t("skillSquare.searchPlaceholder")}
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          )}
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => onSortOpenChange((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
              title={
                sortBy === "time"
                  ? isZh
                    ? "按时间排序"
                    : "Sort by time"
                  : sortBy === "downloads"
                    ? isZh
                      ? "按下载量排序"
                      : "Sort by downloads"
                    : sortBy === "collects"
                      ? isZh
                        ? "按收藏量排序"
                        : "Sort by collections"
                      : isZh
                        ? "按名称排序"
                        : "Sort by name"
              }
            >
              <ArrowUpDown className="h-4 w-4" aria-hidden />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-primary/10 bg-white py-1 shadow-lg dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    onSortByChange("time");
                    onSortOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "time" ? "text-accent font-semibold" : "text-secondary"}`}
                >
                  {isZh ? "按时间" : "By time"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSortByChange("downloads");
                    onSortOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "downloads" ? "text-accent font-semibold" : "text-secondary"}`}
                >
                  {isZh ? "按下载量" : "By downloads"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSortByChange("collects");
                    onSortOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "collects" ? "text-accent font-semibold" : "text-secondary"}`}
                >
                  {isZh ? "按收藏量" : "By collections"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSortByChange("name");
                    onSortOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "name" ? "text-accent font-semibold" : "text-secondary"}`}
                >
                  {isZh ? "按名称" : "By name"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SkillFilterBar;