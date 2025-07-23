import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface IModeConfig {
    mode: string;
    setMode: (mode: string) => void;
    config: Record<string, any>;
    setConfig: (config: Record<string, any>) => void;
}

export const useModeConfigStore = create<IModeConfig>()(
    persist(
        (set) => ({
            // Existing state
            mode: "",
            setMode: (mode) => set({ mode }),
            config: {},
            setConfig: (config) => set({ config }),
        }),
        {
            name: "app-sidebar-state",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                mode: state.mode,
                config: state.config,
            }),
        }
    )
);