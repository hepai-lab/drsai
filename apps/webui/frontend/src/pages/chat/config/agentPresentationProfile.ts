/**
 * Per-agent chat presentation policy.
 *
 * Stream v2 keeps a stable semantic model (reasoning/content + turn_plane).
 * This profile only controls how the frontend shells process steps —
 * e.g. YuanYuan wants every step in the main thread; DocMaster keeps the
 * collapsible process box with last-hop-as-final.
 */

export type ProcessLayout = "collapsed_box" | "inline_timeline" | "hidden";

/** Height policy for collapsed_box only. */
export type ProcessBoxHeight = "fixed_max" | "fill_viewport" | "unbounded";

/**
 * How multi-hop assistant text is slotted into process vs final.
 * Currently consumed by layout; hop re-assembly can follow later.
 */
export type HopPolicy =
  | "last_is_final"
  | "every_completed_is_final"
  | "backend_stamped";

export interface AgentPresentationProfile {
  id: string;
  processLayout: ProcessLayout;
  processBox: ProcessBoxHeight;
  hopPolicy: HopPolicy;
}

export const DEFAULT_PRESENTATION_PROFILE: AgentPresentationProfile = {
  id: "default",
  processLayout: "collapsed_box",
  processBox: "fixed_max",
  hopPolicy: "last_is_final",
};

const YUANYUAN_PROFILE: AgentPresentationProfile = {
  id: "yuanyuan",
  processLayout: "inline_timeline",
  processBox: "unbounded",
  hopPolicy: "every_completed_is_final",
};

const DOCMASTER_PROFILE: AgentPresentationProfile = {
  id: "docmaster",
  processLayout: "collapsed_box",
  processBox: "fixed_max",
  hopPolicy: "last_is_final",
};

/** Match catalog / message source names like YuanYuan_Agent, DocMaster-test. */
export function resolveAgentPresentationProfile(
  agentName?: string | null
): AgentPresentationProfile {
  const n = (agentName || "").trim().toLowerCase();
  if (!n) return DEFAULT_PRESENTATION_PROFILE;
  if (n.includes("yuanyuan")) return YUANYUAN_PROFILE;
  if (n.includes("docmaster")) return DOCMASTER_PROFILE;
  return DEFAULT_PRESENTATION_PROFILE;
}

/** Prefer session stamp, then live catalog selection. */
export function resolvePresentationAgentName(sources: {
  sessionAgentName?: string | null;
  selectedAgentName?: string | null;
  agentInfoName?: string | null;
}): string | null {
  const candidates = [
    sources.sessionAgentName,
    sources.agentInfoName,
    sources.selectedAgentName,
  ];
  for (const c of candidates) {
    const t = (c || "").trim();
    if (t) return t;
  }
  return null;
}
