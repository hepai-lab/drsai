import React from "react";

/**
 * Agent Panel 配置接口
 * 定义了每个 agent 可以显示的侧边面板的配置
 */
export interface AgentPanelConfig {
  /** 面板类型 */
  type: 'vnc' | 'besiii' | 'terminal' | 'none';
  
  /** 面板标题 */
  title: string;
  
  /** 是否默认最小化 */
  defaultMinimized: boolean;
  
  /** 是否可最小化 */
  isMinimizable: boolean;
  
  /** 面板图标（可选） */
  icon?: React.ReactNode;
  
  /** 面板组件名称（用于后续动态加载） */
  componentName?: string;
}

/**
 * Agent 配置接口
 */
export interface AgentConfiguration {
  /** Agent 名称 */
  name: string;
  
  /** Agent 显示名称 */
  displayName: string;
  
  /** Panel 配置 */
  panel: AgentPanelConfig;
  
  /** 其他配置（预留） */
  metadata?: Record<string, any>;
}

/**
 * Agent 类型枚举
 * 根据实际的 agent 类型来定义
 */
export type AgentType = 'magnetic-one' | 'besiii' | 'default';

/**
 * Agent 配置映射表
 */
export const AGENT_CONFIGS: Record<AgentType, AgentConfiguration> = {
  // Magnetic One - 使用 VNC 浏览器预览
  'magnetic-one': {
    name: 'magnetic-one',
    displayName: 'Magnetic One',
    panel: {
      type: 'vnc',
      title: 'Browser Preview',
      defaultMinimized: true,
      isMinimizable: true,
      componentName: 'VNCViewer',
    },
  },
  
  // BESIII - 使用自定义分析面板（待开发）
  'besiii': {
    name: 'besiii',
    displayName: 'BESIII Agent',
    panel: {
      type: 'besiii',
      title: 'BESIII Analysis Panel',
      defaultMinimized: false,
      isMinimizable: true,
      componentName: 'BESIIIPanel',
    },
  },
  
  // 默认配置 - 无面板
  'default': {
    name: 'default',
    displayName: 'Default Agent',
    panel: {
      type: 'none',
      title: '',
      defaultMinimized: true,
      isMinimizable: false,
    },
  },
};

/**
 * 获取 Agent 配置
 * 
 * 这个函数支持灵活的 agent 类型匹配：
 * - 精确匹配：'magnetic-one', 'besiii', 'default'
 * - 模糊匹配：包含关键词的字符串
 * - 大小写不敏感
 * 
 * @param agentType Agent 类型标识，可以从以下来源获取：
 *   - run.task.metadata.agent_type
 *   - session.agent_mode_config.agent_type
 *   - session.agent_mode_config.type
 * @returns Agent 配置对象
 * 
 * @example
 * getAgentConfig('magnetic-one') // 返回 magnetic-one 配置
 * getAgentConfig('MagenticOneAgent') // 模糊匹配，返回 magnetic-one 配置
 * getAgentConfig('BESIII_Analyzer') // 模糊匹配，返回 besiii 配置
 * getAgentConfig(null) // 返回 default 配置
 */
export function getAgentConfig(agentType?: string | null): AgentConfiguration {
  // 如果没有指定类型，返回默认配置
  if (!agentType) {
    return AGENT_CONFIGS.default;
  }
  
  // 尝试精确匹配
  if (agentType in AGENT_CONFIGS) {
    return AGENT_CONFIGS[agentType as AgentType];
  }
  
  // 尝试模糊匹配已知的 agent 类型
  const normalizedType = agentType.toLowerCase().trim();
  
  // Magnetic One agent - 用于浏览器自动化
  // 匹配: 'magnetic', 'magentic'(拼写错误), 'magneticone' 等
  if (normalizedType.includes('magnetic') || normalizedType.includes('magentic')) {
    console.log(`[AgentConfig] Matched '${agentType}' to 'magnetic-one'`);
    return AGENT_CONFIGS['magnetic-one'];
  }
  
  // BESIII agent - 用于物理分析
  // 匹配: 'besiii', 'bes3', 'bes-iii' 等
  if (normalizedType.includes('besiii') || normalizedType.includes('bes3') || normalizedType.includes('bes-iii')) {
    console.log(`[AgentConfig] Matched '${agentType}' to 'besiii'`);
    return AGENT_CONFIGS.besiii;
  }
  
  // 未匹配到任何已知类型，返回默认配置
  console.log(`[AgentConfig] Unknown agent type '${agentType}', using 'default' config`);
  return AGENT_CONFIGS.default;
}

/**
 * 判断 agent 是否需要显示面板
 * @param agentType Agent 类型标识
 * @returns 是否需要显示面板
 */
export function shouldShowPanel(agentType?: string | null): boolean {
  const config = getAgentConfig(agentType);
  return config.panel.type !== 'none';
}

/**
 * 获取面板的初始最小化状态
 * @param agentType Agent 类型标识
 * @returns 是否默认最小化
 */
export function getPanelDefaultMinimized(agentType?: string | null): boolean {
  const config = getAgentConfig(agentType);
  return config.panel.defaultMinimized;
}

