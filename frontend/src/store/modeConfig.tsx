import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Agent } from "@/types/common";
import { agentAPI } from "@/components/views/api";
import { getLocalStorage } from "@/components/utils";

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
            partialize: (state) => ({
                agentId: state.agentId,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state || state.agentId) return;
                const userId = getLocalStorage("user_email", false) as
                    | string
                    | null;
                if (!userId) return;

                void agentAPI
                    .getAgentList(userId)
                    .then((agents) => {
                        const first = agents?.[0];
                        const id = first?.id;
                        if (!id || typeof id !== "string") return;
                        const { agentId, setAgentId } =
                            useModeConfigStore.getState();
                        if (!agentId) {
                            setAgentId(id);
                            console.log(
                                `首次登录，设置默认 agentId 为列表首项: ${id}`
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
