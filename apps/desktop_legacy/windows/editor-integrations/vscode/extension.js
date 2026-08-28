"use strict";

const fs = require("fs/promises");
const path = require("path");
const vscode = require("vscode");

const CONTEXT_RELATIVE_PATH = path.join(".drsai", "ide-context.json");
const MAX_SELECTION_CHARS = 12000;
const WRITE_DEBOUNCE_MS = 150;

let pendingWriteTimer = undefined;

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("opendrsai.captureIdeContext", () => captureIdeContext()),
    vscode.commands.registerCommand("opendrsai.openIdeContextFile", () => openIdeContextFile()),
    vscode.window.onDidChangeActiveTextEditor(() => scheduleCapture()),
    vscode.window.onDidChangeTextEditorSelection(() => scheduleCapture()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && event.document === activeEditor.document) {
        scheduleCapture();
      }
    }),
  );
  scheduleCapture();
}

function deactivate() {
  if (pendingWriteTimer) clearTimeout(pendingWriteTimer);
}

function scheduleCapture() {
  if (!isEnabled()) return;
  if (pendingWriteTimer) clearTimeout(pendingWriteTimer);
  pendingWriteTimer = setTimeout(() => {
    pendingWriteTimer = undefined;
    captureIdeContext().catch((error) => {
      console.warn(`[OpenDrSai] Failed to write IDE context: ${formatError(error)}`);
    });
  }, WRITE_DEBOUNCE_MS);
}

async function captureIdeContext() {
  if (!isEnabled()) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const workspaceRoot = workspaceFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const documentPath = editor.document.uri.fsPath;
  const relativePath = getWorkspaceRelativePath(workspaceRoot, documentPath);
  if (!relativePath) return;

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection).replace(/\u0000/g, "");
  const selectionText = selectedText.trim();
  const capturedAt = new Date().toISOString();
  const payload = {
    source: "vscode",
    capturedAt,
    currentFile: {
      path: documentPath,
      relativePath,
      language: editor.document.languageId,
      line: selection.active.line + 1,
      column: selection.active.character + 1,
    },
  };

  if (selectionText) {
    payload.currentSelection = {
      path: documentPath,
      relativePath,
      text: selectionText.slice(0, MAX_SELECTION_CHARS),
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
      language: editor.document.languageId,
      truncated: selectionText.length > MAX_SELECTION_CHARS,
    };
  }

  await writeWorkspaceContext(workspaceRoot, payload);
}

async function openIdeContextFile() {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage("OpenDrSai needs an open workspace before it can write IDE context.");
    return;
  }
  await captureIdeContext();
  const contextFile = vscode.Uri.file(path.join(workspaceRoot, CONTEXT_RELATIVE_PATH));
  const document = await vscode.workspace.openTextDocument(contextFile);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function writeWorkspaceContext(workspaceRoot, payload) {
  const contextPath = path.join(workspaceRoot, CONTEXT_RELATIVE_PATH);
  if (!isInsidePath(workspaceRoot, contextPath)) return;
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  const tempPath = `${contextPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, contextPath);
}

function isEnabled() {
  return vscode.workspace
    .getConfiguration("opendrsai.ideContext")
    .get("enabled", true);
}

function getWorkspaceRelativePath(workspaceRoot, filePath) {
  if (!isInsidePath(workspaceRoot, filePath)) return null;
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

function isInsidePath(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = {
  activate,
  deactivate,
};
