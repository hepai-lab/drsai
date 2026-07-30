const A = "accepted";
export const macosPhase2Statuses = [
  [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A],
  [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A], [A, A, A, A, A],
].flatMap((statuses, moduleIndex) => statuses.map((status, featureIndex) => ({
  featureId: `P2-F${String(moduleIndex + 1).padStart(2, "0")}.${featureIndex + 1}`,
  status,
})));
