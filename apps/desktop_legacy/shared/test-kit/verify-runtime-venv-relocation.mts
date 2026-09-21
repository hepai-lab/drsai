import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isVirtualEnvironmentConfig,
  relocateRuntimeVirtualEnvironments,
  verifyRelocatedVirtualEnvironmentConfig,
} from "../../macos/src/main/runtimeVirtualEnvironment";

const temp = await mkdtemp(join(tmpdir(), "opendrsai-runtime-venv-"));
const transactionRoot = join(temp, ".runtime-install-fixture", "drsai-agent");
const finalRoot = join(temp, "drsai-agent");
const pythonVersion = "3.11.9";

try {
  for (const environment of ["venv", "browser-venv"]) {
    await mkdir(join(transactionRoot, environment), { recursive: true });
    await writeFile(join(transactionRoot, environment, "pyvenv.cfg"), "home = /build-machine/private/python\n", "utf8");
  }
  await mkdir(join(transactionRoot, "python-runtime", "bin"), { recursive: true });
  const unrelated = join(transactionRoot, "runtime-marker.txt");
  await writeFile(unrelated, "immutable\n", "utf8");

  await relocateRuntimeVirtualEnvironments(transactionRoot, pythonVersion);
  for (const environment of ["venv", "browser-venv"]) {
    const relative = `${environment}/pyvenv.cfg`;
    await verifyRelocatedVirtualEnvironmentConfig(transactionRoot, relative, join(transactionRoot, relative), pythonVersion);
  }
  assert.equal(await readFile(unrelated, "utf8"), "immutable\n", "relocation must not rewrite unrelated Runtime files");

  await rename(transactionRoot, finalRoot);
  await relocateRuntimeVirtualEnvironments(finalRoot, pythonVersion);
  for (const environment of ["venv", "browser-venv"]) {
    const relative = `${environment}/pyvenv.cfg`;
    const config = join(finalRoot, relative);
    await verifyRelocatedVirtualEnvironmentConfig(finalRoot, relative, config, pythonVersion);
    assert.doesNotMatch(await readFile(config, "utf8"), /\.runtime-install-fixture/, "activated venv must not retain its transaction path");
    assert.equal((await stat(config)).mode & 0o777, 0o600, "relocated venv metadata must be owner-only");
  }

  const primary = join(finalRoot, "venv", "pyvenv.cfg");
  await writeFile(primary, `${await readFile(primary, "utf8")}home = /attacker/runtime\n`, "utf8");
  await assert.rejects(
    verifyRelocatedVirtualEnvironmentConfig(finalRoot, "venv/pyvenv.cfg", primary, pythonVersion),
    /relocation is invalid/,
    "extra or attacker-controlled venv metadata must fail closed",
  );
  await assert.rejects(
    verifyRelocatedVirtualEnvironmentConfig(finalRoot, "other/pyvenv.cfg", primary, pythonVersion),
    /path is unsupported/,
  );
  assert.equal(isVirtualEnvironmentConfig("venv/pyvenv.cfg"), true);
  assert.equal(isVirtualEnvironmentConfig("browser-venv/pyvenv.cfg"), true);
  assert.equal(isVirtualEnvironmentConfig("other/pyvenv.cfg"), false);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("macOS Runtime venv relocation passed (transaction, activation, dual venv, permissions and tamper refusal).");
