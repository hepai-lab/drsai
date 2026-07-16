// Generated from resources/remote-gateway-openapi.json. Do not edit manually.
import { randomUUID } from "crypto";
import { parseRemoteProtocolError, type RemoteProtocolErrorBody } from "../shared/remoteSshProtocol";

export const REMOTE_GATEWAY_OPERATIONS = {
  "remote_handshake_v1_remote_handshake_post": { method: "POST", path: "/v1/remote/handshake" },
  "remote_workspace_checkpoint_accept_v1_workspaces__workspace_id__checkpoints_accept_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/checkpoints/accept" },
  "remote_workspace_checkpoint_create_v1_workspaces__workspace_id__checkpoints_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/checkpoints" },
  "remote_workspace_checkpoint_preview_v1_workspaces__workspace_id__checkpoints_preview_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/checkpoints/preview" },
  "remote_workspace_checkpoint_restore_v1_workspaces__workspace_id__checkpoints_restore_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/checkpoints/restore" },
  "remote_workspace_checkpoints_v1_workspaces__workspace_id__checkpoints_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/checkpoints" },
  "remote_workspace_context_v1_workspaces__workspace_id__context_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/context" },
  "remote_workspace_directories_v1_workspaces__workspace_id__directories_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/directories" },
  "remote_workspace_file_stream_v1_workspaces__workspace_id__file_stream_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/file/stream" },
  "remote_workspace_file_v1_workspaces__workspace_id__file_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/file" },
  "remote_workspace_file_write_v1_workspaces__workspace_id__file_put": { method: "PUT", path: "/v1/workspaces/{workspace_id}/file" },
  "remote_workspace_files_v1_workspaces__workspace_id__files_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/files" },
  "remote_workspace_folder_summary_v1_workspaces__workspace_id__folder_summary_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/folder-summary" },
  "remote_workspace_git_commit_v1_workspaces__workspace_id__git_commit_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/commit" },
  "remote_workspace_git_diff_v1_workspaces__workspace_id__git_diff_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/git/diff" },
  "remote_workspace_git_file_at_ref_v1_workspaces__workspace_id__git_file_at_ref_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/git/file-at-ref" },
  "remote_workspace_git_hunk_v1_workspaces__workspace_id__git__operation__hunk_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/{operation}-hunk" },
  "remote_workspace_git_push_v1_workspaces__workspace_id__git_push_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/push" },
  "remote_workspace_git_revert_v1_workspaces__workspace_id__git_revert_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/revert" },
  "remote_workspace_git_stage_v1_workspaces__workspace_id__git_stage_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/stage" },
  "remote_workspace_git_status_v1_workspaces__workspace_id__git_status_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/git/status" },
  "remote_workspace_git_unstage_v1_workspaces__workspace_id__git_unstage_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/git/unstage" },
  "remote_workspace_info_v1_workspaces__workspace_id__get": { method: "GET", path: "/v1/workspaces/{workspace_id}" },
  "remote_workspace_open_v1_workspaces_open_post": { method: "POST", path: "/v1/workspaces/open" },
  "remote_workspace_worktree_create_v1_workspaces__workspace_id__worktrees_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees" },
  "runtime_approval_decision_v1_approvals__approval_id__decision_post": { method: "POST", path: "/v1/approvals/{approval_id}/decision" },
  "runtime_approval_request_v1_runs__run_id__approvals_post": { method: "POST", path: "/v1/runs/{run_id}/approvals" },
  "runtime_capabilities_v1_capabilities_get": { method: "GET", path: "/v1/capabilities" },
  "runtime_checkpoint_latest_v1_runs__run_id__checkpoint_get": { method: "GET", path: "/v1/runs/{run_id}/checkpoint" },
  "runtime_checkpoint_save_v1_runs__run_id__checkpoint_post": { method: "POST", path: "/v1/runs/{run_id}/checkpoint" },
  "runtime_event_append_v1_runs__run_id__events_post": { method: "POST", path: "/v1/runs/{run_id}/events" },
  "runtime_event_list_v1_runs__run_id__events_get": { method: "GET", path: "/v1/runs/{run_id}/events" },
  "runtime_identity_v1_runtime_get": { method: "GET", path: "/v1/runtime" },
  "runtime_run_cancel_v1_runs__run_id__cancel_post": { method: "POST", path: "/v1/runs/{run_id}/cancel" },
  "runtime_run_create_v1_sessions__session_id__runs_post": { method: "POST", path: "/v1/sessions/{session_id}/runs" },
  "runtime_run_diagnostics_v1_runs__run_id__diagnostics_get": { method: "GET", path: "/v1/runs/{run_id}/diagnostics" },
  "runtime_run_execute_v1_runs__run_id__execute_post": { method: "POST", path: "/v1/runs/{run_id}/execute" },
  "runtime_run_get_v1_runs__run_id__get": { method: "GET", path: "/v1/runs/{run_id}" },
  "runtime_run_transition_v1_runs__run_id__transition_post": { method: "POST", path: "/v1/runs/{run_id}/transition" },
  "runtime_session_create_v1_sessions_post": { method: "POST", path: "/v1/sessions" },
  "runtime_session_get_v1_sessions__session_id__get": { method: "GET", path: "/v1/sessions/{session_id}" },
  "runtime_session_list_v1_sessions_get": { method: "GET", path: "/v1/sessions" },
  "runtime_session_update_v1_sessions__session_id__patch": { method: "PATCH", path: "/v1/sessions/{session_id}" },
  "runtime_workspace_close_v1_workspaces__workspace_id__delete": { method: "DELETE", path: "/v1/workspaces/{workspace_id}" },
  "runtime_workspace_list_v1_workspaces_get": { method: "GET", path: "/v1/workspaces" },
  "runtime_workspace_open_v1_workspaces_post": { method: "POST", path: "/v1/workspaces" },
  "runtime_workspace_permission_me_v1_workspaces__workspace_id__permissions_me_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/permissions/me" },
  "runtime_workspace_permission_set_v1_workspaces__workspace_id__permissions_put": { method: "PUT", path: "/v1/workspaces/{workspace_id}/permissions" },
} as const;
export type RemoteGatewayOperationId = keyof typeof REMOTE_GATEWAY_OPERATIONS;

export class RemoteGatewayClient {
  constructor(readonly baseUrl: string, readonly token: string, readonly workspaceId: string) {}

  async workspaceRequest<T>(endpoint: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.workspaceId)}${endpoint}`, {
      ...init,
      headers: { "X-OpenDrSai-Gateway-Token": this.token, "X-Correlation-ID": randomUUID(), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      let body: RemoteProtocolErrorBody | null = null;
      try { body = await response.json() as RemoteProtocolErrorBody; } catch { /* non-JSON failure */ }
      throw parseRemoteProtocolError(response.status, body, response.headers.get("x-correlation-id"));
    }
    return response.json() as Promise<T>;
  }

  get<T>(endpoint: string, timeoutMs = 10_000): Promise<T> { return this.workspaceRequest(endpoint, {}, timeoutMs); }
  post<T>(endpoint: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    return this.workspaceRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  }
}
