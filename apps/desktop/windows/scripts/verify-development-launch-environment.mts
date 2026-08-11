import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveDevelopmentLaunchEnvironment } from "../src/main/developmentLaunchEnvironment";

const userHome = process.platform === "win32" ? "C:\\Users\\developer" : "/home/developer";
const inheritedProductionHome = process.platform === "win32" ? "C:\\Users\\developer\\.drsai" : "/home/developer/.drsai";
const defaults = resolveDevelopmentLaunchEnvironment({
  defaultApp: true,
  argv: ["electron"],
  userHome,
  environment: { DRSAI_HOME: inheritedProductionHome, OPENDRSAI_GATEWAY_PORT: "18642" },
});
assert.equal(defaults.DRSAI_HOME, resolve(userHome, ".drsai-dev"));
assert.equal(defaults.OPENDRSAI_GATEWAY_PORT, "28642");
assert.equal(defaults.OPENDRSAI_ELECTRON_USER_DATA, resolve(userHome, ".drsai-dev", "electron-user-data"));
assert.equal(defaults.OPENDRSAI_DESKTOP_DEV, "1");
assert.equal(defaults.OPENDRSAI_DEEP_LINK_PROTOCOL, "opendrsai-dev");

const customHome = resolve(userHome, ".drsai-dev-feature");
const custom = resolveDevelopmentLaunchEnvironment({
  defaultApp: true,
  argv: ["electron"],
  userHome,
  environment: { OPENDRSAI_DEV_HOME: customHome, OPENDRSAI_DEV_GATEWAY_PORT: "29642" },
});
assert.equal(custom.DRSAI_HOME, customHome);
assert.equal(custom.OPENDRSAI_GATEWAY_PORT, "29642");
assert.equal(custom.OPENDRSAI_RUNTIME_ROOT, resolve(customHome, "drsai-agent"));

assert.deepEqual(resolveDevelopmentLaunchEnvironment({
  defaultApp: false,
  argv: ["OpenDrSai.exe"],
  userHome,
  environment: {},
}), {});

console.log("Development protocol-launch environment verification passed.");
