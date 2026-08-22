const { app } = require("electron");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { basename, join, resolve } = require("node:path");

// Select the App-owned profile before Electron becomes ready. The verifier
// delegates OIDC access to the already-running Desktop and never decrypts the
// App's credential file itself.
const explicitHome = process.env.DRSAI_HOME?.trim() || process.env.OPENDRSAI_DEV_HOME?.trim();
const homes = [explicitHome, join(homedir(), ".drsai-dev"), join(homedir(), ".drsai")]
  .filter(Boolean).map((value) => resolve(value));
const home = [...new Set(homes)].find((value) => existsSync(join(value, "runtime", "instance-token")));
if (!home) {
  console.error("Phase 3 real-model nightly smoke blocked: No App-owned profile with a Runtime instance token was found.");
  app.exit(1);
} else {
  app.setPath("userData", join(home, "electron-user-data"));
  if (basename(home) === ".drsai-dev") app.setName("OpenDrSai Dev");
  app.setAppUserModelId(basename(home) === ".drsai-dev" ? "com.hepai.opendrsai.windows.dev" : "com.hepai.opendrsai.windows");
}

if (home) import("./verify-run-traceability-phase3-live-model.mjs").catch((error) => {
  console.error(`Phase 3 real-model nightly smoke blocked: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
