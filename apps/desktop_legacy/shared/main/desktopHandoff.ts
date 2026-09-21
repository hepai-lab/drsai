import { realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DesktopEditCommand, PdfPageOpenRequest, PdfPageOpenResult } from "../api/desktopApi";

const EDIT_COMMANDS = new Set<DesktopEditCommand>(["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"]);

export function normalizeDesktopEditCommand(raw: unknown): DesktopEditCommand | null {
  return typeof raw === "string" && EDIT_COMMANDS.has(raw as DesktopEditCommand) ? raw as DesktopEditCommand : null;
}

export async function openPdfSourcePage(
  raw: unknown,
  options: { assertAllowedPath(path: string): Promise<void>; openExternal(url: string): Promise<void>; launch?: boolean },
): Promise<PdfPageOpenResult> {
  if (!raw || typeof raw !== "object") throw new Error("PDF page request is invalid.");
  const request = raw as Partial<PdfPageOpenRequest>;
  if (typeof request.path !== "string" || !request.path.trim() || /[\r\n\0]/.test(request.path)) throw new Error("PDF source path is invalid.");
  if (!Number.isInteger(request.page) || request.page! < 1 || request.page! > 10_000) throw new Error("Source page must be between 1 and 10000.");
  const path = await realpath(resolve(request.path));
  await options.assertAllowedPath(path);
  if (extname(path).toLowerCase() !== ".pdf") throw new Error("Source page review requires a PDF file.");
  const viewer = pathToFileURL(path); viewer.hash = `page=${request.page}&zoom=page-width`;
  if (options.launch !== false) await options.openExternal(viewer.href);
  return { ok: true, path, page: request.page!, viewerUrl: viewer.href };
}
