export type RegressionEvaluationStatus =
  | "preflighting"
  | "preparing_session"
  | "filling_composer"
  | "ready_to_send"
  | "sending"
  | "running"
  | "collecting_evidence"
  | "evaluating"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface RegressionSuiteSummary {
  id: string;
  title: string;
  description: string;
  case_count: number;
  catalog_revision: string;
}

export interface RegressionCaseSummary {
  id: string;
  revision: number;
  definition_sha256: string;
  title: string;
  description: string;
  owner: string;
  tags: string[];
  input_preview: string;
  timeout_seconds: number;
}

export interface RegressionInputPart {
  type: "text" | "image" | "file" | "audio" | "resource_ref";
  text?: string;
  asset_name?: string;
  mime_type?: string;
  resource_ref?: string;
}

export interface RegressionExpectationSummary {
  group: string;
  label: string;
  summary: string;
}

export interface RegressionCaseDetail extends RegressionCaseSummary {
  schema_version: "opendrsai.regression-catalog/1";
  input: { messages: Array<{ role: "system" | "user" | "assistant"; parts: RegressionInputPart[] }> };
  expect: Record<string, unknown>;
  expectation_summary: RegressionExpectationSummary[];
  environment: Record<string, unknown>;
  execution: { timeout_seconds?: number; attempts?: number; isolation?: "required" | "preferred" | "none" };
}

export interface RegressionSuiteCatalog {
  schema_version: "opendrsai.regression-catalog/1";
  suite: { id: string; title: string; description: string };
  catalog_revision: string;
  cases: RegressionCaseSummary[];
}

export interface RegressionEvaluation {
  evaluation_id: string;
  suite_id: string;
  case_id: string;
  case_revision: number;
  definition_sha256: string;
  catalog_revision: string;
  status: RegressionEvaluationStatus;
  created_at: string;
  updated_at: string;
  thread_id?: string | null;
  run_id?: string | null;
  input_sha256?: string | null;
  attempt: number;
  result?: Record<string, unknown> | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface RegressionBeginRequest {
  suiteId: string;
  caseId: string;
  caseRevision: number;
  definitionSha256: string;
}

export interface RegressionTransitionRequest {
  evaluationId: string;
  status: RegressionEvaluationStatus;
  updates?: Partial<Pick<RegressionEvaluation, "thread_id" | "run_id" | "input_sha256" | "attempt" | "result" | "error_code" | "error_message">>;
}

export interface RegressionAttachRunRequest {
  evaluationId: string;
  threadId: string;
  runId: string;
  inputSha256: string;
}
