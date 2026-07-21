import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDesktopPlatformDescriptor } from "../api/platform.ts";
import { createDesktopPathService } from "../main/desktopPaths.ts";

const testKitRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const desktopRoot = resolve(testKitRoot, "../..");
const windowsRoot = join(desktopRoot, "windows");
const requireFromApp = createRequire(join(desktopRoot, "package.json"));
const { build } = requireFromApp("esbuild");
const temp = await mkdtemp(join(tmpdir(), "opendrsai-platform-contract-"));
const bundle = join(temp, "windows-platform.mjs");
await build({
  entryPoints: [join(windowsRoot, "src/main/platform.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const { WINDOWS_PLATFORM_DESCRIPTOR } = await import(pathToFileURL(bundle).href);
const windowsMainRoot = join(windowsRoot, "src/main");
const windowsPlatformServices = readFileSync(join(windowsMainRoot, "platformServices.ts"), "utf8");

assert.doesNotThrow(() => assertDesktopPlatformDescriptor(WINDOWS_PLATFORM_DESCRIPTOR));
assert.equal(WINDOWS_PLATFORM_DESCRIPTOR.id, "windows");
assert.equal(WINDOWS_PLATFORM_DESCRIPTOR.defaultTerminalShell, "powershell");
assert.equal(WINDOWS_PLATFORM_DESCRIPTOR.capabilities.terminal, true);

const windowsPaths = createDesktopPathService({
  platform: "windows",
  userHome: "C:/Users/tester",
  environment: { PATH: "C:/Windows/System32" },
});
assert.match(windowsPaths.layout.pythonExecutable.replaceAll("\\", "/"), /venv\/Scripts\/python\.exe$/);
assert.match(windowsPaths.layout.commandExecutable.replaceAll("\\", "/"), /venv\/Scripts\/drsai\.cmd$/);
assert.ok(windowsPaths.enhancedPath().includes("C:/Windows/System32"));

const macosPaths = createDesktopPathService({
  platform: "macos",
  userHome: "/Users/tester",
  environment: { PATH: "/usr/bin:/bin" },
});
assert.equal(macosPaths.layout.pythonExecutable, "/Users/tester/.drsai/drsai-agent/venv/bin/python");
assert.equal(macosPaths.layout.cliExecutable, "/Users/tester/.drsai/drsai-agent/drsai");
assert.ok(macosPaths.layout.enhancedPathEntries.includes("/opt/homebrew/bin"));
for (const service of ["paths", "terminal", "credentials", "notifications", "processes"]) {
  assert.ok(windowsPlatformServices.includes(`${service}:`), `Windows platform services omit ${service}`);
}

for (const invalid of [
  null,
  {},
  { ...WINDOWS_PLATFORM_DESCRIPTOR, id: "linux" },
  { ...WINDOWS_PLATFORM_DESCRIPTOR, defaultTerminalShell: "fish" },
  {
    ...WINDOWS_PLATFORM_DESCRIPTOR,
    capabilities: { ...WINDOWS_PLATFORM_DESCRIPTOR.capabilities, update: "yes" },
  },
]) {
  assert.throws(() => assertDesktopPlatformDescriptor(invalid));
}

console.log("Desktop platform descriptor and path-service contract verification passed.");
await rm(temp, { recursive: true, force: true });
