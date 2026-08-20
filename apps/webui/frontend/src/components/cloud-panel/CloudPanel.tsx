import React, { useCallback } from 'react';
import { useRightPanelStore } from '../../store/rightPanel';
import WorkspaceFiles from './sections/WorkspaceFiles';

/**
 * 文件面板内容 — 仅渲染工作区文件树。
 * 连接状态 + 打开挂载卷按钮已迁移到外层 UnifiedRightPanel 的 tab 栏。
 */
const CloudPanel: React.FC = () => {
  // 保留 overviewSlot portal div（AgentPanel/BESIIIPanel 通过 portal 渲染到这里）
  const setOverviewSlot = useRightPanelStore((s) => s.setOverviewSlot);
  const overviewSlotRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOverviewSlot(el);
    },
    [setOverviewSlot]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2">
        <WorkspaceFiles />
      </div>
      {/* 隐藏的 overview portal 目标（供 runview.tsx 的 AgentPanel portal 使用） */}
      <div ref={overviewSlotRef} className="hidden" />
    </div>
  );
};

export default CloudPanel;
