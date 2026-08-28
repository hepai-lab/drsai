import { createHash } from "crypto";
import type { DesktopArtifactProvenance, DesktopBackgroundTask, DesktopTaskDeliverySummary } from "../api/desktopApi";
import { canonicalResultInput, canonicalResultProvenance, RESULT_PROVENANCE_SCHEMA } from "../api/resultProvenance";

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function buildResultProvenance(input: {
  sourceTaskId: string;
  sourceSessionId: string;
  sourceRunId: string;
  inputSummary: string;
  attachmentLabels: string[];
  artifactId: string;
  version: number;
  capturedAt: string;
}): DesktopArtifactProvenance {
  const inputSummary = input.inputSummary.trim();
  const attachmentLabels = input.attachmentLabels.map((item) => item.trim()).filter(Boolean);
  const inputDigest = sha256Text(canonicalResultInput(inputSummary, attachmentLabels));
  const version = Math.max(1, Math.floor(input.version));
  const target = {
    artifactId: input.artifactId,
    version,
    versionId: sha256Text(JSON.stringify({ sourceRunId: input.sourceRunId, artifactId: input.artifactId, version, inputDigest })),
  };
  const unsigned: Omit<DesktopArtifactProvenance, "sourceDigest"> = {
    schemaVersion: RESULT_PROVENANCE_SCHEMA,
    sourceTaskId: input.sourceTaskId,
    sourceSessionId: input.sourceSessionId,
    sourceRunId: input.sourceRunId,
    input: { summary: inputSummary, attachments: attachmentLabels, digest: inputDigest },
    target,
    capturedAt: input.capturedAt,
  };
  return { ...unsigned, sourceDigest: sha256Text(canonicalResultProvenance(unsigned)) };
}

export function ensureTaskArtifactProvenance(
  task: DesktopBackgroundTask,
  summary: DesktopTaskDeliverySummary,
): DesktopTaskDeliverySummary {
  return {
    ...summary,
    artifacts: summary.artifacts.map((artifact) => artifact.provenance ? artifact : {
      ...artifact,
      provenance: buildResultProvenance({
        sourceTaskId: task.id,
        sourceSessionId: task.threadId || task.id,
        sourceRunId: task.targetId || task.id,
        inputSummary: summary.workSummary || task.title,
        attachmentLabels: [],
        artifactId: artifact.id,
        version: 1,
        capturedAt: task.updatedAt,
      }),
    }),
  };
}
