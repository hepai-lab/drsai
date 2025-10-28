import { useState, useCallback } from 'react';
import { Agent } from '../../../types/common';
import { useModeConfigStore } from '../../../store/modeConfig';
import { agentAPI } from '../api';

export const useAgentManager = (userEmail: string | undefined) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { setSelectedAgent, setMode, setConfig } = useModeConfigStore();

  const fetchAgentList = useCallback(async () => {
    if (!userEmail) return;

    try {
      const res = await agentAPI.getAgentList(userEmail);
      setAgents(res);

      // 如果用户刚登录且没有持久化的agent选择，设置默认agent
      if (res.length > 0) {
        const { selectedAgent } = useModeConfigStore.getState();

        // 如果没有选中的agent，设置默认agent为 magentic-one
        if (!selectedAgent) {
          const defaultAgent = res.find(agent => agent.mode === "magentic-one");
          if (defaultAgent) {
            setSelectedAgent(defaultAgent);
            setMode("magentic-one");

            // 获取agent的配置
            try {
              const agentConfig = await agentAPI.getAgentConfig(userEmail, "magentic-one");
              if (agentConfig) {
                setConfig(agentConfig.config);
              }
            } catch (error) {
              console.warn("Failed to load default agent config:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching agent list:", error);
    }
  }, [userEmail, setSelectedAgent, setMode, setConfig]);

  const deleteAgent = useCallback(async (id: string, onSuccess?: () => void, onError?: (error: any) => void) => {
    if (!userEmail) return;

    try {
      setIsLoading(true);
      await agentAPI.deleteMainAgent(userEmail, id);
      const updatedAgents = await agentAPI.getAgentList(userEmail);
      setAgents(updatedAgents);
      onSuccess?.();
    } catch (error) {
      console.error("Error deleting agent:", error);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]);

  return {
    agents,
    isLoading,
    fetchAgentList,
    deleteAgent,
  };
};

