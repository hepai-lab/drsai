import { RunLogEntry } from "../../../types/datamodel";
import { FilesEvent } from "../../../types/datamodel";
import { IPlan } from "../../../types/plan";

/**
 * Panel 组件的通用类型定义
 */

// BESIII 任务状态
export type BESIIITaskStatus = 'completed' | 'running' | 'waiting';

// BESIII 子任务
export interface BESIIISubTask {
  id: string;
  name: string;
  status: BESIIITaskStatus;
  startTime?: string;
  endTime?: string;
  error?: string;
}

// BESIII 任务
export interface BESIIITask {
  id: string;
  name: string;
  subtasks: BESIIISubTask[];
  isExpanded: boolean;
  metadata?: Record<string, any>;
}

/** Parsed from latest TaskManager TextMessage with metadata.type === "global_info". */
export interface BESIIIServerGlobalInfo {
  /** Stable key (message index + content) so the panel resets only when server sends new global_info. */
  revision: string;
  fields: Record<string, string>;
}

// BESIII Panel Props
export interface BESIIIPanelProps {
  tasks?: BESIIITask[];
  terminalOutput?: string;
  logs?: RunLogEntry[];
  fileEvents?: FilesEvent[];
  /** Latest global_info payload from run messages; revision changes when a new global_info arrives. */
  serverGlobalInfo?: BESIIIServerGlobalInfo | null;
  onMinimize?: () => void;
  onTaskClick?: (taskId: string) => void;
  onSubtaskClick?: (taskId: string, subtaskId: string) => void;
  activeTab?: 'info' | 'files' | 'logs' | 'terminal';
  onTabChange?: (tab: 'info' | 'files' | 'logs' | 'terminal') => void;
  /** Same contract as ChatInput / useTaskActions.handleInputResponse → WebSocket `input_response` (`files` / extra fields go in envelope `metadata`) */
  onInputResponse?: (
    response: string,
    accepted?: boolean,
    plan?: IPlan,
    files?: any[],
    llm?: { label: string; value: string },
    inputMetadata?: Record<string, unknown>
  ) => void;
}

// VNC Panel Props (原 DetailViewer)
export interface VNCPanelProps {
  images: string[];
  imageTitles: string[];
  onMinimize: () => void;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  novncPort?: string;
  onPause?: () => void;
  runStatus?: string;
}

// 通用 Agent Panel Props
export interface AgentPanelProps {
  panelType: 'vnc' | 'besiii' | 'terminal' | 'none';
  data?: any;
  onMinimize?: () => void;
  [key: string]: any;
}

