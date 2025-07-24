import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Agent {
    mode: string;
    name: string;
    type?:
    | "custom"
    | "drsai-besiii"
    | "drsai-agent"
    | "magentic-one"
    | "remote";
    description?: string;
    icon?: React.ReactNode;
    tags?: string[];
    config?: any;
}

interface IModeConfig {
    mode: string;
    setMode: (mode: string) => void;
    config: Record<string, any>;
    setConfig: (config: Record<string, any>) => void;
    selectedAgent: Agent | null;
    setSelectedAgent: (agent: Agent | null) => void;
    lastSelectedAgentMode: string;
    setLastSelectedAgentMode: (mode: string) => void;
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
            setSelectedAgent: (agent) => set({ selectedAgent: agent }),
            lastSelectedAgentMode: "",
            setLastSelectedAgentMode: (mode) =>
                set({ lastSelectedAgentMode: mode }),
        }),
        {
            name: "drsai-mode-config",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                mode: state.mode,
                config: state.config,
                selectedAgent: state.selectedAgent,
                lastSelectedAgentMode: state.lastSelectedAgentMode,
            }),
        }
    )
);
