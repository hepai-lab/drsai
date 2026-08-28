export const projectAcceptance = (features, evidenceStatus, provenance = {}) => features.map((feature) => {
  const evidence = Object.fromEntries(feature.requiredEvidence.map((kind) => [kind, evidenceStatus[kind] === true]));
  const missingEvidence = Object.entries(evidence).filter(([, passed]) => !passed).map(([kind]) => kind);
  return {
    id: feature.id,
    feature: feature.feature,
    requiredEvidence: feature.requiredEvidence,
    evidence,
    evidenceSources: Object.fromEntries(feature.requiredEvidence.map((kind) => [kind, provenance[kind] ?? null])),
    strictAcceptance: missingEvidence.length === 0 ? "accepted" : "pending",
    missingEvidence,
  };
});

export const candidateEvidenceMatches = (baseline, candidate) =>
  baseline?.artifacts?.executable?.sha256 === candidate?.artifacts?.executable?.sha256
  && baseline?.artifacts?.appAsar?.sha256 === candidate?.artifacts?.appAsar?.sha256;
