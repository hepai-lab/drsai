import type { IpcMain } from "electron";
import {
  getSkillContent,
  gfsDelete,
  gfsDownloadFile,
  gfsHealthcheck,
  gfsList,
  gfsRead,
  gfsShareUrl,
  gfsStat,
  gfsUploadFile,
  gfsWrite,
  installSkill,
  listAvailableSkills,
  listInstalledSkills,
  reloadSkills,
  uninstallSkill,
  updateSkill,
} from "../../../../shared/main/gatewayManagedResources";

export function registerMacosGatewayResourcesIpc(ipcMain: Pick<IpcMain, "handle">): void {
  ipcMain.handle("desktop:list-installed-skills", (_event, request) => listInstalledSkills(request?.userId));
  ipcMain.handle("desktop:list-available-skills", (_event, request) => listAvailableSkills(request?.userId));
  ipcMain.handle("desktop:get-skill-content", (_event, request) => getSkillContent(request.skillPath));
  ipcMain.handle("desktop:install-skill", (_event, request) => installSkill(request));
  ipcMain.handle("desktop:uninstall-skill", (_event, request) => uninstallSkill(request.name, request.userId));
  ipcMain.handle("desktop:update-skill", (_event, request) => updateSkill(request.name, request.content, request.userId));
  ipcMain.handle("desktop:reload-skills", (_event, request) => reloadSkills(request?.threadId, request?.userId));
  ipcMain.handle("desktop:gfs-list", (_event, request) => gfsList(request));
  ipcMain.handle("desktop:gfs-stat", (_event, request) => gfsStat(request.path));
  ipcMain.handle("desktop:gfs-read", (_event, request) => gfsRead(request.path));
  ipcMain.handle("desktop:gfs-write", (_event, request) => gfsWrite(request.path, request.content, request.contentType));
  ipcMain.handle("desktop:gfs-upload-file", (_event, request) => gfsUploadFile(request));
  ipcMain.handle("desktop:gfs-download-file", (_event, request) => gfsDownloadFile(request));
  ipcMain.handle("desktop:gfs-delete", (_event, request) => gfsDelete(request.path));
  ipcMain.handle("desktop:gfs-share-url", (_event, request) => gfsShareUrl(request.path, request.ttlMinutes, request.responseContentType));
  ipcMain.handle("desktop:gfs-healthcheck", () => gfsHealthcheck());
}
