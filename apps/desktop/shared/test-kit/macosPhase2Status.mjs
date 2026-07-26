const A = "accepted";
const U = "implemented_unsigned";
const P = "in_progress";
const B = "blocked_on_signing";

export const macosPhase2Statuses = [
  [P, A, A, A, A],
  [A, A, A, A, A],
  [A, A, A, A, A],
  [U, U, U, A, U],
  [U, U, U, P, A],
  [A, A, P, A, P],
  [A, A, A, A, A],
  [A, A, A, A, P],
  [P, A, A, U, B],
  [A, P, P, B, P],
].flatMap((statuses, moduleIndex) => statuses.map((status, featureIndex) => ({
  featureId: `P2-F${String(moduleIndex + 1).padStart(2, "0")}.${featureIndex + 1}`,
  status,
})));
