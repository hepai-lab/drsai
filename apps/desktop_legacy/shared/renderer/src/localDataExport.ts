import { redactSensitiveData } from "../../api/sensitiveData";

export function buildLocalDesktopDataExport(
  threadSnapshots: Record<string, unknown>,
  preferences: Record<string, string | null>,
  exportedAt = new Date().toISOString(),
): string {
  return redactSensitiveData(JSON.stringify({
    exportedAt,
    sensitiveDataPolicy: "redacted-before-export",
    preferences,
    threadSnapshots,
  }, null, 2));
}
