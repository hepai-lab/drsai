import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "opendrsai-diagnostic-tools-"));
process.env.DRSAI_HOME = home;
try {
  const workspace = join(home, "workspace"); await mkdir(join(workspace, "src"), { recursive: true }); await mkdir(join(workspace, "dist"), { recursive: true });
  const source = join(workspace, "src", "app.ts"); await writeFile(source, "const token = secret-source-token;\nexport const value = 1;\n");
  const map = { version: 3, file: "app.js", sourceRoot: "../src", sources: ["app.ts"], sourcesContent: ["const token = secret-map-token;\nexport const value = 1;\n"], names: [], mappings: "AAAA;AACA" };
  const generated = join(workspace, "dist", "app.js"); await writeFile(generated, `const token='compiled';\nexport const value=1;\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`);
  const { DiagnosticSourceNavigator } = await import("../main/sourceNavigation.ts");
  const navigator = new DiagnosticSourceNavigator({ appRoot: workspace, listWorkspaces: async () => [{ id: "workspace-1", name: "Workspace", path: workspace, location: "local", trusted: true }] as never, previewLocal: async (request) => ({ path: request.path, name: "app.ts", extension: ".ts", mimeType: "text/typescript", size: (await readFile(request.path)).length, modifiedAt: new Date().toISOString(), previewKind: "text", content: await readFile(request.path, "utf8"), truncated: false }) as never, previewRemote: async () => { throw new Error("remote disabled"); } });
  const context = await navigator.context({ source: { file: source, line: 1, language: "typescript" }, workspaceId: "workspace-1", contextLines: 2 });
  assert.equal(context.available, true); assert.equal(context.canOpen, true); assert.equal(context.redacted, true); assert.doesNotMatch(context.content!, /secret-source-token/);
  const mapped = await navigator.context({ source: { file: generated, line: 2, column: 1, language: "javascript" }, workspaceId: "workspace-1" });
  assert.equal(mapped.mapping.status, "mapped"); assert.equal(mapped.location.language, "typescript"); assert.doesNotMatch(mapped.content ?? "", /secret-map-token/);
  const outside = await navigator.context({ source: { file: join(home, "outside.ts"), line: 1 } }); assert.equal(outside.available, false); assert.equal(outside.canOpen, false);
  const resolved = await navigator.resolveOpenPath({ source: { file: source, line: 2, column: 3 }, workspaceId: "workspace-1" }); assert.equal(resolved.path, await realpath(source)); assert.equal(resolved.line, 2);

  const { ProductionDiagnosticsService } = await import("../main/productionDiagnostics.ts");
  const service = new ProductionDiagnosticsService(); await service.initialize();
  const raw = JSON.stringify({ snapshot: { events: [{ id: "event-1", message: "Bearer secret-package-token", source: { content: "private source" }, attributes: { apiKey: "secret-api-key" } }] } });
  const preview = await service.preview(raw); assert.equal(preview.encrypted, true); assert.ok(preview.sensitiveMatchesRemoved >= 1);
  const destination = join(home, "package.oddiag"); const exported = await service.exportPackage(raw, destination); assert.equal(exported.ok, true);
  const envelope = JSON.parse(await readFile(destination, "utf8")); assert.equal(envelope.algorithm, "aes-256-gcm"); assert.doesNotMatch(JSON.stringify(envelope), /secret-package-token|secret-api-key|private source/);
  const imported = await service.importPackage(destination); assert.equal(imported.ok, true); assert.equal(imported.preview.integritySha256, preview.integritySha256);
  envelope.payload = `${envelope.payload.slice(0, -2)}AA`; const tampered = join(home, "tampered.oddiag"); await writeFile(tampered, JSON.stringify(envelope)); await assert.rejects(() => service.importPackage(tampered));
  const malformed = join(home, "malformed.oddiag"); await writeFile(malformed, "{broken"); await assert.rejects(() => service.importPackage(malformed), /not valid JSON/);
  const invalidPayload = join(home, "invalid-payload.oddiag"); await writeFile(invalidPayload, JSON.stringify({ format: "opendrsai-diagnostics", version: 1, encrypted: false, payload: "not base64!", sha256: "bad" })); await assert.rejects(() => service.importPackage(invalidPayload), /payload is invalid/);
  await service.update({ allowExport: true }); const invalidDestination = join(home, "destination-directory"); await mkdir(invalidDestination); await assert.rejects(() => service.exportPackage(raw, invalidDestination)); assert.equal((await readdir(home)).some((name) => name.includes("destination-directory.tmp-")), false, "failed export must remove temporary files");
  await service.update({ allowExport: false }); await assert.rejects(() => service.exportPackage(raw, join(home, "blocked.oddiag")), /disabled by policy/);
  console.log("Diagnostic source mapping/redaction and encrypted production package verification passed.");
} finally { await rm(home, { recursive: true, force: true }); }
