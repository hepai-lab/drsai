/** @deprecated M3 compatibility entrypoint. Import from shared/main instead. */
import { app } from "electron";
import { configureGatewayPlatform } from "../../../shared/main/gateway";
import { WINDOWS_PROCESS_SERVICE } from "./platformProcesses";

configureGatewayPlatform({
  processes: WINDOWS_PROCESS_SERVICE,
  appRuntime: { get isPackaged() { return app.isPackaged; }, getAppPath: () => app.getAppPath() },
});

export * from "../../../shared/main/gateway";
