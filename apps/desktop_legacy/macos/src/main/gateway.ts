import { configureGatewayPlatform } from "../../../shared/main/gateway";
import { MACOS_PROCESS_SERVICE } from "./platformProcesses";

configureGatewayPlatform({
  processes: MACOS_PROCESS_SERVICE,
  appRuntime: { get isPackaged() { return app.isPackaged; }, getAppPath: () => app.getAppPath() },
});

export * from "../../../shared/main/gateway";
import { app } from "electron";
