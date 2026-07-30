import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const fixture = await mkdtemp(join(tmpdir(), "opendrsai-security-policy-"));
const require = createRequire(import.meta.url);
const { build } = require("esbuild") as typeof import("esbuild");
const bundle = join(fixture, "security-policy.mjs");
await build({
  stdin: {
    contents: 'export * from "../main/desktopPathPolicy.ts"; export * from "../main/ipcAuditLog.ts"; export * from "../main/secureIpc.ts";',
    resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const {
  assertAllowedDesktopPath,
  assertAllowedExternalUrl,
  createDesktopIpcAuditWriter,
  DesktopIpcBoundaryError,
} = await import(pathToFileURL(bundle).href);

assert.equal(assertAllowedExternalUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
for (const url of ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.com/"]) {
  assert.throws(() => assertAllowedExternalUrl(url), (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_URL_NOT_ALLOWED");
}

try {
  const allowed = join(fixture, "allowed");
  const outside = join(fixture, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  const file = join(allowed, "artifact.txt");
  await writeFile(file, "safe", "utf8");
  assert.equal(assertAllowedDesktopPath(file, [allowed]), await realpath(file));
  assert.equal(assertAllowedDesktopPath(allowed, [allowed], { directory: true }), await realpath(allowed));
  assert.throws(() => assertAllowedDesktopPath(outside, [allowed]), (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_PATH_OUTSIDE_ALLOWED_ROOTS");
  assert.throws(() => assertAllowedDesktopPath(file, [allowed], { directory: true }), (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_PATH_NOT_DIRECTORY");

  const auditPath = join(fixture, "logs", "desktop-ipc-audit.jsonl");
  const audit = createDesktopIpcAuditWriter(auditPath, { maxBytes: 1_024, clock: () => new Date("2026-07-22T00:00:00.000Z") });
  await audit({ channel: "desktop:test", outcome: "failed", durationMs: 4, argumentCount: 2, errorCode: "IPC_HANDLER_FAILED" });
  const first = await readFile(auditPath, "utf8");
  assert.match(first, /"schemaVersion":1/);
  assert.match(first, /"errorCode":"IPC_HANDLER_FAILED"/);
  assert.equal(first.includes("secret-value"), false, "audit must never contain argument values");
  if (process.platform !== "win32") assert.equal((await stat(auditPath)).mode & 0o077, 0, "audit log must not be group/world accessible");
  for (let index = 0; index < 30; index += 1) {
    await audit({ channel: `desktop:test-${index}`, outcome: "succeeded", durationMs: index, argumentCount: 0 });
  }
  assert.ok((await readFile(`${auditPath}.1`, "utf8")).length > 0, "audit log must rotate");
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log("Desktop security policy passed (HTTPS, path roots, directory checks, audit permissions and rotation).")
