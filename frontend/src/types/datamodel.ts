import { RunStatus } from "./datamodel"; // Adjust if needed

export interface Session {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: string;
  version: string;
  team_id?: number;
  name?: string;
  agent?: string;
}

export interface Run {
  id: number;
  session_id: number;
  status: RunStatus;
  task?: any;
  team_result?: any;
  error_message?: string;
  version: string;
  messages?: any[];
  user_id?: string;
  state?: string;
  input_request?: any;
  created_at: string;
  updated_at: string;
}

export interface SessionRuns {
  runs: Run[];
}

export interface Team {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: string;
  version: string;
  component: any;
}

export interface AgentConfig {
  mode: string;
  name: string;
  type?: string;
  description?: string;
  config?: any;
}

export interface GeneralConfig {
  model_configs: string;
  // Add other config fields as needed
}