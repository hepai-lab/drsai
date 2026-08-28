import assert from "node:assert/strict";
import { findWorkspaceNodeByArtifactPath } from "../../shared/renderer/src/components/files/artifactWorkspaceLink.ts";

const nodes = [{
  name: "artifacts", path: "C:\\工作区\\artifacts", relativePath: "artifacts", type: "directory" as const,
  children: [{
    name: "短诗_静夜.docx", path: "C:\\工作区\\artifacts\\短诗_静夜.docx",
    relativePath: "artifacts/短诗_静夜.docx", type: "file" as const,
  }],
}];

const byRuntimeRelativePath = findWorkspaceNodeByArtifactPath(nodes, "artifacts/短诗_静夜.docx");
assert.equal(byRuntimeRelativePath?.name, "短诗_静夜.docx");

const byWindowsRelativePath = findWorkspaceNodeByArtifactPath(nodes, "artifacts\\短诗_静夜.docx");
assert.equal(byWindowsRelativePath?.path, "C:\\工作区\\artifacts\\短诗_静夜.docx");

const byAbsolutePath = findWorkspaceNodeByArtifactPath(nodes, "C:\\工作区\\artifacts\\短诗_静夜.docx");
assert.equal(byAbsolutePath?.relativePath, "artifacts/短诗_静夜.docx");

assert.equal(findWorkspaceNodeByArtifactPath(nodes, "artifacts/missing.docx"), null);
console.log("Workspace Artifact relative/absolute file-tree linkage test passed.");
