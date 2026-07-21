import { readFileSync } from "fs";
import { dirname, join } from "path";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readInstalledRuntimeVersion(drsaiRepo: string): string | null {
  try {
    const statePath = join(dirname(drsaiRepo), "install-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      version?: unknown;
      runtimeVersion?: unknown;
    };
    const value = typeof state.runtimeVersion === "string"
      ? state.runtimeVersion.trim()
      : typeof state.version === "string"
        ? state.version.trim()
        : "";
    return SEMVER_PATTERN.test(value) ? `version: ${value}` : null;
  } catch {
    return null;
  }
}

export function readBackendSourceVersion(drsaiRepo: string): string | null {
  const candidates = [
    join(drsaiRepo, "venv", "Lib", "site-packages", "drsai", "version.py"),
    join(drsaiRepo, "cores", "python", "packages", "drsai", "src", "drsai", "version.py"),
    join(drsaiRepo, "src", "drsai", "version.py"),
    join(drsaiRepo, "drsai", "version.py"),
  ];
  for (const path of candidates) {
    try {
      const match = /^__version__\s*=\s*["']([^"']+)["']/m.exec(readFileSync(path, "utf8"));
      const version = match?.[1]?.trim() ?? "";
      if (SEMVER_PATTERN.test(version)) return `version: ${version}`;
    } catch {
      // Try the next supported runtime layout.
    }
  }
  return null;
}

export function normalizeRuntimeVersionOutput(output: string): string | null {
  const value = output.trim();
  if (!value) return null;
  const labeled = /^(?:drsai\s+)?version\s*:\s*(\S+)$/i.exec(value);
  if (labeled && SEMVER_PATTERN.test(labeled[1])) return `version: ${labeled[1]}`;
  return SEMVER_PATTERN.test(value) ? `version: ${value}` : null;
}
