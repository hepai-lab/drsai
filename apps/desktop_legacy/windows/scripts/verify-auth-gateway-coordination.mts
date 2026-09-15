import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const auth = read("../shared/main/auth.ts");
const gateway = read("../shared/main/gateway.ts");
const bridge = read("../shared/main/authGatewayCoordination.ts");

assert.doesNotMatch(auth, /import\("\.\/gateway"\)/);
assert.doesNotMatch(gateway, /import\("\.\/auth"\)/);
assert.match(auth, /registerAuthContextProvider\(requireAuthContext\)/);
assert.match(auth, /const propagated = await syncCoordinatedGatewayIdentity\(trimmed\)/);
assert.match(auth, /if \(propagated\) lastPropagatedAuthUserId = trimmed/);
assert.match(gateway, /registerGatewayIdentitySynchronizer\(syncAuthIdentityToGateway\)/);
assert.match(gateway, /if \(identityChanged\) await putGatewayJson\("\/v1\/config\/user-name"/, "unchanged identity must not be PUT on every health cycle");
assert.match(gateway, /if \(!probe\.ready\) lastSyncedGatewayUserId = null/, "a replaced Gateway must receive identity on recovery");
assert.equal((gateway.match(/requireCoordinatedAuthContext\(\)/g) ?? []).length, 3);
assert.match(bridge, /if \(!authContextProvider\) throw new Error/);
assert.match(bridge, /if \(!gatewayIdentitySynchronizer\) return null/);

console.log("Auth/Gateway coordination contract verification passed.");
