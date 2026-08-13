// Generated from resources/remote-gateway-openapi.json. Do not edit manually.
import { randomUUID } from "crypto";
import { parseRemoteProtocolError, type RemoteProtocolErrorBody } from "../../../shared/api/remoteSshProtocol";

export const REMOTE_GATEWAY_OPERATIONS = {
  "conversation_snapshot_v1_sessions__session_id__conversation_snapshot_get": { method: "GET", path: "/v1/sessions/{session_id}/conversation-snapshot" },
  "conversation_v1_sessions__session_id__conversation_get": { method: "GET", path: "/v1/sessions/{session_id}/conversation" },
  "event_list_v1_sessions__session_id__events_get": { method: "GET", path: "/v1/sessions/{session_id}/events" },
  "event_stream_v1_sessions__session_id__events_stream_get": { method: "GET", path: "/v1/sessions/{session_id}/events/stream" },
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
  "runtime_approval_read_v1_approvals__approval_id__get": { method: "GET", path: "/v1/approvals/{approval_id}" },
  "runtime_approval_request_v1_runs__run_id__approvals_post": { method: "POST", path: "/v1/runs/{run_id}/approvals" },
  "runtime_backend_approval_decision_v1_runs__run_id__approvals__approval_id__decision_post": { method: "POST", path: "/v1/runs/{run_id}/approvals/{approval_id}/decision" },
  "runtime_backend_session_binding_status_v1_sessions__session_id__agent_backend_binding_get": { method: "GET", path: "/v1/sessions/{session_id}/agent-backend/binding" },
  "runtime_backend_session_history_sync_v1_sessions__session_id__agent_backend_history_sync_post": { method: "POST", path: "/v1/sessions/{session_id}/agent-backend/history/sync" },
  "runtime_backend_session_sync_v1_workspaces__workspace_id__agent_backends__backend_id__sessions_sync_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/agent-backends/{backend_id}/sessions/sync" },
  "runtime_capabilities_v1_capabilities_get": { method: "GET", path: "/v1/capabilities" },
  "runtime_checkpoint_latest_v1_runs__run_id__checkpoint_get": { method: "GET", path: "/v1/runs/{run_id}/checkpoint" },
  "runtime_checkpoint_save_v1_runs__run_id__checkpoint_post": { method: "POST", path: "/v1/runs/{run_id}/checkpoint" },
  "runtime_event_append_v1_runs__run_id__events_post": { method: "POST", path: "/v1/runs/{run_id}/events" },
  "runtime_event_list_v1_runs__run_id__events_get": { method: "GET", path: "/v1/runs/{run_id}/events" },
  "runtime_experiment_create_v1_runs__run_id__experiments_post": { method: "POST", path: "/v1/runs/{run_id}/experiments" },
  "runtime_identity_v1_runtime_get": { method: "GET", path: "/v1/runtime" },
  "runtime_run_cancel_v1_runs__run_id__cancel_post": { method: "POST", path: "/v1/runs/{run_id}/cancel" },
  "runtime_run_create_v1_sessions__session_id__runs_post": { method: "POST", path: "/v1/sessions/{session_id}/runs" },
  "runtime_run_diagnostics_v1_runs__run_id__diagnostics_get": { method: "GET", path: "/v1/runs/{run_id}/diagnostics" },
  "runtime_run_execute_v1_runs__run_id__execute_post": { method: "POST", path: "/v1/runs/{run_id}/execute" },
  "runtime_run_experiment_capabilities_v1_runs__run_id__experiment_capabilities_get": { method: "GET", path: "/v1/runs/{run_id}/experiment-capabilities" },
  "runtime_run_get_v1_runs__run_id__get": { method: "GET", path: "/v1/runs/{run_id}" },
  "runtime_run_goal_confirm_v1_runs__run_id__goal_confirm_post": { method: "POST", path: "/v1/runs/{run_id}/goal/confirm" },
  "runtime_run_goal_get_v1_runs__run_id__goal_get": { method: "GET", path: "/v1/runs/{run_id}/goal" },
  "runtime_run_goal_propose_v1_runs__run_id__goal_propose_post": { method: "POST", path: "/v1/runs/{run_id}/goal/propose" },
  "runtime_run_goal_revise_v1_runs__run_id__goal_put": { method: "PUT", path: "/v1/runs/{run_id}/goal" },
  "runtime_run_idempotency_result_v1_sessions__session_id__runs_by_idempotency__idempotency_key__get": { method: "GET", path: "/v1/sessions/{session_id}/runs/by-idempotency/{idempotency_key}" },
  "runtime_run_inspection_v1_runs__run_id__inspection_get": { method: "GET", path: "/v1/runs/{run_id}/inspection" },
  "runtime_run_item_locator_v1_runs__run_id__items__item_id__locator_get": { method: "GET", path: "/v1/runs/{run_id}/items/{item_id}/locator" },
  "runtime_run_list_v1_sessions__session_id__runs_get": { method: "GET", path: "/v1/sessions/{session_id}/runs" },
  "runtime_run_manifest_export_v1_runs__run_id__reproduction_manifest_export_get": { method: "GET", path: "/v1/runs/{run_id}/reproduction-manifest/export" },
  "runtime_run_manifest_v1_runs__run_id__reproduction_manifest_get": { method: "GET", path: "/v1/runs/{run_id}/reproduction-manifest" },
  "runtime_run_relations_v1_runs__run_id__relations_get": { method: "GET", path: "/v1/runs/{run_id}/relations" },
  "runtime_run_replay_boundaries_v1_runs__run_id__replay_boundaries_get": { method: "GET", path: "/v1/runs/{run_id}/replay-boundaries" },
  "runtime_run_transition_v1_runs__run_id__transition_post": { method: "POST", path: "/v1/runs/{run_id}/transition" },
  "runtime_session_create_v1_sessions_post": { method: "POST", path: "/v1/sessions" },
  "runtime_session_get_v1_sessions__session_id__get": { method: "GET", path: "/v1/sessions/{session_id}" },
  "runtime_session_list_v1_sessions_get": { method: "GET", path: "/v1/sessions" },
  "runtime_session_oaep_event_list_v1_sessions__session_id__oaep_events_get": { method: "GET", path: "/v1/sessions/{session_id}/oaep-events" },
  "runtime_session_oaep_event_stream_v1_sessions__session_id__oaep_events_stream_get": { method: "GET", path: "/v1/sessions/{session_id}/oaep-events/stream" },
  "runtime_session_oaep_snapshot_v1_sessions__session_id__oaep_snapshot_get": { method: "GET", path: "/v1/sessions/{session_id}/oaep-snapshot" },
  "runtime_session_update_v1_sessions__session_id__patch": { method: "PATCH", path: "/v1/sessions/{session_id}" },
  "runtime_side_effect_list_v1_runs__run_id__side_effects_get": { method: "GET", path: "/v1/runs/{run_id}/side-effects" },
  "runtime_workspace_approval_list_v1_workspaces__workspace_id__approvals_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/approvals" },
  "runtime_workspace_close_v1_workspaces__workspace_id__delete": { method: "DELETE", path: "/v1/workspaces/{workspace_id}" },
  "runtime_workspace_display_name_update_v1_workspaces__workspace_id__display_name_put": { method: "PUT", path: "/v1/workspaces/{workspace_id}/display-name" },
  "runtime_workspace_events_v1_workspaces__workspace_id__events_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/events" },
  "runtime_workspace_list_v1_workspaces_get": { method: "GET", path: "/v1/workspaces" },
  "runtime_workspace_open_v1_workspaces_post": { method: "POST", path: "/v1/workspaces" },
  "runtime_workspace_permission_me_v1_workspaces__workspace_id__permissions_me_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/permissions/me" },
  "runtime_workspace_permission_set_v1_workspaces__workspace_id__permissions_put": { method: "PUT", path: "/v1/workspaces/{workspace_id}/permissions" },
  "runtime_workspace_remove_v1_workspaces__workspace_id__remove_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/remove" },
  "runtime_workspace_session_catalog_event_stream_v1_workspaces__workspace_id__session_catalog_events_stream_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/session-catalog-events/stream" },
  "runtime_worktree_adopt_v1_workspaces__workspace_id__worktrees_adopt_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees/adopt" },
  "runtime_worktree_adoption_apply_v1_workspaces__workspace_id__worktrees__worktree_id__adoption_apply_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/adoption-apply" },
  "runtime_worktree_adoption_preview_v1_workspaces__workspace_id__worktrees__worktree_id__adoption_preview_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/adoption-preview" },
  "runtime_worktree_archive_v1_workspaces__workspace_id__worktrees__worktree_id__archive_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/archive" },
  "runtime_worktree_describe_v1_workspaces__workspace_id__worktrees__worktree_id__get": { method: "GET", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}" },
  "runtime_worktree_list_v1_workspaces__workspace_id__worktrees_get": { method: "GET", path: "/v1/workspaces/{workspace_id}/worktrees" },
  "runtime_worktree_merge_v1_workspaces__workspace_id__worktrees__worktree_id__merge_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}/merge" },
  "runtime_worktree_prune_v1_workspaces__workspace_id__worktrees_prune_post": { method: "POST", path: "/v1/workspaces/{workspace_id}/worktrees/prune" },
  "runtime_worktree_remove_v1_workspaces__workspace_id__worktrees__worktree_id__delete": { method: "DELETE", path: "/v1/workspaces/{workspace_id}/worktrees/{worktree_id}" },
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
