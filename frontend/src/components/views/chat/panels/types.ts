import { RunLogEntry } from "../../../types/datamodel";
import { FilesEvent } from "../../../types/datamodel";

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

// BESIII Panel Props
export interface BESIIIPanelProps {
  tasks?: BESIIITask[];
  terminalOutput?: string;
  logs?: RunLogEntry[];
  fileEvents?: FilesEvent[];
  onMinimize?: () => void;
  onTaskClick?: (taskId: string) => void;
  onSubtaskClick?: (taskId: string, subtaskId: string) => void;
  activeTab?: 'logs' | 'files' | 'terminal';
  onTabChange?: (tab: 'logs' | 'files' | 'terminal') => void;
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

