import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-handoff-"));
try {
  const workspace = join(root, "workspace"); const source = join(workspace, "src", "main.ts");
  await mkdir(join(workspace, ".drsai"), { recursive: true }); await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(source, "export const value = 1;\n");
  await writeFile(join(workspace, ".drsai", "ide-context.json"), JSON.stringify({ source: "vscode", capturedAt: "2026-07-22T01:02:03Z", currentFile: { relativePath: "src/main.ts", language: "typescript", line: 1, column: 8 }, currentSelection: { relativePath: "src/main.ts", text: `  ${"x".repeat(12_050)}  `, startLine: 1, endLine: 1 } }));
  const ide = await import("../main/ideContext.ts");
  const snapshot = await ide.getIdeContext(workspace);
  assert.equal(snapshot.available, true); assert.equal(snapshot.source, "vscode"); assert.equal(snapshot.currentFile?.relativePath, "src/main.ts");
  assert.equal(snapshot.currentSelection?.text.length, 12_000); assert.equal(snapshot.currentSelection?.truncated, true);

  await writeFile(join(workspace, ".drsai", "ide-context.json"), JSON.stringify({ currentFile: { path: join(root, "outside.ts") }, currentSelection: { text: "secret", path: join(root, "outside.ts") } }));
  assert.equal((await ide.getIdeContext(workspace)).available, false, "outside workspace context must be discarded");
  await writeFile(join(workspace, ".drsai", "ide-context.json"), "{broken");
  assert.match((await ide.getIdeContext(workspace)).message, /could not be read or parsed/i);
  await assert.rejects(() => ide.getIdeContext(`${workspace}\nother`), /invalid/);

  const handoff = await import("../main/desktopHandoff.ts");
  assert.equal(handoff.normalizeDesktopEditCommand("selectAll"), "selectAll"); assert.equal(handoff.normalizeDesktopEditCommand("inspectElement"), null);
  const pdf = join(workspace, "evidence.PDF"); await writeFile(pdf, "%PDF-1.7\n");
  const opened: string[] = [];
  const result = await handoff.openPdfSourcePage({ path: pdf, page: 42 }, { assertAllowedPath: async (path) => { assert.equal(path, resolve(pdf)); }, openExternal: async (url) => { opened.push(url); } });
  assert.equal(result.page, 42); assert.match(result.viewerUrl, /#page=42&zoom=page-width$/); assert.deepEqual(opened, [result.viewerUrl]);
  await assert.rejects(() => handoff.openPdfSourcePage({ path: source, page: 1 }, { assertAllowedPath: async () => undefined, openExternal: async () => undefined }), /requires a PDF/);
  await assert.rejects(() => handoff.openPdfSourcePage({ path: pdf, page: 0 }, { assertAllowedPath: async () => undefined, openExternal: async () => undefined }), /between 1 and 10000/);
  let launched = false; await assert.rejects(() => handoff.openPdfSourcePage({ path: pdf, page: 1 }, { assertAllowedPath: async () => { throw new Error("blocked path"); }, openExternal: async () => { launched = true; } }), /blocked path/); assert.equal(launched, false);
  console.log("IDE context, edit command and PDF handoff verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
