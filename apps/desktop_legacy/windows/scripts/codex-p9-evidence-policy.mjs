import { createHash } from "node:crypto";

export function deriveEvidenceStatus(result, featureId) {
  if (!result) return { status: "missing", reason: "evidence_missing" };
  const covers = Array.isArray(result.features) && result.features.includes(featureId);
  if (result.blocked === true) return { status: "blocked", reason: covers ? "suite_blocked" : "feature_assertion_missing" };
  if (result.executed === true && result.status === 0 && covers) return { status: "accepted", reason: null };
  return { status: "failed", reason: covers ? "suite_unsuccessful" : "feature_assertion_missing" };
}

export function verifyAcceptedEvidence(row, bytes, featureId, identity) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (row.artifactDigest !== digest) throw new Error("artifact_digest_mismatch");
  const result = JSON.parse(bytes.toString("utf8"));
  const assertion = Array.isArray(result.assertions) && result.assertions.find((value) => value?.feature === featureId);
  if (result.executed !== true || result.status !== 0 || !result.features?.includes(featureId)
    || !assertion || assertion.passed !== true || typeof assertion.id !== "string") throw new Error("assertion_missing");
  if (result.sourceDigest !== identity.sourceDigest || result.dirtyDigest !== identity.dirtyDigest) throw new Error("identity_mismatch");
  if (!Array.isArray(result.commands) || !result.commands.length || result.commands.some((command) => command.status !== 0)) {
    throw new Error("command_evidence_invalid");
  }
  return result;
}
