import * as React from "react";
import { Checkbox, Input, Modal, Spin } from "antd";
import {
  PackageIcon,
  GlobeIcon,
  CheckCircleIcon,
  SearchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import type { HepaiSkillPickRow } from "../types";

const SOURCE_LABELS: Record<string, string> = {
  public: "公共",
  higraf: "Higraf",
  user: "私有",
  catalog: "内置",
};

const SOURCE_BADGE_CLASSES: Record<string, string> = {
  public:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  higraf:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  user: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  catalog:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
};

interface SkillAttachModalProps {
  open: boolean;
  darkMode: string;
  loading: boolean;
  search: string;
  tagFilter: string | null;
  rows: HepaiSkillPickRow[];
  filteredRows: HepaiSkillPickRow[];
  selectedIds: Set<string>;
  onSearchChange: (value: string) => void;
  onTagFilter: (tag: string) => void;
  onSelectedIdsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCancel: () => void;
  onConfirm: () => void;
}

const SkillAttachModal: React.FC<SkillAttachModalProps> = ({
  open,
  darkMode,
  loading,
  search,
  tagFilter,
  rows,
  filteredRows,
  selectedIds,
  onSearchChange,
  onTagFilter,
  onSelectedIdsChange,
  onCancel,
  onConfirm,
}) => {
  const selectedCount = selectedIds.size;
  const isDark = darkMode === "dark";

  const [searchExpanded, setSearchExpanded] = React.useState(false);
  const searchInputRef = React.useRef<HTMLDivElement>(null);

  // 每次 modal 打开时重置搜索状态
  React.useEffect(() => {
    if (open) {
      setSearchExpanded(false);
    }
  }, [open]);

  // 展开时自动聚焦
  React.useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      const input = searchInputRef.current.querySelector("input");
      input?.focus();
    }
  }, [searchExpanded]);

  // 失焦且无内容时收起
  const handleSearchBlur = () => {
    if (!search.trim()) {
      setSearchExpanded(false);
    }
  };

  const handleCloseSearch = () => {
    onSearchChange("");
    setSearchExpanded(false);
  };

  const tabBase =
    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200";

  return (
    <Modal
      title={
        <span className="text-sm font-semibold">
          选择技能
          {selectedCount > 0 && (
            <span
              className={`ml-2 inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium ${
                isDark
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-violet-100 text-violet-700"
              }`}
            >
              <CheckCircleIcon className="mr-0.5 h-2.5 w-2.5" />
              {selectedCount}
            </span>
          )}
        </span>
      }
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={selectedCount > 0 ? `添加 ${selectedCount} 个` : "添加"}
      cancelText="取消"
      destroyOnClose
      width={520}
      okButtonProps={{ disabled: loading || selectedCount === 0 }}
      classNames={{
        body: "!px-4 !pb-3 !pt-2",
        header: "!px-4 !pt-3.5 !pb-1",
        footer: "!px-4 !pb-3",
      }}
    >
      {/* 来源切换 + 搜索入口 */}
      <div className="mb-2 flex items-center gap-2">
        <div
          className={`inline-flex rounded-md p-0.5 ${
            isDark ? "bg-gray-800/60" : "bg-gray-100"
          }`}
        >
          <button
            type="button"
            onClick={() => onTagFilter("")}
            className={`${tabBase} ${
              !tagFilter
                ? isDark
                  ? "bg-white/15 text-gray-100 shadow-sm"
                  : "bg-white text-gray-800 shadow-sm"
                : isDark
                  ? "text-gray-400 hover:text-gray-200"
                  : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <GlobeIcon className="h-3 w-3" />
            全部
          </button>
          <button
            type="button"
            onClick={() => onTagFilter("lhaaso")}
            className={`${tabBase} ${
              tagFilter === "lhaaso"
                ? isDark
                  ? "bg-amber-500/20 text-amber-300 shadow-sm"
                  : "bg-amber-100 text-amber-800 shadow-sm"
                : isDark
                  ? "text-gray-400 hover:text-amber-300"
                  : "text-gray-500 hover:text-amber-700"
            }`}
          >
            <ZapIcon className="h-3 w-3" />
            LHAASO
          </button>
        </div>

        {/* 搜索图标 / 展开搜索框 */}
        <div className="ml-auto">
          {searchExpanded ? (
            <div ref={searchInputRef} className="flex items-center gap-1">
              <Input
                allowClear
                placeholder="搜索技能..."
                size="small"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={handleSearchBlur}
                className={`w-40 ${
                  isDark
                    ? "!border-gray-600 !bg-gray-800/60"
                    : "!border-gray-200 !bg-gray-50"
                }`}
                style={{ borderRadius: "8px" }}
              />
              <button
                type="button"
                onClick={handleCloseSearch}
                className={`rounded p-1 transition-colors ${
                  isDark
                    ? "text-gray-400 hover:text-gray-200 hover:bg-white/10"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                }`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchExpanded(true)}
              className={`rounded p-1.5 transition-colors ${
                search
                  ? isDark
                    ? "text-violet-400 bg-violet-500/15"
                    : "text-violet-600 bg-violet-100"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 hover:bg-white/10"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
              title="搜索技能"
            >
              <SearchIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12">
          <Spin size="small" />
          <span className="text-xs text-gray-400">加载中...</span>
        </div>
      ) : filteredRows.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 ${
            isDark
              ? "border-gray-700 bg-gray-800/30"
              : "border-gray-200 bg-gray-50/50"
          }`}
        >
          <PackageIcon
            className={`h-5 w-5 ${
              isDark ? "text-gray-500" : "text-gray-400"
            }`}
          />
          <p className="text-xs text-gray-400">
            {rows.length === 0 ? "暂无可用技能" : "无匹配项"}
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {/* 列表头 */}
          <div
            className={`flex items-center justify-between px-2 py-1 text-[11px] ${
              isDark ? "text-gray-500" : "text-gray-400"
            }`}
          >
            <span>
              {search
                ? `搜索结果 — ${filteredRows.length} 个`
                : `共 ${filteredRows.length} 个技能`}
            </span>
            <span
              className="cursor-pointer hover:underline"
              onClick={() => {
                if (selectedIds.size === filteredRows.length) {
                  onSelectedIdsChange(new Set());
                } else {
                  onSelectedIdsChange(new Set(filteredRows.map((r) => r.id)));
                }
              }}
            >
              {selectedIds.size === filteredRows.length &&
              filteredRows.length > 0
                ? "取消全选"
                : "全选"}
            </span>
          </div>

          {/* 技能列表 */}
          <ul
            className={`max-h-[min(50vh,20rem)] space-y-0.5 overflow-auto rounded-lg ${
              isDark ? "bg-gray-800/30" : "bg-gray-50/50"
            } p-1`}
          >
            {filteredRows.map((r) => {
              const isSelected = selectedIds.has(r.id);
              const badgeClasses =
                SOURCE_BADGE_CLASSES[r.source] || SOURCE_BADGE_CLASSES.public;

              return (
                <li key={r.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${
                      isSelected
                        ? isDark
                          ? "border-violet-500/30 bg-violet-500/10"
                          : "border-violet-200 bg-violet-50/70"
                        : isDark
                          ? "border-transparent hover:bg-white/5"
                          : "border-transparent hover:bg-white"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onSelectedIdsChange((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        });
                      }}
                      className="shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span
                        className={`truncate text-[13px] font-medium ${
                          isSelected
                            ? isDark
                              ? "text-violet-200"
                              : "text-violet-800"
                            : isDark
                              ? "text-gray-200"
                              : "text-gray-700"
                        }`}
                      >
                        {r.filename}
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${badgeClasses}`}
                      >
                        {SOURCE_LABELS[r.source] || r.source}
                      </span>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
};

export default SkillAttachModal;