import assert from "node:assert/strict";
import {
  DEVELOPMENT_GATEWAY_PORT,
  PRODUCTION_GATEWAY_PORT,
  gatewayProfileForHome,
  resolveGatewayPort,
} from "../../shared/main/gatewayEnvironment.ts";

assert.equal(resolveGatewayPort({}, true), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_DEV: "1" }, false), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_LAUNCH_MODE: "production" }, true), PRODUCTION_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_DEV: "0" }, true), PRODUCTION_GATEWAY_PORT);
assert.equal(resolveGatewayPort({}, false), PRODUCTION_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_GATEWAY_PORT: "30001" }, false), "30001");
assert.equal(resolveGatewayPort({ DRSAI_API_PORT: "30002" }, false), "30002");
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_DEV: "1", OPENDRSAI_GATEWAY_PORT: "invalid" }, false), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_GATEWAY_PORT: "70000" }, false), PRODUCTION_GATEWAY_PORT);
assert.equal(gatewayProfileForHome("C:\\Users\\tester\\.drsai-dev\\"), "development");
assert.equal(gatewayProfileForHome("/Users/tester/.drsai"), "production");
assert.equal(gatewayProfileForHome("/Users/tester/.drsai-prod/"), "production");
assert.equal(gatewayProfileForHome("/tmp/isolated-acceptance"), null);
assert.equal(
  resolveGatewayPort({ DRSAI_HOME: "C:\\Users\\tester\\.drsai-dev", OPENDRSAI_DESKTOP_DEV: "0" }, false),
  DEVELOPMENT_GATEWAY_PORT,
  "the .drsai-dev data domain must use its development port even in a packaged Electron binary",
);
assert.equal(
  resolveGatewayPort({ DRSAI_HOME: "C:\\Users\\tester\\.drsai" }, true),
  PRODUCTION_GATEWAY_PORT,
  "the production data domain must not move to the development port merely because Electron is defaultApp",
);
assert.equal(
  resolveGatewayPort({ DRSAI_HOME: "/Users/tester/.drsai-dev", OPENDRSAI_GATEWAY_PORT: "31000" }, false),
  "31000",
  "an explicit acceptance port must override the well-known data-domain port",
);
assert.equal(
  resolveGatewayPort({ DRSAI_HOME: "/Users/tester/.drsai-dev", OPENDRSAI_GATEWAY_PORT: "invalid" }, false),
  DEVELOPMENT_GATEWAY_PORT,
);

console.log("Gateway environment verification passed (17 checks).");
