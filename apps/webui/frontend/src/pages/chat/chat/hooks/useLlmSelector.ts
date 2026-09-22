import * as React from "react";
import { message } from "antd";
import { useAgentInfo, findLiveCatalogAgent } from "@/components/features/Agents/useAgentInfo";
import { agentWorkerAPI, sessionAPI } from "@/components/views/api";
import { useConfigStore } from "@/hooks/store";
import { useModeConfigStore } from "@/store/modeConfig";
import type { Session } from "../../../../components/types/datamodel";
import type { Agent } from "@/types/common";

interface UseLlmSelectorOptions {
  userId: string;
  userEmail?: string;
  sessionId: number;
}

function pickAgentConfig(
  ...sources: Array<{ agent_config?: Record<string, string> } | null | undefined>
): Record<string, string> | null {
  for (const src of sources) {
    const cfg = src?.agent_config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg) && Object.keys(cfg).length > 0) {
      return cfg as Record<string, string>;
    }
  }
  return null;
}

function configToLlmList(cfg: Record<string, string>) {
  return Object.entries(cfg).map(([key, value]) => ({
    label: key,
    value: String(value),
  }));
}

export function useLlmSelector({
  userId,
  userEmail,
  sessionId,
}: UseLlmSelectorOptions) {
  const { agentInfo, agentId } = useAgentInfo(userEmail);
  const { session, setSession, sessions, setSessions } = useConfigStore();
  const setAgentInfo = useModeConfigStore((s) => s.setAgentInfo);
  const selectedAgent = useModeConfigStore((s) => s.selectedAgent);
  const setSelectedAgent = useModeConfigStore((s) => s.setSelectedAgent);
  const [llmList, setLlmList] = React.useState<{ label: string; value: string }[]>(
    []
  );
  const [selectedLlmLabel, setSelectedLlmLabel] = React.useState<string>("");

  const effectiveSessionId = React.useMemo(() => {
    const fromProp = Number(sessionId);
    if (Number.isFinite(fromProp) && fromProp > 0) return fromProp;
    const fromStore = Number(session?.id);
    if (Number.isFinite(fromStore) && fromStore > 0) return fromStore;
    return 0;
  }, [sessionId, session?.id]);

  const isSessionBound = effectiveSessionId > 0;

  const boundSession = React.useMemo((): Session | null => {
    if (!isSessionBound) return null;
    if (session?.id === effectiveSessionId) return session;
    return sessions.find((s) => s.id === effectiveSessionId) ?? null;
  }, [isSessionBound, effectiveSessionId, session, sessions]);

  React.useEffect(() => {
    const sessionAgent = boundSession?.agent_mode_config as
      | { agent_config?: Record<string, string>; name?: string; mode?: string; id?: string }
      | undefined;
    const fromStore = pickAgentConfig(agentInfo, selectedAgent, sessionAgent);
    if (fromStore) {
      setLlmList(configToLlmList(fromStore));
      return;
    }

    const lookupId = String(
      agentId ||
        selectedAgent?.id ||
        (selectedAgent as { agent_id?: string } | null)?.agent_id ||
        sessionAgent?.id ||
        ""
    );
    if (!userId || !lookupId) {
      setLlmList([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        let live: Partial<Agent> | null = null;
        try {
          live = (await agentWorkerAPI.getUserAgentById(userId, lookupId)) as Partial<Agent>;
        } catch {
          const agents = await agentWorkerAPI.getUserAgents(userId, "", false);
          live = findLiveCatalogAgent(
            agents,
            lookupId,
            (selectedAgent || sessionAgent || agentInfo) as Partial<Agent>,
          );
        }
        if (cancelled) return;
        const cfg = pickAgentConfig(live);
        if (!cfg) {
          setLlmList([]);
          return;
        }
        setLlmList(configToLlmList(cfg));
        if (live) {
          setAgentInfo({ ...(agentInfo || {}), ...live, agent_config: cfg });
        }
      } catch {
        if (!cancelled) setLlmList([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentInfo, selectedAgent, boundSession, agentId, userId, setAgentInfo]);

  React.useEffect(() => {
    const sessionConfigName =
      typeof (boundSession?.agent_mode_config as { defult_config_name?: unknown } | undefined)
        ?.defult_config_name === "string"
        ? (
            (boundSession?.agent_mode_config as { defult_config_name: string })
              .defult_config_name || ""
          ).trim()
        : "";
    const agentConfigName =
      typeof (agentInfo as { defult_config_name?: unknown } | null)?.defult_config_name ===
      "string"
        ? ((agentInfo as { defult_config_name: string }).defult_config_name || "").trim()
        : "";
    const defaultConfigName = isSessionBound ? sessionConfigName : agentConfigName;

    if (defaultConfigName && llmList.some((llm) => llm.label === defaultConfigName)) {
      setSelectedLlmLabel(defaultConfigName);
    } else {
      setSelectedLlmLabel("");
    }
  }, [isSessionBound, boundSession, agentInfo, llmList]);

  const handleLLMSelect = async (llm: { label: string; value: string }) => {
    try {
      if (isSessionBound) {
        let targetSession = boundSession;
        if (!targetSession?.id) {
          targetSession = await sessionAPI.getSession(effectiveSessionId, userId);
        }

        const updatedSession = {
          ...targetSession,
          agent_mode_config: {
            ...(targetSession.agent_mode_config || {}),
            defult_config_name: llm.label,
          },
        } as Session;

        const persisted = await sessionAPI.updateSession(
          updatedSession.id!,
          updatedSession,
          userId
        );

        setSession(persisted);
        if (Array.isArray(sessions) && sessions.length > 0) {
          setSessions(sessions.map((s) => (s.id === persisted.id ? persisted : s)));
        } else {
          setSessions([persisted]);
        }
        if (selectedAgent) {
          setSelectedAgent({ ...selectedAgent, defult_config_name: llm.label });
        }
        setSelectedLlmLabel(llm.label);
        message.success(`已选择模型: ${llm.label}`);
        return;
      }

      if (!agentId || !agentInfo) {
        message.warning("请先选择智能体");
        return;
      }

      const updatedAgentConfig = {
        id: agentId,
        defult_config_name: llm.label,
      };

      await agentWorkerAPI.updateUserAgent(userId, updatedAgentConfig);
      setAgentInfo({ ...agentInfo, defult_config_name: llm.label });
      if (selectedAgent) {
        setSelectedAgent({ ...selectedAgent, defult_config_name: llm.label });
      }
      setSelectedLlmLabel(llm.label);
      message.success(`已选择模型: ${llm.label}`);
    } catch (error) {
      console.error("Failed to update LLM selection:", error);
      const errorMessage = error instanceof Error ? error.message : "更新模型选择失败";
      message.error(errorMessage);
    }
  };

  const selectedLlm =
    llmList.find((llm) => llm.label === selectedLlmLabel) || llmList[0];

  return {
    llmList,
    selectedLlmLabel,
    selectedLlm,
    handleLLMSelect,
  };
}
