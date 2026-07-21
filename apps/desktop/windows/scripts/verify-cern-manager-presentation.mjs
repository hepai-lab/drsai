import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const evidenceDir = resolve(process.env.OPENDRSAI_CERN_PPTX_DIR || join(here, "../release/product-evidence/cern-manager-deck"));
const pptx = join(evidenceDir, "cern-wlcg-manager-zh.pptx");
const manifest = join(evidenceDir, "provenance.json");
const checker = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pptx_acceptance.py");
const runtimePython = "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const python = process.env.OPENDRSAI_PDF_PYTHON || (existsSync(runtimePython) ? runtimePython : "python");

if (!existsSync(pptx) || !existsSync(manifest)) {
  throw new Error(`Generate the CERN manager deck before verification: ${pptx}`);
}
const run = spawnSync(python, [checker, pptx, manifest], {
  encoding: "utf8",
  timeout: 30_000,
  maxBuffer: 2_000_000,
  windowsHide: true,
});
if (run.status !== 0) throw new Error(`PPTX acceptance failed: ${run.stderr || run.stdout}`);
const result = JSON.parse(run.stdout.replace(/^\uFEFF/, ""));

const generator = readFileSync(join(here, "generate-manager-presentation.mjs"), "utf8");
if (!generator.includes("PresentationFile.exportPptx")) throw new Error("Generator does not export native PPTX");
if (!generator.includes("speakerNotes.textFrame.setText")) throw new Error("Generator does not create native speaker notes");
if (!generator.includes('format: "layout"')) throw new Error("Generator does not export per-slide layout evidence");
if (!generator.includes('format: "png"')) throw new Error("Generator does not render every slide");

console.log(JSON.stringify({
  ok: result.ok,
  pptx,
  slideCount: result.slideCount,
  speakerNotesCoverage: result.speakerNotesCoverage,
  mediaCount: result.mediaCount,
  checks: result.checks,
  goldenFacts: result.goldenFacts,
  sourceMapping: result.sourceMapping,
}, null, 2));
