import { create } from 'zustand';
import type { MessageFileItem } from '../components/types/datamodel';

/** Tabs in the app right rail (运行概览 / 历史会话 / 文件空间 / 模板库) */
export type RightPanelLayoutTab = 'overview' | 'history' | 'files' | 'templates';

/** Tabs in the unified right sidebar. */
export type UnifiedRightTab = 'docmaster';

interface RightPanelState {
  /** Legacy single-panel state (kept for overviewSlot / layoutTab consumers in runview/manager/FilePreviewPage). */
  isOpen: boolean;
  overviewSlot: HTMLElement | null;
  /** Which top-level right panel tab is active (synced with RightPanel UI). */
  layoutTab: RightPanelLayoutTab;
  setIsOpen: (open: boolean) => void;
  setOverviewSlot: (el: HTMLElement | null) => void;
  setLayoutTab: (tab: RightPanelLayoutTab) => void;

  /** Unified right sidebar state. */
  isRightPanelOpen: boolean;
  rightPanelWidth: number;
  activeRightTab: UnifiedRightTab;
  /** File preview in the right panel (set by drsai:cloud:previewFile event). */
  previewFile: MessageFileItem | null;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (w: number) => void;
  setActiveRightTab: (tab: UnifiedRightTab) => void;
  setPreviewFile: (file: MessageFileItem | null) => void;
}

const RIGHT_PANEL_WIDTH_KEY = 'drsai:layout:rightPanelWidth';
const RIGHT_PANEL_WIDTH_VW = 0.20; // 20% of viewport width

const defaultRightPanelWidth = (): number => {
  if (typeof window === 'undefined') return 300;
  return Math.round(window.innerWidth * RIGHT_PANEL_WIDTH_VW);
};

const readWidth = (key: string): number => {
  if (typeof window === 'undefined') return defaultRightPanelWidth();
  const raw = window.localStorage.getItem(key);
  if (!raw) return defaultRightPanelWidth();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultRightPanelWidth();
  // If the saved value is the old fixed default (300) and the screen is wider
  // than 1800px, it's likely a stale value — use the vw-based default instead.
  if (n === 300 && window.innerWidth > 1800) {
    window.localStorage.removeItem(key);
    return defaultRightPanelWidth();
  }
  return n;
};

const writeWidth = (key: string, w: number) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, String(w));
};

export const useRightPanelStore = create<RightPanelState>((set) => ({
  isOpen: false,
  overviewSlot: null,
  layoutTab: 'overview',
  setIsOpen: (open) => set({ isOpen: open }),
  setOverviewSlot: (el) => set({ overviewSlot: el }),
  setLayoutTab: (tab) => set({ layoutTab: tab }),

  isRightPanelOpen: false,
  rightPanelWidth: readWidth(RIGHT_PANEL_WIDTH_KEY),
  activeRightTab: 'docmaster',
  previewFile: null,
  setRightPanelOpen: (open) => set({ isRightPanelOpen: open }),
  setRightPanelWidth: (w) => {
    writeWidth(RIGHT_PANEL_WIDTH_KEY, w);
    set({ rightPanelWidth: w });
  },
  setActiveRightTab: (tab) => set({ activeRightTab: tab }),
  setPreviewFile: (file) => set({ previewFile: file }),
}));
