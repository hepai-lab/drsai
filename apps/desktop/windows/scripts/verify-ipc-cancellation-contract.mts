import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const main = read("src/main/index.ts");
const api = read("../shared/api/desktopApi.ts");
const app = read("../shared/renderer/src/App.tsx");
const files = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");

assert.match(main, /controller\.signal\.aborted && error instanceof Error && error\.name === "AbortError"\) return null/);
assert.match(main, /workspaceId, cancelled: true, discovered: 0/);
assert.match(main, /Remote Gateway operation was cancelled\."\) return null/);
assert.match(main, /error instanceof ManagerPresentationCancelledError\) \{\s*return null;/);
assert.match(api, /cancelled\?: boolean/);
assert.match(api, /Promise<RemoteGatewayInstallResult \| null>/);
assert.match(api, /Promise<ManagerPresentationGenerateResult \| null>/);
assert.match(app, /if \(sync\.cancelled\)/);
assert.match(files, /if \(!result\)/);

console.log("Expected IPC cancellation contract verification passed.");
