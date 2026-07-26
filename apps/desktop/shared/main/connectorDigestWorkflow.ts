import type { DesktopWorkflowRunStep, DesktopWorkflowTemplate } from "../api/desktopApi";
import { redactDesktopSecrets } from "./secretRedaction";

const CONNECTOR_DIGEST_CHAT_COMMAND = "Prepare a concise task brief using only visible reviewed Channel attachments. Cite each attachment, separate facts from inferences, and do not fetch or send provider data.";

if (redactDesktopSecrets(CONNECTOR_DIGEST_CHAT_COMMAND) !== CONNECTOR_DIGEST_CHAT_COMMAND) {
  throw new Error("Connector digest workflow command must not contain credentials or secrets.");
}

export const CONNECTOR_DIGEST_TEMPLATE: DesktopWorkflowTemplate = {
  id: "connector-digest",
  name: "Connector digest",
  category: "research",
  status: "available",
  summary: "Turn explicitly reviewed, read-only Channel context into a task brief without silently fetching or sending provider data.",
  trigger: "Channels view reviewed context",
  steps: [
    "Load and visibly review Channel context",
    "Draft a task brief from the reviewed attachments",
    "Verify citations and provider boundaries",
  ],
  requiredCapabilities: [
    "channel adapters",
    "reviewed context attachments",
    "chat context injection",
  ],
  approvalRequired: false,
  verification: "Run workflow and Channel adapter verification; confirm the brief only cites visible reviewed attachments.",
  risk: "medium",
};

export function createConnectorDigestSteps(): DesktopWorkflowRunStep[] {
  return [
    {
      id: "review-context",
      kind: "manual_review",
      title: "Review Channel context",
      detail: "In Channels, load and review read-only context. This workflow performs no provider fetch.",
      requiresApproval: false,
    },
    {
      id: "draft-brief",
      kind: "chat_command",
      title: "Draft connector brief",
      detail: "Synthesize only reviewed Channel attachments visible in the active thread.",
      command: CONNECTOR_DIGEST_CHAT_COMMAND,
      requiresApproval: false,
    },
    {
      id: "verify-brief",
      kind: "manual_review",
      title: "Verify brief boundaries",
      detail: "Confirm every claim is traceable and no provider write or hidden fetch occurred.",
      requiresApproval: false,
    },
  ];
}
