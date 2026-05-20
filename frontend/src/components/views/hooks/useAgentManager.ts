import { useState, useCallback, useEffect } from 'react';
import { Agent } from '../../../types/common';
import { useModeConfigStore } from '../../../store/modeConfig';
import { getFirstRecentAgentId } from '../../../utils/recentAgentsStorage';
import { pickLoginDefaultAgent } from '../../../utils/agentPreference';
import { agentAPI, agentWorkerAPI } from '../api';

export const useAgentManager = (userEmail: string | undefined) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /** false until the first successful fetch attempt for the current user finishes (incl. “no agents”) */
  const [agentCatalogLoaded, setAgentCatalogLoaded] = useState(false);
  const { setSelectedAgent, setMode, setConfig, setAgentId, setAgentInfo } =
    useModeConfigStore();

  const fetchUserAgentsFromDb = useCallback(async (): Promise<Agent[]> => {
    if (!userEmail) return [];
    const resp = await agentWorkerAPI.getUserDefaultAgents(userEmail);
    return (resp?.data || []) as Agent[];
  }, [userEmail]);

  const fetchAgentList = useCallback(async (newAgents?: Agent[]) => {
    if (!userEmail) return;

    const applyAgent = async (agent: Agent) => {
      setSelectedAgent(agent);
      // 与 /agentmode 列表一致，先写入以便首屏渲染（getUserAgentById 依赖 UserAgents 可能尚未同步）
      setAgentInfo(agent as Partial<Agent>);
      setMode(agent.mode || "magentic-one");
      if (agent.id) {
        setAgentId(agent.id);
      }
      try {
        const agentMode = agent.mode || "magentic-one";
        const agentConfig = await agentAPI.getAgentConfig(userEmail, agentMode);
        if (agentConfig) {
          setConfig(agentConfig.config);
        }
      } catch (error) {
        console.warn("Failed to load agent config:", error);
      }
    };

    try {
      // 统一数据源：用 UserAgents 表（/user_default_agents/list），避免 /agentmode 与 /user_agents/{id} 不一致导致“智能体下线”
      const res = newAgents || await fetchUserAgentsFromDb();
      setAgents(res);

      if (res.length === 0) {
        return;
      }

      let userDefaultAgentId: string | null | undefined;
      try {
        const userDefault = await agentWorkerAPI.getUserDefaultAgent(userEmail).catch(() => null);
        // Treat personal default as "explicitly set by user".
        // Backend may return a resolved fallback in default_agent_id (e.g. Dr.Sai General)
        // even when the user never chose one; stored_default_agent_id preserves intent.
        userDefaultAgentId = userDefault?.stored_default_agent_id ?? null;
      } catch {
        userDefaultAgentId = undefined;
      }

      const { selectedAgent, agentId, mode } = useModeConfigStore.getState();
      const policyDefault = pickLoginDefaultAgent(res, userDefaultAgentId);
      /** 无个人/组织显式默认时不自动选中列表首项，由用户在智能体广场选择 */
      const fallbackAgent = policyDefault;

      // 与 drsai-mode-config 对齐：优先 drsai.recentAgents[0]，再 persisted agentId，再 mode
      const resolveLastUsedFromPersist = (): Agent | undefined => {
        const recentFirstId = getFirstRecentAgentId();
        if (recentFirstId) {
          const byRecent = res.find((a) => a.id === recentFirstId);
          if (byRecent) return byRecent;
        }
        if (agentId) {
          const byId = res.find((a) => a.id === agentId);
          if (byId) return byId;
        }
        if (mode) {
          return res.find((a) => a.mode === mode);
        }
        return undefined;
      };

      // 如果已经有选中的 agent，检查它是否仍然存在于新列表中
      if (selectedAgent && selectedAgent.mode) {
        const existingAgent = res.find(
          (agent) => agent.mode === selectedAgent.mode
        );
        if (existingAgent) {
          setSelectedAgent(existingAgent);
          setAgentId(existingAgent.id ?? null);
          setAgentInfo(existingAgent as Partial<Agent>);
          return;
        }
        const lastUsed = resolveLastUsedFromPersist() || fallbackAgent;
        if (lastUsed) {
          await applyAgent(lastUsed);
        }
        return;
      }

      // 刷新后 selectedAgent 未持久化时，用 agentId / mode 恢复上次使用的智能体
      const lastUsed = resolveLastUsedFromPersist();
      if (lastUsed) {
        await applyAgent(lastUsed);
        return;
      }

      if (fallbackAgent) {
        await applyAgent(fallbackAgent);
      }
    } catch (error) {
      console.error("Error fetching agent list:", error);
    } finally {
      setAgentCatalogLoaded(true);
    }
  }, [userEmail, setSelectedAgent, setMode, setConfig, setAgentId, setAgentInfo, fetchUserAgentsFromDb]);

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

  useEffect(() => {
    if (!userEmail) {
      setAgentCatalogLoaded(true);
      setAgents([]);
      return;
    }
    setAgentCatalogLoaded(false);
  }, [userEmail]);

  return {
    agents,
    isLoading,
    agentCatalogLoaded,
    fetchAgentList,
    deleteAgent,
  };
};

