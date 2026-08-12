import { existsSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const REFERENCE = /^opendrsai:\/\/regression\/evaluations\/(eval-[a-zA-Z0-9-]+)\/(summary|evidence)(?:\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+))?$/;

export function resolveRegressionReference(home: string, rawUri: unknown): string | null {
  if (typeof rawUri !== "string" || rawUri.length > 500) return null;
  const match = REFERENCE.exec(rawUri);
  if (!match) return null;
  const [, evaluationId, kind, caseId, referenceType, referenceId] = match;
  if ((caseId || referenceType || referenceId) && kind !== "evidence") return null;
  const roots = [
    { path: join(home, "regression", "agent-p4"), suffix: [] as string[] },
    { path: join(home, "workspace", "drsai", "runs"), suffix: ["regression", "agent-p4"] },
    { path: join(home, "runs"), suffix: ["regression", "agent-p4"] },
  ];
  for (const entry of roots) {
    const root = entry.path;
    if (!existsSync(root)) continue;
    const profiles = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const profile of profiles) {
      const candidate = caseId && referenceType && referenceId
        ? join(root, profile, ...entry.suffix, evaluationId, "references", caseId, referenceType, `${referenceId}.json`)
        : join(root, profile, ...entry.suffix, evaluationId, `${kind}.json`);
      if (!existsSync(candidate)) continue;
      const trustedRoot = realpathSync(root);
      const resolved = realpathSync(candidate);
      const relation = relative(trustedRoot, resolved);
      if (relation && !relation.startsWith("..") && !isAbsolute(relation)) return resolved;
    }
  }
  return null;
}
