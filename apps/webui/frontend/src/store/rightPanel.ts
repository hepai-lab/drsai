import { create } from 'zustand';

/** Tabs in the app right rail (运行概览 / 历史会话 / 文件空间 / 模板库) */
export type RightPanelLayoutTab = 'overview' | 'history' | 'files' | 'templates';

interface RightPanelState {
  isOpen: boolean;
  overviewSlot: HTMLElement | null;
  /** Which top-level right panel tab is active (synced with RightPanel UI). */
  layoutTab: RightPanelLayoutTab;
  setIsOpen: (open: boolean) => void;
  setOverviewSlot: (el: HTMLElement | null) => void;
  setLayoutTab: (tab: RightPanelLayoutTab) => void;
}

export const useRightPanelStore = create<RightPanelState>((set) => ({
  isOpen: false,
  overviewSlot: null,
  layoutTab: 'overview',
  setIsOpen: (open) => set({ isOpen: open }),
  setOverviewSlot: (el) => set({ overviewSlot: el }),
  setLayoutTab: (tab) => set({ layoutTab: tab }),
}));
