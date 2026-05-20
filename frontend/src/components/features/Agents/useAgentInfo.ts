import { useEffect } from 'react';
import { Modal, message } from 'antd';
import { useModeConfigStore } from '@/store/modeConfig';
import { agentAPI, agentWorkerAPI } from '@/components/views/api';
import { getLocalStorage } from '@/components/utils';
import { pickLoginDefaultAgent } from '@/utils/agentPreference';
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
        const sa = useModeConfigStore.getState().selectedAgent;
        try {
          const [agents, userDefault] = await Promise.all([
            // Use UserAgents list for consistency with getUserAgentById
            agentWorkerAPI.getUserDefaultAgents(userId).then((r: any) => r?.data || []),
            agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
          ]);
          if (cancelled) return;
          // Use stored_default_agent_id so "not set" doesn't degrade into a forced builtin.
          const userDefaultId = userDefault?.stored_default_agent_id ?? null;
          const match =
            (sa?.id && agents?.find((a: any) => a.id === sa.id)) ||
            (sa?.name &&
              agents?.find(
                (a: any) =>
                  a.name === sa.name ||
                  (Boolean(sa.mode) && a.mode === sa.mode),
              )) ||
            pickLoginDefaultAgent(agents || [], null, userDefaultId);
          if (match?.id) {
            setAgentId(match.id);
            return;
          }
        } catch {
          // ignore
        }
        const sa2 = useModeConfigStore.getState().selectedAgent;
        if (sa2?.name) {
          setAgentInfo(sa2 as Partial<Agent>);
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

        if (isOfflineAgentError) {
          const sa = useModeConfigStore.getState().selectedAgent;
          // Opening a historical session restores agent snapshot into selectedAgent; UserAgents
          // may no longer list that id — keep the snapshot so chat/history stays usable.
          if (resolveAgentRecordId(sa) === String(id)) {
            setAgentInfo(sa as Partial<Agent>);
            setAgentOfflineSnapshot(true);
            return;
          }
          if (!shownOfflineModalAgentKeys.has(requestKey)) {
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
          // Modal already shown for this agent id; fall through to list/default fallback.
        }

        try {
          const [agents, userDefault] = await Promise.all([
            agentWorkerAPI.getUserDefaultAgents(userId).then((r: any) => r?.data || []),
            agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
          ]);
          const byId = agents?.find((a: any) => a.id === id);
          if (byId) {
            setAgentOfflineSnapshot(false);
            setAgentInfo(byId as Partial<Agent>);
            return;
          }
          const userDefaultId = userDefault?.stored_default_agent_id ?? null;
          const preferred = pickLoginDefaultAgent(agents || [], null, userDefaultId);
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
