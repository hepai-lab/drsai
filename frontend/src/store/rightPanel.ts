import { create } from 'zustand';

interface RightPanelState {
  isOpen: boolean;
  overviewSlot: HTMLElement | null;
  setIsOpen: (open: boolean) => void;
  setOverviewSlot: (el: HTMLElement | null) => void;
}

export const useRightPanelStore = create<RightPanelState>((set) => ({
  isOpen: false,
  overviewSlot: null,
  setIsOpen: (open) => set({ isOpen: open }),
  setOverviewSlot: (el) => set({ overviewSlot: el }),
}));
