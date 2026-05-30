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
    /** true when showing session snapshot: agent id no longer in UserAgents catalog */
    agentOfflineSnapshot: boolean;
    setAgentOfflineSnapshot: (v: boolean) => void;
}

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
            agentOfflineSnapshot: false,
            setAgentOfflineSnapshot: (agentOfflineSnapshot) =>
                set({ agentOfflineSnapshot }),
        }),
        {
            name: "drsai-mode-config",
            storage: createJSONStorage(() => localStorage),
            // 刷新后恢复上次选中：持久化 agentId；mode 在 id 失效时作为备选匹配
            partialize: (state) => ({
                agentId: state.agentId,
                mode: state.mode,
            }),
            // 首屏 catalog / 默认智能体由 useAgentManager.fetchAgentList 统一拉取，避免并行 list 抢 is_refresh。
        }
    )
);
