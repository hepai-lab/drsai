import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const manifestPath = join(repo, "tests/fixtures/product/presentation-report-wlcg.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const cacheDir = join(repo, ".tmp/product-fixtures");
const cachedPdf = join(cacheDir, manifest.source.filename);
const pdfPath = resolve(process.env.OPENDRSAI_CERN_PDF || cachedPdf);
const extractor = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function download(url, target, redirects = 0) {
  assert(redirects <= 5, "Too many fixture download redirects");
  return new Promise((accept, reject) => {
    const request = get(url, { headers: { "User-Agent": "OpenDrSai product acceptance" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), target, redirects + 1).then(accept, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Fixture download returned HTTP ${response.statusCode}`));
        return;
      }
      const partial = `${target}.partial`;
      const output = createWriteStream(partial, { flags: "w" });
      response.pipe(output);
      output.on("finish", () => {
        output.close();
        renameSync(partial, target);
        accept();
      });
      output.on("error", reject);
    });
    request.setTimeout(30_000, () => request.destroy(new Error("Fixture download timed out")));
    request.on("error", reject);
  });
}

await mkdir(dirname(pdfPath), { recursive: true });
if (!existsSync(pdfPath)) await download(manifest.source.downloadUrl, pdfPath);

const bytes = readFileSync(pdfPath);
const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
assert(statSync(pdfPath).size === manifest.source.sizeBytes, "CERN fixture byte size changed");
assert(sha256 === manifest.source.sha256, "CERN fixture SHA-256 changed");

const runtimePython = "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const python = process.env.OPENDRSAI_PDF_PYTHON || (existsSync(runtimePython) ? runtimePython : "python");
const extraction = spawnSync(python, [extractor, pdfPath, "--format", "json"], {
  encoding: "utf8",
  timeout: 30_000,
  maxBuffer: 512_000,
  windowsHide: true,
});
assert(extraction.status === 0, `PDF extractor failed: ${extraction.stderr || extraction.error || "unknown error"}`);
const result = JSON.parse(extraction.stdout.replace(/^\uFEFF/, ""));

assert(result.type === manifest.document.type, `Expected ${manifest.document.type}, received ${result.type}`);
assert(result.pageCount === manifest.document.pages, `Expected ${manifest.document.pages} pages`);
assert(result.landscapeRatio >= 0.95, "CERN slide deck was not recognized as landscape presentation pages");
assert(result.safety.javascriptExecuted === false, "Extractor claims to execute PDF JavaScript");
assert(result.safety.linksOpened === false, "Extractor claims to open PDF links");
assert(result.safety.attachmentsExtracted === false, "Extractor claims to extract PDF attachments");
assert(result.safety.networkAccessed === false, "Extractor claims to access the network while parsing");

for (const golden of manifest.goldenPageRoles) {
  const page = result.pages.find((candidate) => candidate.page === golden.page);
  assert(page?.role === golden.role, `Page ${golden.page} role: expected ${golden.role}, received ${page?.role}`);
}

const pageText = (page) => result.pages.find((candidate) => candidate.page === page)?.text || "";
const factChecks = {
  hl_lhc_data_factor: /volume of data[\s\S]{0,80}factor of 10/i,
  minimal_bandwidth_tbps: /4\.8\s*Tbps expected HL-LHC bandwidth/i,
  flexible_bandwidth_tbps: /9\.6\s*Tbps expected HL-LHC bandwidth/i,
  dc_2027_target: /2027:\s*50% of HL-LHC requirements/i,
  dc_2029_target: /2029:\s*100% of HL-LHC requirements \(date and % to be confirmed\)/i,
};
for (const golden of manifest.goldenFacts) {
  assert(factChecks[golden.id]?.test(pageText(golden.page)), `Golden fact ${golden.id} missing from page ${golden.page}`);
}

assert(result.analysis?.title === manifest.document.title, "Presentation title was not reconstructed from the cover");
assert(result.analysis.sourcePageCount === manifest.document.pages, "Presentation analysis lost source page coverage");
const storyText = [
  ...result.analysis.agenda.map((item) => item.text),
  ...result.analysis.storySections.map((item) => item.title),
].join("\n").toLowerCase();
for (const section of manifest.requiredStorySections) {
  assert(storyText.includes(section.toLowerCase()), `Story section ${section} is missing`);
}
assert(result.analysis.summaryPoints.length >= 4, "Presentation summary did not preserve the four source conclusions");
assert(result.analysis.summaryPoints.every((item) => item.page === 47), "Summary points lost their source page mapping");
const highlightText = result.analysis.numericHighlights.map((item) => `${item.text} p.${item.page}`).join("\n");
for (const golden of manifest.goldenFacts) {
  assert(factChecks[golden.id]?.test(highlightText), `Numeric highlights omit ${golden.id}`);
  assert(highlightText.includes(`p.${golden.page}`), `Numeric highlight ${golden.id} lost page ${golden.page}`);
}

const contextExtraction = spawnSync(python, [extractor, pdfPath, "--format", "context", "--max-chars", "120000"], {
  encoding: "utf8",
  timeout: 30_000,
  maxBuffer: 512_000,
  windowsHide: true,
});
assert(contextExtraction.status === 0, "Agent context formatting failed");
assert(contextExtraction.stdout.includes("Presentation analysis:"), "Windows App context omits the presentation analysis block");
assert(contextExtraction.stdout.includes("4.8Tbps expected HL-LHC bandwidth (p.42)"), "Agent context omits numeric source mapping");
assert(contextExtraction.stdout.includes("Conclusions (p.46)"), "Agent context omits story section source mapping");
assert(contextExtraction.stdout.includes("Manager PPTX blueprint:"), "Agent context omits the manager PPTX blueprint");

const blueprint = result.analysis.managerDeckBlueprint;
assert(blueprint.format === "pptx", "Manager deliverable format is not PPTX");
assert(blueprint.slideCount >= manifest.regeneratedPptx.minimumSlides, "Manager deck blueprint has too few slides");
assert(blueprint.slideCount <= manifest.regeneratedPptx.maximumSlides, "Manager deck blueprint has too many slides");
assert(blueprint.language === "zh-CN" && blueprint.audience === "non_expert_managers", "Manager deck audience/language contract changed");
assert(blueprint.minimumSpeakerNotesCoverage >= manifest.regeneratedPptx.minimumSpeakerNotesCoverage, "Speaker-notes contract is too weak");
assert(blueprint.wholePageScreenshotReuseAllowed === false, "Blueprint allows whole-page source screenshots");
assert(blueprint.sourceMappingRequired === true, "Blueprint does not require source mapping");
const blueprintRoles = new Set(blueprint.slides.map((slide) => slide.role));
for (const role of ["cover", "background", "wlcg", "asian_networks", "hl_lhc_requirements", "data_challenges", "conclusions", "sources"]) {
  assert(blueprintRoles.has(role), `Manager deck blueprint omits ${role}`);
}
assert(blueprint.slides.every((slide) => slide.role === "cover" || slide.sourcePages.length > 0), "A factual blueprint slide has no source pages");
assert(blueprint.slides.find((slide) => slide.role === "hl_lhc_requirements")?.sourcePages.includes(42), "HL-LHC requirements slide does not cite page 42");
assert(blueprint.slides.find((slide) => slide.role === "data_challenges")?.sourcePages.includes(43), "Data Challenges slide does not cite page 43");
assert(blueprint.slides.find((slide) => slide.role === "conclusions")?.sourcePages.includes(47), "Conclusions slide does not cite page 47");

const workspaceSource = readFileSync(join(repo, "apps/desktop/windows/../shared/main/workspaceContext.ts"), "utf8");
const channelSource = readFileSync(join(repo, "apps/desktop/windows/src/main/channelAdapters.ts"), "utf8");
const dependencySource = readFileSync(join(repo, "cores/python/packages/drsai/pyproject.toml"), "utf8");
assert(workspaceSource.includes('extension === ".pdf"') && workspaceSource.indexOf('extension === ".pdf"') < workspaceSource.indexOf('size > 2_000_000'), "Large PDFs are still classified as generic large files");
assert(workspaceSource.includes("extractPresentationPdfContext"), "Workspace preview does not use structured PDF extraction");
assert(channelSource.includes("extractPresentationPdfSync"), "File context import does not use structured PDF extraction");
assert(dependencySource.includes('"pypdf==6.10.0"'), "Packaged backend does not declare the PDF parser dependency");

console.log(JSON.stringify({
  ok: true,
  fixture: { path: pdfPath, bytes: bytes.length, sha256 },
  extraction: {
    type: result.type,
    pages: result.pageCount,
    landscapeRatio: result.landscapeRatio,
    medianTextChars: result.medianTextChars,
    pageRoles: Object.fromEntries(manifest.goldenPageRoles.map(({ page }) => [page, result.pages[page - 1].role])),
    goldenFacts: manifest.goldenFacts.map(({ id, page }) => ({ id, page, matched: true })),
    analysis: {
      title: result.analysis.title,
      agendaItems: result.analysis.agenda.length,
      storySections: result.analysis.storySections.length,
      summaryPoints: result.analysis.summaryPoints.length,
      numericHighlights: result.analysis.numericHighlights.length,
      sourceMapped: true,
      managerDeckBlueprint: {
        slides: blueprint.slideCount,
        roles: blueprint.slides.map((slide) => slide.role),
        speakerNotesCoverageRequired: blueprint.minimumSpeakerNotesCoverage,
        wholePageScreenshotReuseAllowed: blueprint.wholePageScreenshotReuseAllowed,
      },
    },
  },
  windowsAppIntegration: {
    largePdfClassification: true,
    workspacePreview: true,
    fileContextImport: true,
    packagedDependency: true,
  },
}, null, 2));

if (existsSync(`${pdfPath}.partial`)) unlinkSync(`${pdfPath}.partial`);
