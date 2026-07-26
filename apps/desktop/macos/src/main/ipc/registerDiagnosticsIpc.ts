import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, shell, type IpcMain } from "electron";
import { replaceFileSafely } from "../../../../shared/main/atomicFileReplace";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import { normalizeDesktopEditCommand, openPdfSourcePage } from "../../../../shared/main/desktopHandoff";
import { desktopDiagnostics } from "../../../../shared/main/diagnostics";
import { getIdeContext } from "../../../../shared/main/ideContext";
import type { InteractiveDebugPolicyStore } from "../../../../shared/main/interactiveDebugPolicy";
import type { InteractiveDebuggerService } from "../../../../shared/main/interactiveDebugger";
import { productionDiagnostics } from "../../../../shared/main/productionDiagnostics";
import type { DiagnosticSourceNavigator } from "../../../../shared/main/sourceNavigation";
import type { MacosServiceContainer } from "../serviceContainer";

export interface MacosDiagnosticsIpcDependencies {
  sourceNavigator: DiagnosticSourceNavigator;
  interactiveDebugger: InteractiveDebuggerService;
  interactiveDebugPolicy: InteractiveDebugPolicyStore;
}

export function registerMacosDiagnosticsIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
  dependencies: MacosDiagnosticsIpcDependencies,
): void {
  const { sourceNavigator, interactiveDebugger, interactiveDebugPolicy } = dependencies;
  const allowedRoots = () => services.workspace.allowedRoots();

  ipcMain.handle("desktop:diagnostics-record", (_event, input) => desktopDiagnostics.record(input));
  ipcMain.handle("desktop:diagnostics-snapshot", (_event, query) => desktopDiagnostics.snapshot(query ?? {}));
  ipcMain.handle("desktop:diagnostics-clear", async () => ({ cleared: true, removedEvents: await desktopDiagnostics.clear() }));
  ipcMain.handle("desktop:diagnostics-export", async () => {
    const snapshot = await desktopDiagnostics.snapshot({ limit: 5_000 });
    const selected = await dialog.showSaveDialog({ title: "Export OpenDrSai diagnostics", defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.json`), buttonLabel: "Export", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (selected.canceled || !selected.filePath) return { exported: false, eventCount: snapshot.events.length, message: "Diagnostic export cancelled." };
    const temporary = `${selected.filePath}.${process.pid}.${randomUUID()}.diagnostic-tmp`;
    try {
      await writeFile(temporary, await desktopDiagnostics.serializeExport(), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await replaceFileSafely(temporary, selected.filePath);
      await chmod(selected.filePath, 0o600).catch(() => undefined);
    } finally { await rm(temporary, { force: true }); }
    return { exported: true, path: selected.filePath, eventCount: snapshot.events.length, message: "Diagnostic package exported." };
  });
  ipcMain.handle("desktop:diagnostics-issue-update", (_event, request) => desktopDiagnostics.updateIssue(request));
  ipcMain.handle("desktop:diagnostics-source-context", (_event, request) => sourceNavigator.context(request));
  ipcMain.handle("desktop:diagnostics-source-open", async (_event, request) => {
    const resolved = await sourceNavigator.resolveOpenPath(request);
    if (!resolved.path) return { opened: false, ...resolved };
    if (request?.target === "reveal") { shell.showItemInFolder(resolved.path); return { opened: true, ...resolved, message: "Source file revealed in Finder." }; }
    if (request?.target === "editor") {
      const editor = process.env.OPENDRSAI_SOURCE_EDITOR?.trim();
      if (!editor) return { opened: false, ...resolved, message: "No external source editor is configured. Set OPENDRSAI_SOURCE_EDITOR to enable this action." };
      let templates: string[] = ["-g", "{file}:{line}:{column}"];
      try { const configured = JSON.parse(process.env.OPENDRSAI_SOURCE_EDITOR_ARGS || "null"); if (configured !== null && (!Array.isArray(configured) || !configured.every((item) => typeof item === "string"))) throw new Error("invalid"); if (Array.isArray(configured)) templates = configured.slice(0, 20); }
      catch { return { opened: false, ...resolved, message: "OPENDRSAI_SOURCE_EDITOR_ARGS must be a JSON string array." }; }
      const values = { "{file}": resolved.path, "{line}": String(resolved.line ?? 1), "{column}": String(resolved.column ?? 1) };
      const args = templates.map((template) => Object.entries(values).reduce((value, [token, replacement]) => value.replaceAll(token, replacement), template).slice(0, 4_096));
      try { await new Promise<void>((resolveLaunch, rejectLaunch) => execFile(editor, args, { timeout: 10_000, windowsHide: true }, (error) => error ? rejectLaunch(error) : resolveLaunch())); return { opened: true, ...resolved, message: "Source opened in the configured external editor." }; }
      catch { return { opened: false, ...resolved, message: "Configured source editor failed to open the source." }; }
    }
    const error = await shell.openPath(resolved.path);
    return { opened: !error, ...resolved, message: error || "Source file opened with the system application." };
  });
  ipcMain.handle("desktop:production-diagnostics-status", () => productionDiagnostics.status());
  ipcMain.handle("desktop:production-diagnostics-settings", (_event, patch) => productionDiagnostics.update(patch));
  ipcMain.handle("desktop:production-diagnostics-preview", async () => productionDiagnostics.preview(await desktopDiagnostics.serializeExport()));
  ipcMain.handle("desktop:production-diagnostics-export", async () => {
    const preview = await productionDiagnostics.preview(await desktopDiagnostics.serializeExport());
    const selected = await dialog.showSaveDialog({ title: "Export protected OpenDrSai diagnostic package", defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.oddiag`), buttonLabel: "Export", filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, preview, message: "Diagnostic package export cancelled." };
    return productionDiagnostics.exportPackage(await desktopDiagnostics.serializeExport(), selected.filePath);
  });
  ipcMain.handle("desktop:production-diagnostics-import", async () => { const selected = await dialog.showOpenDialog({ title: "Open OpenDrSai diagnostic package", properties: ["openFile"], filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] }); return selected.canceled || !selected.filePaths[0] ? null : productionDiagnostics.importPackage(selected.filePaths[0]); });
  ipcMain.handle("desktop:interactive-debug-targets", () => interactiveDebugger.listTargets());
  ipcMain.handle("desktop:interactive-debug-policy", () => interactiveDebugPolicy.get());
  ipcMain.handle("desktop:interactive-debug-policy-update", async (_event, request) => { const policy = await interactiveDebugPolicy.update(request); if (!policy.enabled) await interactiveDebugger.shutdown(); return policy; });
  ipcMain.handle("desktop:interactive-debug-sessions", () => interactiveDebugger.listSessions());
  ipcMain.handle("desktop:interactive-debug-start", (_event, request) => interactiveDebugger.start(request));
  ipcMain.handle("desktop:interactive-debug-breakpoint", async (_event, request) => { const file = request && typeof request === "object" ? (request as { source?: { file?: unknown } }).source?.file : undefined; if (typeof file !== "string") throw new Error("Breakpoint source file is required."); assertAllowedDesktopPath(file, await allowedRoots()); return interactiveDebugger.setBreakpoint(request); });
  ipcMain.handle("desktop:interactive-debug-control", (_event, request) => interactiveDebugger.control(request));
  ipcMain.handle("desktop:interactive-debug-scopes", (_event, sessionId, frameId) => interactiveDebugger.scopes(sessionId, frameId));
  ipcMain.handle("desktop:interactive-debug-variables", (_event, sessionId, reference) => interactiveDebugger.variables(sessionId, reference));
  ipcMain.handle("desktop:interactive-debug-evaluate", (_event, request) => interactiveDebugger.evaluate(request));
  ipcMain.handle("desktop:edit-command", (event, rawCommand) => { const command = normalizeDesktopEditCommand(rawCommand); if (!command) return false; event.sender[command](); return true; });
  ipcMain.handle("desktop:open-pdf-page", (_event, request) => openPdfSourcePage(request, { assertAllowedPath: async (path) => { assertAllowedDesktopPath(path, await allowedRoots()); }, openExternal: (url) => shell.openExternal(url) }));
  ipcMain.handle("desktop:ide-context", async (_event, workspacePath) => getIdeContext(assertAllowedDesktopPath(workspacePath, await allowedRoots(), { directory: true })));
  ipcMain.handle("desktop:get-file-icon", async (_event, rawPath) => { if (typeof rawPath !== "string") return { path: "", dataUrl: null }; try { const path = assertAllowedDesktopPath(rawPath, await allowedRoots()); const icon = await app.getFileIcon(path, { size: "normal" }); const dataUrl = icon.isEmpty() ? null : icon.toDataURL(); return { path, dataUrl: dataUrl && dataUrl.length <= 1_000_000 ? dataUrl : null }; } catch { return { path: rawPath.slice(0, 2_048), dataUrl: null }; } });
  ipcMain.handle("desktop:pick-files", async () => { const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle("desktop:pick-folder", async () => { const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] }); return result.canceled ? null : result.filePaths[0] || null; });
}
