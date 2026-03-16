import { useEffect } from 'react';
import { Modal, message } from 'antd';
import { useModeConfigStore } from '@/store/modeConfig';
import { agentAPI, agentWorkerAPI } from '@/components/views/api';
import type { Agent } from '@/types/common';

const pendingAgentInfoRequests = new Map<string, Promise<Partial<Agent>>>();
const shownOfflineModalAgentKeys = new Set<string>();

/**
 * 全局 agent_info 管理 Hook
 * 当 agentId 改变时，自动从后端拉取 agent 信息并更新全局 agentInfo
 */
export const useAgentInfo = (userId?: string) => {
  const {
    agentId,
    agentInfo,
    setAgentId,
    setAgentInfo,
  } = useModeConfigStore();

  useEffect(() => {
    // 如果没有 agentId，清空 agentInfo
    if (!agentId) {
      setAgentInfo(null);
      return;
    }

    // 如果没有 userId，无法获取数据
    if (!userId) {
      console.warn('useAgentInfo: userId is required to fetch agent info');
      return;
    }

    // 从后端获取 agent 信息
    const fetchAgentInfo = async () => {
      const requestKey = `${userId}:${agentId}`;
      try {
        let pendingRequest = pendingAgentInfoRequests.get(requestKey);
        if (!pendingRequest) {
          pendingRequest = agentWorkerAPI
            .getUserAgentById(userId, agentId)
            .finally(() => {
              pendingAgentInfoRequests.delete(requestKey);
            });
          console.log('pendingRequest', pendingRequest);
          pendingAgentInfoRequests.set(requestKey, pendingRequest);
        }

        const agentData = await pendingRequest;
        setAgentInfo(agentData as Partial<Agent>);
      } catch (error) {
        console.error('Failed to fetch agent info:', error);
        setAgentInfo(null);
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
              await agentAPI.deleteMainAgent(userId, agentId);
              setAgentId(null);
              setAgentInfo(null);
              window.dispatchEvent(new CustomEvent('agentListChanged'));
              window.dispatchEvent(
                new CustomEvent('switchToCurrentSession', {
                  detail: {
                    clearSession: true,
                  },
                })
              );
              message.success('已删除不可用智能体');
            },
          });
        }
      }
    };

    fetchAgentInfo();
  }, [agentId, userId, setAgentId, setAgentInfo]);

  return {
    agentId,
    agentInfo,
  };
};