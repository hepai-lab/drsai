import type { BrowserSnapshot } from "./types";

export function isBrowserSnapshot(value: unknown): value is BrowserSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<BrowserSnapshot>;
  return (
    typeof snapshot.title === "string" &&
    typeof snapshot.url === "string" &&
    typeof snapshot.visibleText === "string" &&
    Boolean(snapshot.viewport) &&
    typeof snapshot.viewport?.width === "number" &&
    typeof snapshot.viewport?.height === "number" &&
    Boolean(snapshot.structure) &&
    Array.isArray(snapshot.structure?.headings) &&
    Array.isArray(snapshot.structure?.buttons) &&
    Array.isArray(snapshot.structure?.links) &&
    Array.isArray(snapshot.structure?.inputs) &&
    Array.isArray(snapshot.structure?.elements)
  );
}
