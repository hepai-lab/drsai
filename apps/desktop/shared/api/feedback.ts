export type FeedbackCategory = "bug" | "usability" | "suggestion" | "feature_request";
export type FeedbackSource = "global" | "error" | "message" | "tool" | "crash" | "recovery";
export type FeedbackStatus = "received" | "triaged" | "investigating" | "needs_info" | "planned" | "fixed" | "closed";

export interface FeedbackContext {
  module: string;
  page: string;
  app_version: string;
  runtime_version: string;
  electron_version: string;
  platform: string;
  locale: string;
  workspace_id?: string;
  thread_id?: string;
  run_id?: string;
  trace_id?: string;
  error_code?: string;
  error_type?: string;
  breadcrumbs: Array<Record<string, unknown>>;
}

export interface FeedbackConsent {
  diagnostics: boolean;
  screenshot: boolean;
  conversation_context: boolean;
  detailed_logs: boolean;
  contact: boolean;
}

export interface FeedbackAttachmentManifest {
  kind: "diagnostics" | "screenshot" | "conversation_context" | "detailed_logs" | "crash_dump";
  name: string;
  byte_length: number;
  sha256?: string;
  requires_explicit_consent: boolean;
}

export interface FeedbackDraft {
  client_feedback_id: string;
  category: FeedbackCategory;
  source: FeedbackSource;
  user_description: string;
  contact_address?: string;
  context: Partial<FeedbackContext>;
  consent: FeedbackConsent;
  screenshot_data_url?: string;
  crash_dump_base64?: string;
  crash_dump_name?: string;
}

export interface FeedbackPackagePreview {
  client_feedback_id: string;
  category: FeedbackCategory;
  source: FeedbackSource;
  data_categories: string[];
  attachment_manifest: FeedbackAttachmentManifest[];
  estimated_byte_length: number;
  sensitive_matches_removed: number;
  retention_days: number;
  includes_screenshot: boolean;
  includes_conversation_context: boolean;
  warnings: string[];
}

export interface FeedbackSubmitResult {
  feedback_id?: string;
  client_feedback_id: string;
  status: FeedbackStatus | "queued";
  queued: boolean;
  idempotent_replay: boolean;
  message: string;
}

export interface PendingFeedbackItem {
  client_feedback_id: string;
  created_at: string;
  category: FeedbackCategory;
  source: FeedbackSource;
  attempts: number;
  last_error?: string;
}

export interface PendingCrashFeedback {
  incident_id: string;
  occurred_at: string;
  process_type: "main" | "renderer" | "utility" | "gpu";
  reason: string;
  exit_code?: number;
  crash_reporter_enabled: boolean;
}

export interface FeedbackScreenshotResult {
  data_url: string;
  width: number;
  height: number;
  byte_length: number;
}

export interface FeedbackAdminRecord {
  feedback_id: string;
  created_at: string;
  updated_at: string;
  category: FeedbackCategory;
  source: FeedbackSource;
  user_description: string;
  context: FeedbackContext;
  diagnostics: { attached: boolean; byte_length: number; sha256?: string; sensitive_matches_removed: number };
  error_fingerprint?: string;
  status: FeedbackStatus;
  duplicate_of?: string;
  fixed_in_version?: string;
  triage?: { summary: string; category: FeedbackCategory; module: string; severity: string; needs_human_review: boolean; recommended_owner: string; needs_more_info: boolean; human_owner_confirmed?: boolean };
  contact_allowed: boolean;
}
