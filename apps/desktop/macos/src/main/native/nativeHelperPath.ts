import { app } from "electron";
import { join } from "node:path";
export function nativeHelperExecutablePath(): string { return process.env.OPENDRSAI_NATIVE_HELPER_PATH || (app.isPackaged ? join(process.resourcesPath, "native", "OpenDrSaiNativeHelper") : join(app.getAppPath(), "native", "OpenDrSaiNativeHelper", ".build", "debug", "OpenDrSaiNativeHelper")); }
