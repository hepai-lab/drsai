export const RUN_EXPERIMENT_SCHEMA_VERSION = "opendrsai.run-experiment/1" as const;
export const REPLAY_PLAN_SCHEMA_VERSION = "opendrsai.replay-plan/1" as const;
export const RUN_EXPERIMENT_CAPABILITIES = {
  schema_version: "opendrsai.run-experiment-capabilities/1",
  override_schema_version: "opendrsai.run-experiment-overrides/1",
  supported_override_fields: ["attachments", "input", "model"],
  supported_model_fields: ["model_id", "provider_id"],
  default_replay_modes: ["rerun_from_start"],
  advanced_replay_modes: [],
} as const;

export interface RunExperimentModelCapability {
  provider_id: string;
  model_id: string;
  display_name: string;
  default: boolean;
}

export interface RunExperimentCapabilities {
  schema_version: "opendrsai.run-experiment-capabilities/1";
  override_schema_version: "opendrsai.run-experiment-overrides/1";
  run_id: string;
  backend_id: string;
  supported_override_fields: string[];
  supported_model_fields: string[];
  default_replay_modes: ReplayMode[];
  advanced_replay_modes: ReplayMode[];
  models: RunExperimentModelCapability[];
  available_model_refs: string[];
  catalog_error: string | null;
}

export type ReplayMode = "rerun_from_start" | "resume_from_checkpoint" | "reuse_recorded_results" | "reexecute_safe_steps";
export type ReplayStepDecision = "reuse" | "reexecute" | "isolate" | "block";

export interface ExperimentResourceOverride {
  reference: string;
  content_digest?: string;
  required: boolean;
  kind?: string;
}

export interface ExperimentIdentityOverride {
  reference: string;
  version?: string;
  digest?: string;
}

export interface RunExperimentOverrides {
  input?: { message: string };
  attachments?: ExperimentResourceOverride[];
  resources?: ExperimentResourceOverride[];
  model?: {
    provider_id: string;
    model_id: string;
    revision_digest?: string;
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    seed?: number;
  };
  prompt?: ExperimentIdentityOverride;
  agent?: ExperimentIdentityOverride;
  skills?: ExperimentIdentityOverride[];
  tools?: ExperimentIdentityOverride[];
  credential_refs?: string[];
}

export interface RunExperiment {
  schema_version: typeof RUN_EXPERIMENT_SCHEMA_VERSION;
  experiment_id: string;
  workspace_id: string;
  session_id: string;
  base_run_id: string;
  forked_from_item_id: string | null;
  forked_from_checkpoint_id: string | null;
  draft_version: number;
  title: string;
  status: "draft" | "executed";
  overrides: RunExperimentOverrides;
  safe_summary: Record<string, unknown>;
  overrides_digest: string;
  replay_mode: ReplayMode;
  created_by: string;
  created_at: string;
  updated_at: string;
  executed_run_id: string | null;
  created?: boolean;
}

export interface ReplayPlanStep {
  step_id: string;
  kind: string;
  decision: ReplayStepDecision;
  reason: string;
  item_id?: string;
  checkpoint_id?: string;
}

export interface ReplayPlan {
  schema_version: typeof REPLAY_PLAN_SCHEMA_VERSION;
  replay_plan_id: string;
  experiment_id: string;
  draft_version: number;
  base_run_id: string;
  base_manifest_digest: string;
  overrides_digest: string;
  replay_mode: ReplayMode;
  policy_version: string;
  plan_digest: string;
  steps: ReplayPlanStep[];
  blockers: Array<Record<string, unknown> & { code: string }>;
  risks: ReplayPlanStep[];
  estimate: {
    token_usage: Record<string, number> | null;
    token_usage_known: boolean;
    monetary_cost: number | null;
    monetary_cost_known: boolean;
    external_calls: number;
    workspace_writes: number;
  };
  approval_requirement: "none" | "required";
  created_at: string;
  expires_at: string;
  stale: boolean;
  stale_reasons: string[];
  executable: boolean;
}

export interface ReplayBoundaries {
  run_id: string;
  items: Array<{ item_id: string; item_type: string; resumable: false; reason: string }>;
  runtime_checkpoint: null | {
    checkpoint_id: string;
    event_sequence: number;
    resumable: boolean;
    missing_or_incompatible: string[];
  };
}

export interface RunRelations {
  run_id: string;
  parent: Record<string, unknown> | null;
  children: Array<Record<string, unknown> & { run_id: string }>;
  experiments: RunExperiment[];
}

interface WorkspaceRuntimeRequest { workspacePath: string; workspaceId?: string }
export interface GetRunExperimentCapabilitiesRequest extends WorkspaceRuntimeRequest { runId: string }
export interface CreateRunExperimentRequest extends WorkspaceRuntimeRequest {
  runId: string; idempotencyKey: string; title?: string; forkedFromItemId?: string; replayMode?: ReplayMode;
}
export interface GetRunExperimentRequest extends WorkspaceRuntimeRequest { experimentId: string }
export interface FinalizeRunExperimentCandidateRequest extends GetRunExperimentRequest { approvalId?: string }
export interface RunExperimentCandidateSnapshot {
  experiment_id: string;
  run_id: string;
  worktree_id: string | null;
  snapshot_created: boolean;
  candidate_head: string | null;
  previous_head?: string;
  change_count: number;
  status_digest?: string;
  reason?: string;
}
export interface UpdateRunExperimentRequest extends GetRunExperimentRequest {
  expectedVersion: number; idempotencyKey: string; patch: { title?: string; overrides?: RunExperimentOverrides; replay_mode?: ReplayMode };
}
export interface DeleteRunExperimentRequest extends GetRunExperimentRequest {}
export interface RunExperimentPackage {
  schema_version: "opendrsai.run-experiment-package/1";
  exported_at: string;
  privacy_notice: string;
  experiment: Record<string, unknown> & { experiment_id: string; base_run_id: string };
  base_manifest: object;
  candidate_manifest: object | null;
  replay_plan: Record<string, unknown> | null;
  comparison: Record<string, unknown> | null;
  adoption: Record<string, unknown> | null;
  proof_scope: string[];
  excluded: string[];
  integrity: { algorithm: "sha256"; digest_scope: "package_without_integrity"; digest: string };
}
export interface RunExperimentPackageExportResult {
  package: RunExperimentPackage;
  savedPath: string | null;
  cancelled: boolean;
}
export interface CreateReplayPlanRequest extends GetRunExperimentRequest {
  expectedDraftVersion: number; expiresInSeconds?: number; availability?: Record<string, unknown>;
}
export interface GetReplayPlanRequest extends WorkspaceRuntimeRequest { replayPlanId: string }
export interface GetReplayBoundariesRequest extends WorkspaceRuntimeRequest { runId: string }
export interface GetRunRelationsRequest extends WorkspaceRuntimeRequest { runId: string }
export interface ExecuteReplayPlanRequest extends GetReplayPlanRequest {
  draftVersion: number;
  planDigest: string;
  baseManifestDigest: string;
  idempotencyKey: string;
  approvalId?: string;
  runtimeApprovalId?: string;
  isolatedWorktreeId?: string;
}
export interface ReplayExecutionResult {
  replay_plan_id: string;
  created: boolean;
  run: Record<string, unknown> & { run_id: string; status: string };
  approval?: Record<string, unknown> | null;
  result?: unknown;
}
export interface RunComparison {
  comparison_id: string;
  schema_version: "opendrsai.run-comparison/1";
  baseline_run_id: string;
  candidate_run_id: string;
  source_digest: string;
  comparison_digest: string;
  created_at: string;
  cached: boolean;
  outcome: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  usage: Record<string, unknown>;
  attribution: Array<Record<string, unknown>>;
  candidate_snapshot?: null | {
    experiment_id: string; worktree_id: string; candidate_head: string;
    status_digest?: string; change_count: number; snapshot_created: boolean;
  };
  incomplete: boolean;
}
export interface CreateRunComparisonRequest extends WorkspaceRuntimeRequest { baselineRunId: string; candidateRunId: string }
export interface GetRunComparisonRequest extends WorkspaceRuntimeRequest { comparisonId: string }
export interface WorktreeAdoptionPreview {
  source_workspace_id: string; worktree_id: string; base_commit: string; source_head: string; candidate_head: string;
  preview_digest: string; source_clean: boolean; candidate_clean: boolean; conflict_count: number; can_apply: boolean;
  changes: Array<{ status: string; path?: string; old_path?: string; new_path?: string; conflict_possible: boolean }>;
}
export interface GetWorktreeAdoptionPreviewRequest extends WorkspaceRuntimeRequest { sourceWorkspaceId: string; worktreeId: string }
export interface ApplyWorktreeAdoptionRequest extends GetWorktreeAdoptionPreviewRequest {
  previewDigest: string; selectedPaths: string[]; approvalId: string;
}
export interface WorktreeAdoptionApplyResult { worktree: Record<string, unknown>; preview_digest: string; selected_paths: string[] }
export interface RunAdoption {
  adoption_id: string;
  schema_version: "opendrsai.run-adoption/1";
  comparison_id: string;
  source_workspace_id: string;
  worktree_id: string;
  preview_digest: string;
  preview: WorktreeAdoptionPreview;
  status: "previewed" | "applied" | "discarded";
  selected_paths: string[];
  receipt: Record<string, unknown> | null;
  operation?: { kind: "apply" | "discard"; payload: Record<string, unknown>; status: "prepared" | "completed"; started_at: string } | null;
  created_at: string;
  updated_at: string;
}
export interface GetRunAdoptionPreviewRequest extends WorkspaceRuntimeRequest { comparisonId: string }
export interface RuntimeApprovalRequired { approval_required: true; approval_id: string; code: "approval_required"; message: string }
export interface RuntimeSecurityApprovalDecisionRequest extends WorkspaceRuntimeRequest { approvalId: string; decision: "approved" | "denied" }
export interface RuntimeRunApprovalDecisionRequest extends WorkspaceRuntimeRequest { approvalId: string; decision: "approved" | "denied" }
export interface ApplyRunAdoptionRequest extends WorkspaceRuntimeRequest { adoptionId: string; selectedPaths: string[]; approvalId?: string }
export interface DiscardRunAdoptionRequest extends WorkspaceRuntimeRequest { adoptionId: string; cleanup?: boolean; approvalId?: string }
