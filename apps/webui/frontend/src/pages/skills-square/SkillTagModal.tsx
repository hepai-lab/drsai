import { Button as AntdButton, Input, Modal, Popconfirm, Spin } from "antd";
import { Pencil, Plus, Tag, X } from "lucide-react";
import React from "react";
import type { SkillTagItem } from "../../components/views/api";

interface SkillTagModalProps {
  open: boolean;
  loading: boolean;
  tags: SkillTagItem[];
  editingTag: SkillTagItem | null;
  editTagName: string;
  editTagOrder: number;
  onClose: () => void;
  onEditTagNameChange: (value: string) => void;
  onEditTagOrderChange: (value: number) => void;
  onSave: () => void;
  onStartEdit: (tag: SkillTagItem | null) => void;
  onDelete: (tagId: number) => void;
}

const SkillTagModal: React.FC<SkillTagModalProps> = ({
  open,
  loading,
  tags,
  editingTag,
  editTagName,
  editTagOrder,
  onClose,
  onEditTagNameChange,
  onEditTagOrderChange,
  onSave,
  onStartEdit,
  onDelete,
}) => (
  <Modal
    title={
      <span className="flex items-center gap-2">
        <Tag className="h-4 w-4" />
        管理标签
      </span>
    }
    open={open}
    onCancel={onClose}
    footer={null}
    destroyOnClose
    width={520}
  >
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="标签名称"
          value={editTagName}
          onChange={(e) => onEditTagNameChange(e.target.value)}
          style={{ width: 180 }}
          onPressEnter={() => void onSave()}
        />
        <Input
          type="number"
          placeholder="排序"
          value={editTagOrder}
          onChange={(e) => onEditTagOrderChange(Number(e.target.value) || 0)}
          style={{ width: 80 }}
        />
        <AntdButton
          type="primary"
          onClick={() => void onSave()}
          icon={
            editingTag ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )
          }
        >
          {editingTag ? "更新" : "添加"}
        </AntdButton>
        {editingTag && (
          <AntdButton onClick={() => onStartEdit(null)}>取消</AntdButton>
        )}
      </div>

      <div className="max-h-80 overflow-auto space-y-1">
        {loading ? (
          <div className="text-center py-4">
            <Spin />
          </div>
        ) : tags.length === 0 ? (
          <p className="text-sm text-secondary text-center py-4">
            暂无标签，请添加
          </p>
        ) : (
          tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border-primary/20 px-3 py-2 dark:border-white/10"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Tag className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="text-sm font-medium truncate">{tag.name}</span>
                <span className="text-[11px] text-secondary/60 shrink-0">
                  排序:{tag.sort_order}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <AntdButton
                  size="small"
                  type="text"
                  onClick={() => onStartEdit(tag)}
                  icon={<Pencil className="h-3 w-3" />}
                />
                <Popconfirm
                  title="确认删除此标签？"
                  onConfirm={() => void onDelete(tag.id)}
                  okText="删除"
                  cancelText="取消"
                >
                  <AntdButton
                    size="small"
                    type="text"
                    danger
                    icon={<X className="h-3 w-3" />}
                  />
                </Popconfirm>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </Modal>
);

export default SkillTagModal;
