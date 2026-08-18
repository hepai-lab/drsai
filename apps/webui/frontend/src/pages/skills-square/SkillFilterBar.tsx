import { Select } from "antd";
import { ArrowUpDown, Search } from "lucide-react";
import React from "react";
import { SEARCH_INPUT_CLS } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: any, ...args: any[]) => string;

interface SkillFilterBarProps {
  activeCategory: string;
  availableCategories: string[];
  search: string;
  searchExpanded: boolean;
  sortBy: "name" | "time";
  sortOpen: boolean;
  isZh: boolean;
  t: TFn;
  sortRef: React.RefObject<HTMLDivElement | null>;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSearchExpandedChange: (open: boolean) => void;
  onSortOpenChange: (open: boolean | ((v: boolean) => boolean)) => void;
  onSortByChange: (value: "name" | "time") => void;
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
  onCategoryChange,
  onSearchChange,
  onSearchExpandedChange,
  onSortOpenChange,
  onSortByChange,
}) => (
  <div className="shrink-0 flex items-center gap-3 pb-4 pr-4">
    <Select
      value={activeCategory || "全部"}
      onChange={(v) => onCategoryChange(v === "全部" ? "" : v)}
      className="w-40 shrink-0 [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-tertiary/10 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
      options={[
        { value: "全部", label: t("skillSquare.allCategories") || "全部" },
        ...availableCategories.map((c) => ({ value: c, label: c })),
      ]}
    />
    <div className="flex items-center gap-2 ml-auto shrink-0">
      {searchExpanded ? (
        <div className="relative max-w-[180px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
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
          className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
          title={t("skillSquare.searchPlaceholder")}
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      )}
      <div className="relative" ref={sortRef}>
        <button
          type="button"
          onClick={() => onSortOpenChange((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
          title={
            sortBy === "time"
              ? isZh
                ? "按时间排序"
                : "Sort by time"
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
);

export default SkillFilterBar;
