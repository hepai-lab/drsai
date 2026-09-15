import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(relativePath, filename) {
  const source = readFileSync(join(process.cwd(), relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename }).runInNewContext({ exports: module.exports, module, require });
  return module.exports;
}

const { createCitationMarkerPlugin, CITATION_HREF_PREFIX } =
  load("../shared/renderer/src/citationMarkerPlugin.ts", "citationMarkerPlugin.ts");
const { projectCitationParts, locatorLineRange } =
  load("../shared/api/citations.ts", "citations.ts");

const citations = [
  { marker: 1, citationId: "c-one", label: "overview.md", title: "overview.md · L12-30" },
  { marker: 2, citationId: "c-two", label: "runtime.md", title: "runtime.md · L4" },
];

function paragraph(value) {
  return { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value }] }] };
}

function run(tree, links = citations) {
  createCitationMarkerPlugin(links)()(tree);
  return tree.children[0].children;
}

// A marker is plumbing for the support check. The reader needs the document it
// names, not the number, so it is rendered as the file it stands for.
{
  const nodes = run(paragraph("Session 表示一段会话。[E1] 后面还有话。"));
  assert.deepEqual(nodes.map((node) => node.type), ["text", "link", "text"]);
  assert.equal(nodes[1].url, `${CITATION_HREF_PREFIX}c-one`);
  assert.equal(nodes[1].children[0].value, "overview.md");
  assert.equal(nodes[1].title, "overview.md · L12-30");
  assert.equal(nodes[0].value, "Session 表示一段会话。");
  assert.equal(nodes[2].value, " 后面还有话。");
}

// Two markers in one sentence must both resolve, and each to its own document.
{
  const nodes = run(paragraph("两处依据。[E1][E2]"));
  const links = nodes.filter((node) => node.type === "link");
  assert.deepEqual(links.map((node) => node.url), [`${CITATION_HREF_PREFIX}c-one`, `${CITATION_HREF_PREFIX}c-two`]);
}

// An invented marker stays exactly as the model wrote it. Deleting it would
// hide the very defect the per-sentence support check exists to surface.
{
  const nodes = run(paragraph("第四个结论。[E4]"));
  assert.deepEqual(nodes.map((node) => node.type), ["text"]);
  assert.equal(nodes[0].value, "第四个结论。[E4]");
}

// Inside code a marker is content the answer is quoting, not apparatus.
{
  const tree = {
    type: "root",
    children: [
      { type: "code", value: "print('[E1]')" },
      { type: "paragraph", children: [{ type: "inlineCode", value: "[E1]" }] },
    ],
  };
  createCitationMarkerPlugin(citations)()(tree);
  assert.equal(tree.children[0].value, "print('[E1]')");
  assert.equal(tree.children[1].children[0].type, "inlineCode");
}

// Ordinary chat carries no citations and must not pay for a tree walk.
assert.equal(createCitationMarkerPlugin([]), undefined);

// Text with no marker is left untouched rather than rebuilt.
{
  const tree = paragraph("没有任何标记的一段话。");
  const before = tree.children[0].children[0];
  createCitationMarkerPlugin(citations)()(tree);
  assert.equal(tree.children[0].children.length, 1);
  assert.equal(tree.children[0].children[0], before);
}

// The renderer cannot open a Knowledge Base document without the base id: the
// path is relative to a corpus root nothing else in the app knows.
{
  const parts = projectCitationParts("item-1", [{
    citation_id: "k-1",
    knowledge_base_id: "runtime-test",
    document_path: "docs/overview.md",
    title: "overview.md",
    excerpt: "Session 表示一段持续的用户会话。",
    locator: { kind: "line", line_start: 12, line_end: 30 },
  }], "completed", "answer");

  assert.equal(parts.length, 1);
  assert.equal(parts[0].knowledgeBaseId, "runtime-test");
  assert.equal(parts[0].documentPath, "docs/overview.md");
  assert.equal(parts[0].lineStart, 12);
  assert.equal(parts[0].lineEnd, 30);
}

// A single-line locator carries no end, and must not be dropped for it.
// Compared field by field: the module runs in its own realm, so its objects do
// not share this file's Object prototype.
{
  const range = locatorLineRange({ locator: { kind: "line", line_start: 7 } });
  assert.equal(range.start, 7);
  assert.equal(range.end, 7);
}

// A page locator has no lines. Guessing one would mark a position the citation
// never claimed, which reads as verified and is worse than marking nothing.
assert.equal(locatorLineRange({ locator: { kind: "page", page: 3 } }), undefined);
assert.equal(locatorLineRange({}), undefined);

console.log("grounded citation projection and marker linking verified");

// react-markdown sanitises hrefs: anything whose scheme is not http/https/
// mailto/tel becomes an empty string. That silently disarmed every citation
// link — it rendered, and clicking it did nothing. Locking the contract here
// because the failure is invisible in the markup.
{
  const { defaultUrlTransform } = await import("react-markdown");
  assert.equal(defaultUrlTransform(`${CITATION_HREF_PREFIX}abc123`), "");
  const transform = (url) => url.startsWith(CITATION_HREF_PREFIX) ? url : defaultUrlTransform(url);
  assert.equal(transform(`${CITATION_HREF_PREFIX}abc123`), `${CITATION_HREF_PREFIX}abc123`);
  // The allowance is exactly one scheme wide: everything else still sanitises.
  assert.equal(transform("javascript:alert(1)"), "");
  assert.equal(transform("https://example.org/a"), "https://example.org/a");
  assert.equal(transform("./relative/path.md"), "./relative/path.md");
}

console.log("citation href survives markdown url sanitising");
