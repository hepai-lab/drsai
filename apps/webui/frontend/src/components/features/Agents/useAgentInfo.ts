import { useEffect } from 'react';
import { Modal, message } from 'antd';
import { useModeConfigStore } from '@/store/modeConfig';
import { agentAPI, agentWorkerAPI } from '@/components/views/api';
import { getLocalStorage } from '@/components/utils';
import { pickAgentForSessionStart } from '@/utils/agentPreference';
import type { Agent } from '@/types/common';

const pendingAgentInfoRequests = new Map<string, Promise<Partial<Agent>>>();
const shownOfflineModalAgentKeys = new Set<string>();
function resolveUserId(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromStorage = getLocalStorage('user_email', false) as string | null;
  return fromStorage || undefined;
}

/** Match backend/session shapes that use `id` or `agent_id`. */
function resolveAgentRecordId(agent: Partial<Agent> | null | undefined): string | null {
  if (!agent) return null;
  const raw = (agent as { agent_id?: string }).agent_id ?? agent.id;
  return raw != null && raw !== '' ? String(raw) : null;
}

/** Live catalog match: id first, then same display name (+ mode when present). */
export function findLiveCatalogAgent(
  agents: any[] | null | undefined,
  agentId: string,
  snapshot: Partial<Agent> | null | undefined,
): any | null {
  const list = Array.isArray(agents) ? agents : [];
  const byId = list.find((a) => String(a?.id ?? "") === String(agentId));
  if (byId) return byId;

  const name = typeof snapshot?.name === "string" ? snapshot.name.trim() : "";
  if (!name) return null;
  const mode = typeof snapshot?.mode === "string" ? snapshot.mode.trim() : "";
  const named = list.filter((a) => String(a?.name ?? "").trim() === name);
  if (named.length === 0) return null;
  if (mode) {
    const typed = named.filter((a) => String(a?.mode ?? "").trim() === mode);
    if (typed.length > 0) return typed[0];
  }
  return named[0];
}

/**
 * 全局 agent_info：用 getUserAgentById 拉取 UserAgents 详情。
 * userId 未传入时从 localStorage user_email 读取，避免 Provider 尚未恢复 user 时首屏永远不请求。
 */
export const useAgentInfo = (userIdProp?: string) => {
  const {
    agentId,
    agentInfo,
    setAgentId,
    setAgentInfo,
    setAgentOfflineSnapshot,
  } = useModeConfigStore();

  const userId = resolveUserId(userIdProp);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      let id: string | undefined = agentId ?? undefined;

      if (!id) {
        const sa = useModeConfigStore.getState().selectedAgent;
        if (sa?.id) {
          setAgentId(String(sa.id));
          return;
        }
      }

      if (!id) {
        // 首屏 catalog 与默认选中由 useAgentManager.fetchAgentList 负责，此处不并行拉 list。
        const sa = useModeConfigStore.getState().selectedAgent;
        if (sa?.name) {
          setAgentInfo(sa as Partial<Agent>);
        } else {
          setAgentInfo(null);
        }
        setAgentOfflineSnapshot(false);
        return;
      }

      if (cancelled) return;

      const requestKey = `${userId}:${id}`;
      setAgentOfflineSnapshot(false);
      try {
        let pendingRequest = pendingAgentInfoRequests.get(requestKey);
        if (!pendingRequest) {
          pendingRequest = agentWorkerAPI
            .getUserAgentById(userId, id)
            .finally(() => {
              pendingAgentInfoRequests.delete(requestKey);
            });
          pendingAgentInfoRequests.set(requestKey, pendingRequest);
        }

        const agentData = await pendingRequest;
        if (!cancelled) {
          setAgentInfo(agentData as Partial<Agent>);
          setAgentOfflineSnapshot(false);
        }
      } catch (error) {
        console.error('Failed to fetch agent info:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isOfflineAgentError = errorMessage.includes('该智能体已经下线或更新');
        const sa = useModeConfigStore.getState().selectedAgent;

        try {
          const [agents, userDefault] = await Promise.all([
            agentWorkerAPI.getUserAgents(userId, "", false),
            agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
          ]);
          if (cancelled) return;
          // DDF catalog ids churn on cache rebuild; the same agent may still be
          // live under a new uuid. Match by name so historical sessions stay active.
          const live = findLiveCatalogAgent(agents, String(id), sa as Partial<Agent>);
          if (live) {
            setAgentOfflineSnapshot(false);
            setAgentInfo(live as Partial<Agent>);
            return;
          }

          if (isOfflineAgentError && resolveAgentRecordId(sa) === String(id)) {
            // Agent is gone from the live list; keep session snapshot, mark archived.
            setAgentInfo(sa as Partial<Agent>);
            setAgentOfflineSnapshot(true);
            return;
          }

          if (isOfflineAgentError && !shownOfflineModalAgentKeys.has(requestKey)) {
            shownOfflineModalAgentKeys.add(requestKey);
            Modal.confirm({
              title: '智能体不可用',
              content: errorMessage,
              okText: '删除',
              closable: false,
              maskClosable: false,
              keyboard: false,
              cancelButtonProps: {
                style: { display: 'none' },
              },
              onOk: async () => {
                await agentAPI.deleteMainAgent(userId, id);
                setAgentId(null);
                setAgentInfo(null);
                setAgentOfflineSnapshot(false);
                window.dispatchEvent(new CustomEvent('agentListChanged'));
                window.dispatchEvent(
                  new CustomEvent('switchToCurrentSession', {
                    detail: {
                      clearSession: true,
                    },
                  }),
                );
                message.success('已删除不可用智能体');
              },
            });
            setAgentOfflineSnapshot(false);
            setAgentInfo(null);
            return;
          }
          const platformPolicy = {
            auto_load_default_agent: userDefault?.auto_load_default_agent,
            default_agent_name: userDefault?.default_agent_name ?? null,
            science_default_agent_name: userDefault?.science_default_agent_name ?? null,
          };
          const preferred = pickAgentForSessionStart(
            agents || [],
            platformPolicy,
          );
          if (
            preferred?.id &&
            typeof preferred.id === 'string' &&
            preferred.id !== id
          ) {
            setAgentOfflineSnapshot(false);
            setAgentId(preferred.id);
            return;
          }
          if (preferred) {
            setAgentOfflineSnapshot(false);
            setAgentInfo(preferred as Partial<Agent>);
            return;
          }
        } catch {
          // ignore; fall through
        }
        const fallback =
          useModeConfigStore.getState().selectedAgent as Partial<Agent> | null;
        if (fallback?.name) {
          setAgentOfflineSnapshot(false);
          setAgentInfo(fallback);
        } else {
          setAgentOfflineSnapshot(false);
          setAgentInfo(null);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [agentId, userId, setAgentId, setAgentInfo, setAgentOfflineSnapshot]);

  return {
    agentId,
    agentInfo,
  };
};
