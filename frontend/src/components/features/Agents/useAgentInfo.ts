import { useEffect } from 'react';
import { Modal, message } from 'antd';
import { useModeConfigStore } from '@/store/modeConfig';
import { agentAPI, agentWorkerAPI, organizationsAPI } from '@/components/views/api';
import { getLocalStorage } from '@/components/utils';
import { pickLoginDefaultAgent, pickPreferredAgentFromList } from '@/utils/agentPreference';
import type { Agent } from '@/types/common';

const pendingAgentInfoRequests = new Map<string, Promise<Partial<Agent>>>();
const shownOfflineModalAgentKeys = new Set<string>();

function resolveUserId(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromStorage = getLocalStorage('user_email', false) as string | null;
  return fromStorage || undefined;
}

/**
 * 全局 agent_info：用 getUserAgentById 拉取 UserAgents 详情。
 * userId 未传入时从 localStorage user_email 读取，避免 Provider 尚未恢复 user 时首屏永远不请求。
 */
export const useAgentInfo = (userIdProp?: string) => {
  const { agentId, agentInfo, setAgentId, setAgentInfo } =
    useModeConfigStore();

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
          const [agents, myOrg, userDefault] = await Promise.all([
            // Use UserAgents list for consistency with getUserAgentById
            agentWorkerAPI.getUserDefaultAgents(userId).then((r: any) => r?.data || []),
            organizationsAPI.getMyOrg(userId).catch(() => null),
            agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
          ]);
          if (cancelled) return;
          const orgDefault = (myOrg?.default_agent_id as string) || null;
          // Use stored_default_agent_id so "not set" doesn't degrade into a forced builtin.
          const userDefaultId = userDefault?.stored_default_agent_id ?? null;
          const match =
            (sa?.id && agents?.find((a) => a.id === sa.id)) ||
            (sa?.name &&
              agents?.find(
                (a) =>
                  a.name === sa.name ||
                  (Boolean(sa.mode) && a.mode === sa.mode),
              )) ||
            pickLoginDefaultAgent(agents || [], orgDefault, userDefaultId) ||
            pickPreferredAgentFromList(agents || []);
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
        return;
      }

      if (cancelled) return;

      const requestKey = `${userId}:${id}`;
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
        if (!cancelled) setAgentInfo(agentData as Partial<Agent>);
      } catch (error) {
        console.error('Failed to fetch agent info:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isOfflineAgentError = errorMessage.includes('该智能体已经下线或更新');

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
          setAgentInfo(null);
          return;
        }

        try {
          const [agents, myOrg, userDefault] = await Promise.all([
            agentWorkerAPI.getUserDefaultAgents(userId).then((r: any) => r?.data || []),
            organizationsAPI.getMyOrg(userId).catch(() => null),
            agentWorkerAPI.getUserDefaultAgent(userId).catch(() => null),
          ]);
          const byId = agents?.find((a) => a.id === id);
          if (byId) {
            setAgentInfo(byId as Partial<Agent>);
            return;
          }
          const orgDefault = (myOrg?.default_agent_id as string) || null;
          const userDefaultId = userDefault?.stored_default_agent_id ?? null;
          const preferred =
            pickLoginDefaultAgent(agents || [], orgDefault, userDefaultId) ||
            pickPreferredAgentFromList(agents || []);
          if (
            preferred?.id &&
            typeof preferred.id === 'string' &&
            preferred.id !== id
          ) {
            setAgentId(preferred.id);
            return;
          }
          if (preferred) {
            setAgentInfo(preferred as Partial<Agent>);
            return;
          }
        } catch {
          // ignore; fall through
        }
        const fallback =
          useModeConfigStore.getState().selectedAgent as Partial<Agent> | null;
        if (fallback?.name) {
          setAgentInfo(fallback);
        } else {
          setAgentInfo(null);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [agentId, userId, setAgentId, setAgentInfo]);

  return {
    agentId,
    agentInfo,
  };
};
