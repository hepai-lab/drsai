import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "opendrsai-browser-fallback-"));
const entry = join(temp, "entry.ts");
const output = join(temp, "bundle.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(join(root, "src", "main", "windowsExternalUrl.ts"))};\n`);

try {
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: "node", format: "esm" });
  const { browserCandidates, openExternalUrlWithBrowserFallback } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  let systemCalls = 0;
  const launches = [];
  await openExternalUrlWithBrowserFallback(
    "https://ai-dev.ihep.ac.cn/api/oauth2/authorize?state=test",
    async () => { systemCalls += 1; throw new Error("Failed to open: no association (0x483)"); },
    {
      platform: "win32",
      environment: { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\Local" },
      exists: (candidate) => candidate === "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe",
      spawnBrowser: async (executable, args) => { launches.push({ executable, args }); },
    },
  );
  assert.equal(systemCalls, 1);
  assert.deepEqual(launches, [{
    executable: "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe",
    args: ["https://ai-dev.ihep.ac.cn/api/oauth2/authorize?state=test"],
  }]);

  let normalLaunches = 0;
  await openExternalUrlWithBrowserFallback("https://example.test/", async () => undefined, {
    platform: "win32",
    spawnBrowser: async () => { normalLaunches += 1; },
  });
  assert.equal(normalLaunches, 0, "fallback must not run when the system handler succeeds");

  await assert.rejects(
    () => openExternalUrlWithBrowserFallback("https://example.test/", async () => { throw new Error("no association"); }, {
      platform: "win32",
      exists: () => false,
    }),
    /No installed Edge or Chrome executable was found/,
  );

  const candidates = browserCandidates({ ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\Local" });
  assert.equal(candidates[0], "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe");
  assert(candidates.includes("C:\\Local\\Google\\Chrome\\Application\\chrome.exe"));

  const authSource = readFileSync(join(root, "src", "main", "auth.ts"), "utf8");
  assert(authSource.includes("openExternalUrlWithBrowserFallback"));
  console.log("Windows external URL browser fallback verification passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
