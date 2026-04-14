import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent } from "@/types/common";
import { agentAPI, organizationsAPI } from "@/components/views/api";
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
        }),
        {
            name: "drsai-mode-config",
            storage: createJSONStorage(() => localStorage),
            // 刷新后恢复上次选中：持久化 agentId；mode 在 id 失效时作为备选匹配
            partialize: (state) => ({
                agentId: state.agentId,
                mode: state.mode,
            }),
            // 与 drsai.recentAgents 对齐：有「最近使用」时 agentId 以列表第一条为准，便于 useAgentInfo 用正确 id 拉详情
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const recentFirst = getFirstRecentAgentId();
                if (recentFirst) {
                    useModeConfigStore.getState().setAgentId(recentFirst);
                }
                const { agentId } = useModeConfigStore.getState();
                if (agentId) return;

                const userId = getLocalStorage("user_email", false) as
                    | string
                    | null;
                if (!userId) return;

                void Promise.all([
                    agentAPI.getAgentList(userId),
                    organizationsAPI.getMyOrg(userId).catch(() => null),
                ])
                    .then(([agents, myOrg]) => {
                        const orgDefault = (myOrg?.default_agent_id as string) || null;
                        const preferred = pickLoginDefaultAgent(
                            agents || [],
                            orgDefault,
                        );
                        const id = preferred?.id;
                        if (!id || typeof id !== "string") return;
                        const { agentId: cur, setAgentId: setId } =
                            useModeConfigStore.getState();
                        if (!cur) {
                            setId(id);
                            console.log(
                                `首次登录，设置默认 agentId（组织默认/is_default/Dr.Sai General）: ${id}`,
                            );
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
