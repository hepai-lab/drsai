import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = readFileSync(resolve(windowsRoot, "../shared/renderer/src/App.tsx"), "utf8");

assert.ok(app.includes("request.finally(() =>"), "chat-choice requests must release their in-flight cache entry after settling");
assert.ok(app.includes("chatChoicesPromiseRef.current.delete(key)"), "settled chat-choice requests must be removable by key");
assert.ok(!app.includes("desktopApi.getMyDrSaiConfig(effectiveWorkspacePath || undefined).catch(() => null)"), "transient model-config failures must not become cacheable null successes");
assert.ok(app.includes("setMyDrSaiConfigLoaded(myDrSaiConfigRef.current !== null)"), "a failed refresh must preserve last-known-good model readiness");
assert.ok(app.includes("scheduleRetry();"), "transient model-config failures must schedule a fresh read");
assert.ok(app.includes("chatChoicesGenerationRef.current += 1"), "a committed model update must invalidate older reads");
assert.ok(app.includes("generation !== chatChoicesGenerationRef.current"), "stale reads must not overwrite a committed model update");
assert.ok(app.includes("chatChoicesPromiseRef.current.clear()"), "model updates must clear in-flight cache ownership");
assert.ok(app.includes("const next: MyDrSaiConfig = current"), "a successful model update must recover even when the initial config read returned no state");
assert.ok(app.includes("modelConnection: connection"), "the recovered config must retain the committed model connection");

console.log("Model configuration state recovery verification passed.");
