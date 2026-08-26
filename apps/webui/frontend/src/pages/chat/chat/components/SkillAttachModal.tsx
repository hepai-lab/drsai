import * as React from "react";
import { Checkbox, Input, Modal, Spin } from "antd";
import type { HepaiSkillPickRow } from "../types";
import { SKILL_INSTALL_DEFAULT_LINE } from "../types";

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
  return (
    <Modal
      title="选择技能"
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText="添加"
      cancelText="取消"
      destroyOnClose
      width={560}
      okButtonProps={{ disabled: loading }}
    >
      <p
        className={`mb-3 text-xs ${
          darkMode === "dark" ? "text-gray-400" : "text-secondary"
        }`}
      >
        发送时会自动附带「{SKILL_INSTALL_DEFAULT_LINE}」与所选 ZIP 的下载链接。
      </p>
      <div className="mb-3 flex items-center gap-2">
        <Input
          allowClear
          placeholder="按文件名筛选"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => onTagFilter("lhaaso")}
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
            tagFilter === "lhaaso"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-300"
              : `border ${
                  darkMode === "dark"
                    ? "border-gray-600 text-gray-400 hover:bg-amber-500/15 hover:text-amber-300"
                    : "border-gray-300 text-gray-600 hover:bg-amber-50 hover:text-amber-700"
                }`
          }`}
        >
          LHAASO
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spin />
        </div>
      ) : filteredRows.length === 0 ? (
        <div
          className={`rounded-lg border border-dashed py-10 text-center text-sm ${
            darkMode === "dark"
              ? "border-gray-600 text-gray-400"
              : "border-gray-200 text-gray-500"
          }`}
        >
          {rows.length === 0 ? "暂无技能包，请先到技能广场上传 ZIP" : "无匹配项"}
        </div>
      ) : (
        <ul
          className={`max-h-[min(60vh,22rem)] space-y-1 overflow-auto rounded-lg border p-2 ${
            darkMode === "dark" ? "border-gray-600" : "border-gray-200"
          }`}
        >
          {filteredRows.map((r) => (
            <li key={r.id}>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 ${
                  darkMode === "dark" ? "hover:bg-white/5" : "hover:bg-violet-50/80"
                }`}
              >
                <Checkbox
                  checked={selectedIds.has(r.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onSelectedIdsChange((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    });
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      darkMode === "dark" ? "text-gray-100" : "text-gray-800"
                    }`}
                  >
                    {r.filename}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-xs ${
                      darkMode === "dark" ? "text-gray-500" : "text-gray-500"
                    }`}
                    title={r.url}
                  >
                    {r.url}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

export default SkillAttachModal;
