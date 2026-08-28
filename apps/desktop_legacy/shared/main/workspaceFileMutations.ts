import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import type { WorkspaceFileSaveAsRequest, WorkspaceFileSaveAsResult, WorkspaceFileWriteRequest, WorkspaceFileWriteResult } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";
import { previewWorkspaceFile } from "./workspaceContext";

export interface WorkspaceFileDialogService {
  selectSavePath(input: { title: string; suggestedName: string; extension: string }): Promise<string | null>;
}

let dialogService: WorkspaceFileDialogService | null = null;

export function configureWorkspaceFileDialogs(service: WorkspaceFileDialogService): void {
  dialogService = service;
}

export async function saveWorkspaceFileAs(request: WorkspaceFileSaveAsRequest): Promise<WorkspaceFileSaveAsResult> {
  validateBase(request);
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, maxBytes: 8_000 });
  const extension = extname(preview.name).toLowerCase();
  const suggestedName = preserveExtension(request.suggestedName?.trim() ? basename(request.suggestedName) : preview.name, extension);
  const selected = await destination(request.destinationPath, "Save result as", suggestedName, extension);
  const sourceHash = preview.fileHash || await hashFile(preview.path);
  if (!selected) return { canceled: true, sourcePath: preview.path, name: suggestedName, extension, size: preview.size, sourceHash, integrityVerified: false, message: "Save canceled; the source result was not changed." };
  await mkdir(dirname(selected), { recursive: true });
  await copyFile(preview.path, selected);
  const [saved, destinationHash] = await Promise.all([stat(selected), hashFile(selected)]);
  const integrityVerified = saved.isFile() && saved.size === preview.size && destinationHash === sourceHash;
  if (!integrityVerified) throw new Error("The saved copy failed size or SHA-256 verification.");
  return { canceled: false, sourcePath: preview.path, destinationPath: selected, name: basename(selected), extension: extname(selected).toLowerCase(), size: saved.size, sourceHash, destinationHash, integrityVerified, message: "Saved copy verified by file size and SHA-256." };
}

export async function writeWorkspaceFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult> {
  validateBase(request);
  if (typeof request.content !== "string" || Buffer.byteLength(request.content, "utf8") > 1_000_000) throw new Error("Protected text writes are limited to 1 MB.");
  if (!/^sha256:[a-f0-9]{64}$/i.test(request.expectedHash || "")) throw new Error("The hash from the last read is required.");
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, maxBytes: 8_000 });
  const currentHash = preview.fileHash || await hashFile(preview.path);
  const mode = request.mode === "save_as" || request.mode === "overwrite" ? request.mode : "save";
  if (mode !== "save_as" && currentHash !== request.expectedHash) return { status: "conflict", path: preview.path, expectedHash: request.expectedHash, currentHash, savedAs: false, overwroteExternal: false, externalModifiedAt: preview.modifiedAt, externalSize: preview.size, message: "The file changed after it was read. Nothing was overwritten." };
  let target = preview.path;
  if (mode === "save_as") {
    const extension = extname(preview.name).toLowerCase();
    const suggested = preserveExtension(request.suggestedName?.trim() ? basename(request.suggestedName) : `${basename(preview.name, extension)}-my-version${extension}`, extension);
    const selected = await destination(request.destinationPath, "Save my version as", suggested, extension);
    if (!selected) return { status: "canceled", path: preview.path, expectedHash: request.expectedHash, currentHash, savedAs: false, overwroteExternal: false, message: "Save as canceled; the external file was not changed." };
    target = selected;
    if (resolve(target) === resolve(preview.path)) throw new Error("Save as must use a different path.");
    await mkdir(dirname(target), { recursive: true });
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.write-tmp`;
  await writeFile(temporary, request.content, "utf8");
  await replaceFileSafely(temporary, target);
  const savedHash = await hashFile(target);
  return { status: "saved", path: preview.path, expectedHash: request.expectedHash, currentHash, savedHash, destinationPath: target, savedAs: mode === "save_as", overwroteExternal: mode === "overwrite", message: mode === "save_as" ? "Saved the draft to a new file." : mode === "overwrite" ? "The external file was overwritten after a fresh hash check." : "Saved after confirming the file still matched the last read." };
}

async function destination(raw: string | undefined, title: string, suggestedName: string, extension: string): Promise<string | null> {
  if (raw !== undefined) {
    if (typeof raw !== "string" || !isAbsolute(raw)) throw new Error("The save destination must be absolute.");
    return resolve(preserveExtension(raw, extension));
  }
  if (!dialogService) throw new Error("The platform save dialog is not configured.");
  const selected = await dialogService.selectSavePath({ title, suggestedName, extension });
  return selected ? resolve(preserveExtension(selected, extension)) : null;
}

function validateBase(request: { workspacePath?: unknown; path?: unknown }): asserts request is { workspacePath: string; path: string } {
  if (typeof request?.workspacePath !== "string" || !request.workspacePath.trim()) throw new Error("A workspace is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("A source file is required.");
}

function preserveExtension(path: string, extension: string): string {
  if (!extension || extname(path).toLowerCase() === extension) return path;
  return extname(path) ? `${path.slice(0, -extname(path).length)}${extension}` : `${path}${extension}`;
}

async function hashFile(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}
