import assert from "node:assert/strict";
import {
  ARTIFACT_HREF_PREFIX,
  createArtifactLinkPlugin,
  selectInlineArtifactLinks,
  type InlineArtifactLink,
} from "../../shared/renderer/src/artifactLinkPlugin";

const report: InlineArtifactLink = {
  id: "turn:artifact:report",
  label: "HEPiX 2026 信息汇总.md",
  title: "artifacts/hepix2026/HEPiX_2026_信息汇总.md",
  targets: ["HEPiX 2026 信息汇总.md", "artifacts/hepix2026/HEPiX_2026_信息汇总.md"],
  state: "available",
};

const markdown = "工作区路径：`artifacts/hepix2026/HEPiX_2026_信息汇总.md`\n\n交付的 Artifact：`HEPiX 2026 信息汇总.md`";
const selected = selectInlineArtifactLinks(markdown, [report]);
assert.equal(selected.length, 1);
assert.equal(selected[0].match, report.label, "The readable file name must win over an earlier physical-looking path mention.");

const inlineTree = {
  type: "root",
  children: [{ type: "paragraph", children: [
    { type: "text", value: "交付的 Artifact：" },
    { type: "inlineCode", value: report.label },
  ] }],
};
createArtifactLinkPlugin(selected)!()(inlineTree);
const inlineLink = inlineTree.children[0].children[1] as unknown as { type: string; url: string; children: Array<{ value: string }> };
assert.equal(inlineLink.type, "link");
assert.equal(inlineLink.url, `${ARTIFACT_HREF_PREFIX}${encodeURIComponent(report.id)}`);
assert.equal(inlineLink.children[0].value, report.label);

const explicit = selectInlineArtifactLinks(`[下载报告](${report.targets[1]})`, [report]);
const explicitTree = { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: report.targets[1], children: [{ type: "text", value: "下载报告" }] }] }] };
createArtifactLinkPlugin(explicit)!()(explicitTree);
assert.equal(explicitTree.children[0].children[0].url, `${ARTIFACT_HREF_PREFIX}${encodeURIComponent(report.id)}`, "An explicit Markdown link must retain its label while gaining the structured Artifact action.");

assert.deepEqual(selectInlineArtifactLinks("No generated file is mentioned.", [report]), [], "An unmentioned Artifact must remain available to the fallback card renderer.");
const codeTree = { type: "root", children: [{ type: "code", value: report.label }] };
createArtifactLinkPlugin(selected)!()(codeTree);
assert.equal(codeTree.children[0].type, "code", "Fenced code content must never be rewritten as a resource link.");

console.log("Inline Artifact Markdown link projection passed.");
