import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const previewerDir = join(root, "..", "shared", "renderer", "src", "components", "files", "file_previewer");

const previewers = [
  ["image", "ImagePreviewer.tsx", "preview.kind === \"image\""],
  ["markdown", "MarkdownPreviewer.tsx", "preview.kind === \"markdown\""],
  ["html", "HtmlPreviewer.tsx", "preview.kind === \"html\""],
  ["pdf", "PdfPreviewer.tsx", "preview.kind === \"pdf\""],
  ["config", "StructuredPreviewer.tsx", "preview.kind === \"config\""],
  ["json", "StructuredPreviewer.tsx", "preview.kind === \"json\""],
  ["table", "TablePreviewer.tsx", "preview.kind === \"table\""],
  ["code/text", "TextPreviewer.tsx", "preview.content"],
  ["office", "OfficePreviewer.tsx", "preview.kind === \"office\""],
  ["media", "MediaPreviewer.tsx", "preview.kind === \"media\""],
  ["outline", "OutlinePreviewer.tsx", "preview.outline?.length"],
  ["metadata", "MetadataPreviewer.tsx", "MetadataPreviewer"],
];

const router = readFileSync(join(previewerDir, "FilePreviewer.tsx"), "utf8");
const sharedTypes = readFileSync(join(root, "..", "shared", "api", "desktopApi.ts"), "utf8");
const mainPreview = readFileSync(join(root, "..", "shared", "main", "workspaceContext.ts"), "utf8");

const failures = [];

for (const [kind, fileName, routerNeedle] of previewers) {
  const source = readFileSync(join(previewerDir, fileName), "utf8");
  if (!source.trim()) failures.push(`${kind}: ${fileName} is empty`);
  if (!router.includes(routerNeedle)) failures.push(`${kind}: router is missing ${routerNeedle}`);
}

for (const kind of ["html", "config", "media"]) {
  if (!sharedTypes.includes(`| "${kind}"`)) {
    failures.push(`shared type does not include ${kind}`);
  }
}

const classifierExpectations = [
  [".html", "\"html\""],
  [".htm", "\"html\""],
  ["CONFIG_EXTENSIONS", "\"config\""],
  ["MEDIA_MIME", "\"media\""],
  [".pdf", "\"pdf\""],
  ["OFFICE_EXTENSIONS", "\"office\""],
  [".csv", "\"table\""],
  [".mdx", "\"markdown\""],
];

for (const [needle, result] of classifierExpectations) {
  if (!mainPreview.includes(needle) || !mainPreview.includes(result)) {
    failures.push(`main classifier expectation missing ${needle} -> ${result}`);
  }
}

if (failures.length > 0) {
  console.error("File previewer verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified ${previewers.length} file preview paths.`);
