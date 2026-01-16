import { useEffect, useRef } from 'react';
import { useModeConfigStore } from '@/store/modeConfig';
import { agentWorkerAPI } from '@/components/views/api';
import type { Agent } from '@/types/common';

/**
 * 全局 agent_info 管理 Hook
 * 当 agentId 改变时，自动从后端拉取 agent 信息并更新全局 agentInfo
 */
export const useAgentInfo = (userId?: string) => {
  const {
    agentId,
    agentInfo,
    setAgentInfo,
  } = useModeConfigStore();

  // 使用 ref 来避免重复请求
  const fetchingRef = useRef<string | null>(null);

  useEffect(() => {
    // 如果没有 agentId，清空 agentInfo
    if (!agentId) {
      setAgentInfo(null);
      fetchingRef.current = null;
      return;
    }

    // 如果没有 userId，无法获取数据
    if (!userId) {
      console.warn('useAgentInfo: userId is required to fetch agent info');
      return;
    }

    // 如果正在获取相同的 agentId，跳过
    if (fetchingRef.current === agentId) {
      return;
    }

    // 从后端获取 agent 信息
    const fetchAgentInfo = async () => {
      fetchingRef.current = agentId;
      try {
        const agentData = await agentWorkerAPI.getUserAgentById(userId, agentId);
        setAgentInfo(agentData as Partial<Agent>);
      } catch (error) {
        console.error('Failed to fetch agent info:', error);
        setAgentInfo(null);
      } finally {
        // 如果 agentId 没有变化，清除 fetching 标记
        if (fetchingRef.current === agentId) {
          fetchingRef.current = null;
        }
      }
    };

    fetchAgentInfo();
  }, [agentId, userId, setAgentInfo]);

  return {
    agentId,
    agentInfo,
  };
};