import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent } from "@/types/common";
import { agentAPI, agentWorkerAPI } from "@/components/views/api";
import { getLocalStorage } from "@/components/utils";
import { getFirstRecentAgentId } from "@/utils/recentAgentsStorage";
import { pickLoginDefaultAgent } from "@/utils/agentPreference";

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
            // 注意：recentAgents 仅用于 UI 展示，不应覆盖“默认智能体”选择。
            // 否则一旦 recent[0] 恰好是历史遗留的 builtin（如 eab8...），会把用户显式默认顶掉。
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const { agentId } = useModeConfigStore.getState();
                if (agentId) return;

                const userId = getLocalStorage("user_email", false) as
                    | string
                    | null;
                if (!userId) return;

                void Promise.all([
                    agentWorkerAPI.getUserDefaultAgents(userId).then((r: any) => r?.data || []),
                    agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
                ])
                    .then(([agents, userDefault]) => {
                        // Only treat explicitly stored default as personal preference.
                        const userDefaultId = userDefault?.stored_default_agent_id ?? null;
                        const preferred = pickLoginDefaultAgent(
                            agents || [],
                            null,
                            userDefaultId,
                        );
                        const id = preferred?.id;
                        if (!id || typeof id !== "string") return;
                        const { agentId: cur, setAgentId: setId } =
                            useModeConfigStore.getState();
                        if (!cur) {
                            setId(id);
                        }
                    })
                    .catch((err) => {
                        console.warn(
                            "获取 agent 列表失败，无法设置默认 agentId:",
                            err
                        );
                    });
            },
        }
    )
);
