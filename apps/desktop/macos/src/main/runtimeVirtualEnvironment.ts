import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VIRTUAL_ENVIRONMENTS = ["venv", "browser-venv"] as const;

export async function relocateRuntimeVirtualEnvironments(root: string, pythonVersion: string): Promise<void> {
  for (const environment of VIRTUAL_ENVIRONMENTS) {
    const config = join(root, environment, "pyvenv.cfg");
    if (!existsSync(config)) continue;
    const runtimeBin = join(root, "python-runtime", "bin");
    const executable = join(runtimeBin, `python${pythonVersion.split(".").slice(0, 2).join(".")}`);
    const contents = [
      `home = ${runtimeBin}`,
      "include-system-site-packages = false",
      `version = ${pythonVersion}`,
      `executable = ${executable}`,
      `command = ${join(runtimeBin, "python3")} -m venv ${join(root, environment)}`,
      "",
    ].join("\n");
    await writeFile(config, contents, { mode: 0o600 });
    await chmod(config, 0o600);
  }
}

export function isVirtualEnvironmentConfig(path: string): boolean {
  return VIRTUAL_ENVIRONMENTS.some((environment) => path === `${environment}/pyvenv.cfg`);
}

export async function verifyRelocatedVirtualEnvironmentConfig(root: string, path: string, absolute: string, pythonVersion?: string): Promise<void> {
  if (!pythonVersion) throw new Error(`Runtime virtual environment version is unavailable: ${path}`);
  if (!isVirtualEnvironmentConfig(path)) throw new Error(`Runtime virtual environment path is unsupported: ${path}`);
  const contents = await readFile(absolute, "utf8");
  const environment = path.split("/")[0];
  const runtimeBin = join(root, "python-runtime", "bin");
  const executable = join(runtimeBin, `python${pythonVersion.split(".").slice(0, 2).join(".")}`);
  const expected = [
    `home = ${runtimeBin}`,
    "include-system-site-packages = false",
    `version = ${pythonVersion}`,
    `executable = ${executable}`,
    `command = ${join(runtimeBin, "python3")} -m venv ${join(root, environment)}`,
    "",
  ].join("\n");
  if (contents !== expected) throw new Error(`Runtime virtual environment relocation is invalid: ${path}`);
}
