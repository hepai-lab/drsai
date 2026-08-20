import { useState, useCallback, useEffect, useRef } from 'react';
import { Agent } from '../../../types/common';
import { useModeConfigStore } from '../../../store/modeConfig';
import { getFirstRecentAgentId } from '../../../utils/recentAgentsStorage';
import {
  pickAgentForSessionStart,
  pickPreferredAgentFromList,
  shouldRefreshAgentCatalog,
  type PlatformAgentPolicy,
} from '../../../utils/agentPreference';
import { buildCatalogLoadingHints } from '../../../utils/agentCatalogLoadingHints';
import { getModelApiKeyFromSettings } from '../../../utils/modelApiKey';
import { agentAPI, agentWorkerAPI } from '../api';

const HINT_ROTATE_MS = 2400;

export const useAgentManager = (userEmail: string | undefined) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [agentCatalogLoaded, setAgentCatalogLoaded] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogLoadingHint, setCatalogLoadingHint] = useState("");
  const [platformAgentPolicy, setPlatformAgentPolicy] = useState<PlatformAgentPolicy | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setSelectedAgent, setMode, setConfig, setAgentId, setAgentInfo } =
    useModeConfigStore();

  const stopHintRotation = useCallback(() => {
    if (hintTimerRef.current) {
      clearInterval(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setCatalogRefreshing(false);
    setCatalogLoadingHint("");
  }, []);

  const startHintRotation = useCallback((defaultAgentName?: string | null) => {
    const hints = buildCatalogLoadingHints(defaultAgentName);
    let index = 0;
    setCatalogRefreshing(true);
    setCatalogLoadingHint(hints[0] ?? "加载中…");
    if (hintTimerRef.current) clearInterval(hintTimerRef.current);
    hintTimerRef.current = setInterval(() => {
      index = (index + 1) % hints.length;
      setCatalogLoadingHint(hints[index] ?? "加载中…");
    }, HINT_ROTATE_MS);
  }, []);

  const fetchAgentList = useCallback(async (newAgents?: Agent[]) => {
    if (!userEmail) return;

    const applyAgent = async (agent: Agent) => {
      setSelectedAgent(agent);
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

    let userDefaultAgentId: string | null | undefined;
    let platformPolicy: PlatformAgentPolicy | null = null;
    let isBrandNewUser = false;

    try {
      try {
        const userDefault = await agentWorkerAPI.getUserDefaultAgent(userEmail).catch(() => null);
        userDefaultAgentId = userDefault?.stored_default_agent_id ?? null;
        platformPolicy = {
          auto_load_default_agent: userDefault?.auto_load_default_agent,
          default_agent_name: userDefault?.default_agent_name ?? null,
          science_default_agent_name: userDefault?.science_default_agent_name ?? null,
        };
        setPlatformAgentPolicy(platformPolicy);
      } catch {
        userDefaultAgentId = undefined;
        setPlatformAgentPolicy(null);
      }

      const { selectedAgent, agentId, mode } = useModeConfigStore.getState();
      const recentFirstId = getFirstRecentAgentId();
      isBrandNewUser = shouldRefreshAgentCatalog({
        storedDefaultAgentId: userDefaultAgentId,
        agentId,
        mode,
      });

      if (!newAgents && isBrandNewUser) {
        startHintRotation(platformPolicy?.default_agent_name);
      }

      let res: Agent[];
      if (newAgents) {
        res = newAgents;
      } else {
        let catalogApiKey = "";
        if (isBrandNewUser) {
          try {
            catalogApiKey =
              (await getModelApiKeyFromSettings(userEmail)) ?? "";
          } catch (error) {
            console.warn(
              "Could not load model API key for catalog refresh:",
              error,
            );
          }
        }
        const refreshed = await agentWorkerAPI.getUserAgents(
          userEmail,
          catalogApiKey,
          isBrandNewUser,
        );
        res = (refreshed || []) as Agent[];
      }

      setAgents(res);

      if (res.length === 0) {
        return;
      }

      // URL share_agent=true + agentId/agentName 直链展示指定智能体
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const shareAgent = urlParams.get("share_agent");
        console.log("[agentLink] useAgentManager: location.search =", window.location.search, "share_agent =", shareAgent);
        if (shareAgent === "true") {
          const urlAgentId = urlParams.get("agentId");
          const urlAgentName = urlParams.get("agentName");
          console.log("[agentLink] useAgentManager: agentId =", urlAgentId, "agentName =", urlAgentName);
          if (urlAgentId || urlAgentName) {
            let matched: Agent | undefined;
            if (urlAgentId) {
              matched = res.find((a) => a.id === urlAgentId);
            }
            if (!matched && urlAgentName) {
              const candidates = res.map((a) => a.name);
              console.log("[agentLink] useAgentManager: looking for", urlAgentName, "in", candidates);
              matched = res.find((a) => (a.name || "").trim() === urlAgentName.trim());
            }
            console.log("[agentLink] useAgentManager: matched =", matched?.name || matched?.id || "NONE");
            if (matched) {
              await applyAgent(matched);
              // 清除 URL 参数避免刷新时重复命中
              urlParams.delete("share_agent");
              urlParams.delete("agentId");
              urlParams.delete("agentName");
              const newSearch = urlParams.toString();
              window.history.replaceState(null, "", newSearch ? `?${newSearch}` : window.location.pathname);
              return;
            }
          }
        }
      } catch { /* URL 解析失败不影响正常流程 */ }

      const policyDefault = pickAgentForSessionStart(res, userDefaultAgentId, platformPolicy);
      const fallbackAgent = policyDefault;

      const resolveLastUsedFromPersist = (): Agent | undefined => {
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

      const lastUsed = resolveLastUsedFromPersist();
      if (lastUsed) {
        await applyAgent(lastUsed);
        return;
      }

      if (fallbackAgent) {
        await applyAgent(fallbackAgent);
      }

      // Final fallback: when no agent was auto-selected (e.g. science_user with
      // only one agent and no platform policy), pick the preferred agent from the list.
      if (!useModeConfigStore.getState().agentId && res.length > 0) {
        const preferred = pickPreferredAgentFromList(res);
        if (preferred) {
          await applyAgent(preferred);
        }
      }
    } catch (error) {
      console.error("Error fetching agent list:", error);
    } finally {
      stopHintRotation();
      setAgentCatalogLoaded(true);
    }
  }, [
    userEmail,
    setSelectedAgent,
    setMode,
    setConfig,
    setAgentId,
    setAgentInfo,
    startHintRotation,
    stopHintRotation,
  ]);

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
      stopHintRotation();
      return;
    }
    setAgentCatalogLoaded(false);
  }, [userEmail, stopHintRotation]);

  useEffect(() => () => stopHintRotation(), [stopHintRotation]);

  return {
    agents,
    isLoading,
    agentCatalogLoaded,
    catalogRefreshing,
    catalogLoadingHint,
    platformAgentPolicy,
    fetchAgentList,
    deleteAgent,
  };
};
