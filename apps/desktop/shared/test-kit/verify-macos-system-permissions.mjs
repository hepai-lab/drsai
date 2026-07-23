import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../macos/src/main/systemPermissions.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../../macos/src/main/index.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../main/preload.ts", import.meta.url), "utf8");
const builder = await readFile(new URL("../../macos/electron-builder.yml", import.meta.url), "utf8");
for (const kind of ["microphone", "notifications", "files", "automation"]) assert.ok(permissions.includes(`\"${kind}\"`));
for (const channel of ["desktop:system-permissions-get", "desktop:system-permission-request", "desktop:system-permission-settings"]) {
  assert.ok(main.includes(channel), `macOS main omits ${channel}.`);
  assert.ok(preload.includes(channel), `preload omits ${channel}.`);
}
assert.match(permissions, /getMediaAccessStatus\("microphone"\)/);
assert.match(permissions, /askForMediaAccess\("microphone"\)/);
assert.match(permissions, /x-apple\.systempreferences:.*Privacy_Microphone/);
assert.match(permissions, /throw new Error\("Unsupported macOS permission kind/);
assert.ok(builder.includes("NSMicrophoneUsageDescription"));
assert.ok(builder.includes("NSAppleEventsUsageDescription"));
console.log("macOS system permission contract passed.");
