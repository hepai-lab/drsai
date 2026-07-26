import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testKitRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKitRoot, "../..");
const setup = readFileSync(resolve(desktopRoot, "macos/scripts/setup-dev.sh"), "utf8");
const dev = readFileSync(resolve(desktopRoot, "macos/scripts/dev.sh"), "utf8");
const auth = readFileSync(resolve(desktopRoot, "shared/main/auth.ts"), "utf8");

assert.match(setup, /uname -s[\s\S]*Darwin/, "development setup must reject non-macOS hosts");
assert.match(setup, /Python 3\.11 or newer/, "development setup must enforce the supported Python baseline");
assert.match(setup, /-m venv/, "development setup must create an isolated Runtime");
assert.match(setup, /pip install[\s\S]*--editable/, "development setup must install the real repository package");
assert.match(setup, /import drsai, fastapi, uvicorn/, "development setup must smoke-test Runtime imports");
assert.match(setup, /npm ci/, "development setup must install the locked Desktop dependency graph");
assert.match(setup, /typecheck --workspace opendrsai-macos-desktop/, "development setup must typecheck the macOS workspace");
assert.doesNotMatch(setup, /stub files|Stub install|python stub|CLI stub/i, "development setup must not advertise or create a fake Runtime");

assert.match(dev, /drsai-agent\/venv\/bin\/python/, "dev launcher must use the isolated Runtime created by setup");
assert.match(dev, /"\$DRSAI_DEV_PYTHON" -m uvicorn/, "dev launcher must not depend on a global uvicorn executable");
assert.match(dev, /kill -0[\s\S]*\/health/, "dev launcher must fail when the Gateway process exits or never becomes healthy");
assert.match(dev, /cleanup 1/, "Gateway startup failure must preserve a non-zero launcher exit status");

assert.doesNotMatch(auth, /createPasswordPlaceholderSession/, "unverified password login must not create a placeholder session");
assert.match(auth, /Password sign-in is unavailable because this desktop build has no password verification service/, "unverified password login must fail closed with actionable guidance");

console.log("macOS real development setup and fail-closed password authentication contract passed.");
