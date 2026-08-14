/**
 * JSON-RPC types for the DrSai TUI gateway.
 *
 * Source of truth for event shapes is the Python side
 * (`cores/python/packages/drsai/src/drsai/backend/tui_gateway/adapter/event_translator.py`).
 * This file mirrors that contract for the TS UI.
 */

// ── Frame envelopes ───────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponseOk<T = unknown> {
  jsonrpc: '2.0'
  id: string
  result: T
}

export interface JsonRpcResponseErr {
  jsonrpc: '2.0'
  id: string | null
  error: { code: number; message: string }
}

export type JsonRpcResponse<T = unknown> = JsonRpcResponseOk<T> | JsonRpcResponseErr

export interface JsonRpcEvent<P = unknown> {
  jsonrpc: '2.0'
  method: 'event'
  params: {
    type: string
    session_id?: string
    payload?: P
  }
}

// ── Skin / branding ──────────────────────────────────────────────────

export interface GatewaySkin {
  branding?: Record<string, string>
  colors?: Record<string, string>
  banner_hero?: string
  banner_logo?: string
  ws_attach_url?: string
}

export interface SetupStatus {
  config_exists: boolean
  has_api_key: boolean
  setup_required: boolean
}

// ── Session info ─────────────────────────────────────────────────────

export interface SessionInfo {
  session_id: string
  name: string
  updated_at: string
  created_at?: string | number
  last_interaction_ts?: string | number
  message_count: number
  preview: string
  workdir: string
  // New fields for session management optimization
  tags?: string[]
  pinned?: boolean
  archived?: boolean
  relevance_score?: number
}

export interface SessionListResult {
  sessions: SessionInfo[]
  user_id: string
}

export interface SessionResumeResult {
  session: SessionInfo
  history: Array<Record<string, unknown>>
  info: SessionMetadata
  user_id?: string
  memory_preview?: string
}

export interface SessionMetadata {
  session_id: string
  user_id: string
  workdir: string
  model: string
  plan_mode: boolean
  workspace_enabled: boolean
  allow_dangerous_commands?: boolean
  default_subagent?: string
  tools: string[]
  has_injected_prefix?: boolean
  has_injected_suffix?: boolean
}

export interface SessionCreateResult {
  session_id: string
  session: SessionInfo
  user_id: string
}

// ── Usage / token stats ──────────────────────────────────────────────

export interface UsagePayload {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  model: string
  status: 'complete' | 'interrupted' | 'error' | string
}

// ── Scheduler / background tasks ──────────────────────────────────────

export interface BackgroundCompletePayload {
  task_id: string
  task_name: string
  status: 'success' | 'error' | 'timeout'
  result_preview: string
  duration_ms: number
  session_id?: string
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  schedule: string
  status: 'scheduled' | 'running' | 'cancelled' | 'completed' | 'error'
  created_at: string
  last_run?: string | null
  next_run?: string | null
  session_id?: string
}

export interface SchedulerListResult {
  tasks: ScheduledTask[]
}

// ── GFS (高能所文件系统) config ─────────────────────────────────────

export interface GfsConfig {
  enabled: boolean
  mode: string            // "personal" | "admin" | "" (auto-detect)
  detected_mode: string   // resolved mode after auto-detection
  has_personal_creds: boolean
  access_key_masked: string
  secret_key_masked: string
  bucket: string
  email: string
  s3_endpoint: string
  config_path: string
  config_exists: boolean
}

export interface GfsTestResult {
  ok: boolean
  error?: string
  bucket?: string
  email?: string
  s3_endpoint?: string
  message?: string
}

export interface GfsSaveResult {
  ok: boolean
  config_path: string
  message: string
}

// ── Tool payloads ────────────────────────────────────────────────────

export interface ToolStartPayload {
  tool_id: string
  name: string
  args: Record<string, unknown>
  preview?: string
}

export interface ToolCompletePayload {
  tool_id: string
  name: string
  args: Record<string, unknown>
  result: string
  duration_ms: number
}

// ── Approval / clarify / secret ──────────────────────────────────────

export interface ApprovalRequestPayload {
  request_id: string
  command: string
  description: string
  choices: string[]
}

export interface ClarifyRequestPayload {
  request_id: string
  question: string
  choices: string[]
  is_freetext: boolean
}

export interface SecretRequestPayload {
  request_id: string
  env_var: string
  prompt: string
}

export interface SudoRequestPayload {
  request_id: string
}

// ── Remote SSH types ─────────────────────────────────────────────────

export interface SSHConfigEntry {
  name: string
  host: string
  port: number
  username: string
  password?: string        // masked as '***' when listed
  private_key_path?: string
  remote_gateway_port?: number
  remote_workdir?: string
}

export interface RemoteConnectionResult {
  connected: boolean
  ws_attach_url: string
  remote_hostname: string
  remote_cwd: string
  remote_port: number
  local_port: number
  remote_pid: number
  remote_python_version?: string
}

export interface RemoteStatusResult {
  connected: boolean
  ws_attach_url?: string
  remote_hostname?: string
  remote_cwd?: string
  remote_port?: number
  local_port?: number
  remote_pid?: number
  remote_python_version?: string
}

export interface RemoteDirEntry {
  name: string
  path: string
  is_dir: boolean
  size?: string
}

export interface RemoteExecResult {
  stdout: string
  stderr: string
  returncode: number
  host: string
}

// ── Event union ──────────────────────────────────────────────────────

interface BaseEvent {
  session_id?: string
}

export type GatewayEvent =
  // Lifecycle
  | (BaseEvent & { type: 'gateway.ready'; payload?: { skin?: GatewaySkin; setup?: SetupStatus } })
  | (BaseEvent & { type: 'gateway.stderr'; payload: { line: string } })
  | (BaseEvent & { type: 'gateway.protocol_error'; payload?: { preview?: string } })
  | (BaseEvent & { type: 'gateway.exit'; payload?: { code?: number | null; reason?: string } })
  | (BaseEvent & { type: 'session.info'; payload: SessionMetadata })
  | (BaseEvent & { type: 'session.started' })
  | (BaseEvent & { type: 'session.restored' })
  // Message stream
  | (BaseEvent & { type: 'message.start'; payload?: { role?: 'assistant' } })
  | (BaseEvent & { type: 'message.delta'; payload: { text: string; rendered?: string } })
  | (BaseEvent & { type: 'message.complete'; payload: { text: string; usage: UsagePayload; status: string; reasoning?: string } })
  | (BaseEvent & { type: 'thinking.delta'; payload: { text: string } })
  | (BaseEvent & { type: 'reasoning.delta'; payload: { text: string } })
  | (BaseEvent & { type: 'reasoning.available'; payload: { text: string } })
  // Tools
  | (BaseEvent & { type: 'tool.start'; payload: ToolStartPayload })
  | (BaseEvent & { type: 'tool.progress'; payload: { tool_id?: string; name?: string; preview?: string } })
  | (BaseEvent & { type: 'tool.complete'; payload: ToolCompletePayload })
  // Subagent
  | (BaseEvent & { type: 'subagent.spawn_requested'; payload: { source?: string; goal?: string } })
  | (BaseEvent & { type: 'subagent.start'; payload: { source?: string; goal?: string } })
  | (BaseEvent & { type: 'subagent.thinking'; payload: { source?: string; text: string } })
  | (BaseEvent & { type: 'subagent.tool'; payload: { source?: string; tool_id?: string; name?: string; args?: Record<string, unknown>; preview?: string; result?: string; status?: string } })
  | (BaseEvent & { type: 'subagent.progress'; payload: { source?: string; text?: string; percent?: number } })
  | (BaseEvent & { type: 'subagent.complete'; payload: { source?: string; text?: string; success?: boolean } })
  // Interactive prompts
  | (BaseEvent & { type: 'approval.request'; payload: ApprovalRequestPayload })
  | (BaseEvent & { type: 'clarify.request'; payload: ClarifyRequestPayload })
  | (BaseEvent & { type: 'secret.request'; payload: SecretRequestPayload })
  | (BaseEvent & { type: 'sudo.request'; payload: SudoRequestPayload })
  // Status
  | (BaseEvent & { type: 'status.update'; payload: { kind: string; text: string } })
  | (BaseEvent & { type: 'background.complete'; payload: BackgroundCompletePayload })
  | (BaseEvent & { type: 'error'; payload: { message: string } })
  // Remote SSH
  | (BaseEvent & { type: 'remote.connected'; payload: RemoteConnectionResult })
  | (BaseEvent & { type: 'remote.disconnected'; payload?: Record<string, unknown> })
  // Remote SSH — unexpected disconnection (not user-initiated)
  | (BaseEvent & { type: 'remote.lost'; payload?: { reason?: string; was_remote?: boolean } })
  // Catch-all so forward-compatible event types don't break the union.
  | (BaseEvent & { type: string; payload?: unknown })

// Discriminator helper
export type EventByType<T extends string> = Extract<GatewayEvent, { type: T }>
