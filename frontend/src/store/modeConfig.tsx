import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent } from "@/types/common";

interface IModeConfig {
    mode: string;
    setMode: (mode: string) => void;
    config: Record<string, any>;
    setConfig: (config: Record<string, any>) => void;
    selectedAgent: Partial<Agent> | null;
    setSelectedAgent: (agent: Partial<Agent> | null) => void;
    agent_mode_config: Partial<Agent> | null;
}

export const useModeConfigStore = create<IModeConfig>()(
    persist(
        (set) => ({
            // Existing state
            mode: "",
            setMode: (mode) => set({ mode }),
            config: {},
            setConfig: (config) => set({ config }),
            selectedAgent: null,
            setSelectedAgent: (selectedAgent) => set({ selectedAgent }),
            agent_mode_config: null,
            setAgentModeConfig: (agent_mode_config: Partial<Agent> | null) => set({ agent_mode_config }),
        }),
        {
            name: "drsai-mode-config",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                mode: state.mode,
                config: state.config,
                selectedAgent: state.selectedAgent,
            }),
        }
    )
);
