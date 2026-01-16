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
    lastSelectedAgentMode: string;
    setLastSelectedAgentMode: (mode: string) => void;


    // update by yqsun
    agentId: string | null;
    setAgentId: (agentId: string | null) => void;
    agentInfo: Partial<Agent> | null;
    setAgentInfo: (agentInfo: Partial<Agent> | null) => void;
}

// 默认的 agentId，用于首次登录时设置
const DEFAULT_AGENT_ID = "010022126sdfnjsdnqw";

export const useModeConfigStore = create<IModeConfig>()(
    persist(
        (set) => ({
            mode: "",
            setMode: (mode) => set({ mode }),
            config: {},
            setConfig: (config) => set({ config }),
            selectedAgent: null,
            setSelectedAgent: (selectedAgent) => set({ selectedAgent }),
            lastSelectedAgentMode: "",
            setLastSelectedAgentMode: (mode) =>
                set({ lastSelectedAgentMode: mode }),

            // update by yqsun
            agentId: null,
            setAgentId: (agentId) => set({ agentId }),
            agentInfo: null,
            setAgentInfo: (agentInfo) => set({ agentInfo }),
        }),
        {
            name: "drsai-mode-config",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                agentId: state.agentId,
            }),
            onRehydrateStorage: () => (state) => {
                // 检查是否是第一次登录（localStorage 中没有 agentId）
                if (state && !state.agentId) {
                    // 设置默认的 agentId
                    state.setAgentId(DEFAULT_AGENT_ID);
                    console.log(`首次登录，设置默认 agentId: ${DEFAULT_AGENT_ID}`);
                }
            },
        }
    )
);
