import assert from "node:assert/strict";
import {
  DEVELOPMENT_GATEWAY_PORT,
  PRODUCTION_GATEWAY_PORT,
  resolveGatewayPort,
} from "../../shared/main/gatewayEnvironment.ts";

assert.equal(resolveGatewayPort({}, true), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_DEV: "1" }, false), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({}, false), PRODUCTION_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_GATEWAY_PORT: "30001" }, false), "30001");
assert.equal(resolveGatewayPort({ DRSAI_API_PORT: "30002" }, false), "30002");
assert.equal(resolveGatewayPort({ OPENDRSAI_DESKTOP_DEV: "1", OPENDRSAI_GATEWAY_PORT: "invalid" }, false), DEVELOPMENT_GATEWAY_PORT);
assert.equal(resolveGatewayPort({ OPENDRSAI_GATEWAY_PORT: "70000" }, false), PRODUCTION_GATEWAY_PORT);

console.log("Gateway environment verification passed (7 checks).");
