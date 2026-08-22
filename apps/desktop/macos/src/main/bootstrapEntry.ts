import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

declare const __OPENDRSAI_BUILD_CHANNEL__: "development" | "release";

const buildChannel = __OPENDRSAI_BUILD_CHANNEL__;
if (buildChannel === "development") {
  app.setPath("userData", join(app.getPath("appData"), "OpenDrSai Development"));
  const developmentIcon = resolve(process.cwd(), "../../android/app/src/main/res/drawable-nodpi/opendrsai_logo.png");
  void app.whenReady().then(() => app.dock?.setIcon(developmentIcon));
}

const acceptanceOutput = process.env.OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE?.trim();
if (acceptanceOutput) {
  app.setPath("userData", join(dirname(acceptanceOutput), "electron-user-data"));
  if (process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO !== "hepai-provider") {
    app.commandLine.appendSwitch("use-mock-keychain");
  }
}

const reportFailure = (stage: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[opendrsai] macOS ${stage} failed:`, error);
  if (acceptanceOutput) {
    try {
      writeFileSync(`${acceptanceOutput}.startup-error.json`, `${JSON.stringify({
        schemaVersion: 1, stage, message, stack, generatedAt: new Date().toISOString(),
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch { /* stderr remains the fallback diagnostic channel */ }
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }
};

if (acceptanceOutput) {
  process.once("unhandledRejection", (error) => reportFailure("unhandled-rejection", error));
  process.once("uncaughtException", (error) => reportFailure("uncaught-exception", error));
}

void import("./index").catch((error: unknown) => {
  reportFailure("main-bootstrap", error);
  if (!acceptanceOutput) {
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }
});
