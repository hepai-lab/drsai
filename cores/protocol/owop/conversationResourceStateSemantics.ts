export const CONVERSATION_RESOURCE_STATES = [
  "available", "moved", "changed", "deleted", "offline", "unsupported",
] as const;
export type ConversationResourceState = typeof CONVERSATION_RESOURCE_STATES[number];
export type ConversationResourceSemanticAction =
  | "preview_current" | "preview_observed" | "reveal_current" | "download"
  | "copy_logical_path" | "details" | "retry" | "switch_runtime";

export interface ConversationResourceStateInput {
  state: string;
  capabilities: Record<string, unknown>;
  has_observed_version: boolean;
}

export interface ConversationResourceStateSemantics {
  status: ConversationResourceState;
  primary: ConversationResourceSemanticAction;
  secondary: ConversationResourceSemanticAction[];
  recovery: ConversationResourceSemanticAction[];
}

const CAPABILITIES = [
  "read_current", "read_snapshot", "preview", "download",
  "reveal", "open_external", "copy_logical_path",
] as const;

/** Host-neutral, fail-closed state semantics consumed by UI adapters. */
export function conversationResourceStateSemantics(input: ConversationResourceStateInput): ConversationResourceStateSemantics {
  const validState = CONVERSATION_RESOURCE_STATES.includes(input.state as ConversationResourceState);
  const exactCapabilities = Object.keys(input.capabilities).length === CAPABILITIES.length &&
    CAPABILITIES.every((name) => typeof input.capabilities[name] === "boolean");
  const status: ConversationResourceState = validState && exactCapabilities
    ? input.state as ConversationResourceState : "unsupported";
  const capability = (name: typeof CAPABILITIES[number]) => status !== "unsupported" && input.capabilities[name] === true;

  if (status === "offline") return { status, primary: "details", secondary: [], recovery: ["retry", "switch_runtime"] };
  if (status === "unsupported") return { status, primary: "details", secondary: [], recovery: [] };

  const canObserved = input.has_observed_version && capability("read_snapshot") && capability("preview");
  const canCurrent = status !== "deleted" && capability("read_current");
  const primary: ConversationResourceSemanticAction = canCurrent && capability("preview")
    ? "preview_current"
    : canCurrent && capability("reveal")
      ? "reveal_current"
      : canObserved ? "preview_observed" : "details";
  const secondary: ConversationResourceSemanticAction[] = [];
  if (canObserved && primary !== "preview_observed") secondary.push("preview_observed");
  if (capability("download")) secondary.push("download");
  if (canCurrent && capability("copy_logical_path")) secondary.push("copy_logical_path");
  return { status, primary, secondary, recovery: [] };
}
