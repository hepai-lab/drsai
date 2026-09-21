export type TurnRailNavigationKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

export function findNearestTurnId(
  turns: ReadonlyArray<{ id: string; center: number }>,
  viewportCenter: number,
): string | null {
  let nearestId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const turn of turns) {
    const distance = Math.abs(turn.center - viewportCenter);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearestId = turn.id;
  }
  return nearestId;
}

export function resolveTurnRailNavigationIndex(
  currentIndex: number,
  markerCount: number,
  key: TurnRailNavigationKey,
): number | null {
  if (markerCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return markerCount - 1;
  if (key === "ArrowUp") return Math.max(0, currentIndex - 1);
  if (key === "ArrowDown") return Math.min(markerCount - 1, currentIndex + 1);
  return null;
}
