import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Provider analytics API verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const desktopApi = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
const mockApi = read("src/renderer/src/mockDesktopApi.ts");
const usageStore = read("src/main/providerUsageAnalytics.ts");
const errorStore = read("src/main/providerErrorAnalytics.ts");

assert(
  packageJson.includes('"verify:provider-analytics-api": "node scripts/verify-provider-analytics-api.mjs"'),
  "package script is not registered",
);
assert(
  desktopApi.includes("DesktopProviderUsageAnalyticsRecord") &&
    desktopApi.includes("DesktopProviderErrorAnalyticsRecord") &&
    desktopApi.includes("listProviderUsageAnalytics()") &&
    desktopApi.includes("listProviderErrorAnalytics()"),
  "shared DesktopApi contract omits provider analytics read methods",
);
assert(
  preload.includes('ipcRenderer.invoke("desktop:provider-usage-analytics-list")') &&
    preload.includes('ipcRenderer.invoke("desktop:provider-error-analytics-list")'),
  "preload bridge omits provider analytics IPC methods",
);
assert(
  main.includes("listProviderUsageAnalytics") &&
    main.includes("listProviderErrorAnalytics") &&
    main.includes('secureHandle("desktop:provider-usage-analytics-list"') &&
    main.includes('secureHandle("desktop:provider-error-analytics-list"'),
  "main process omits secure provider analytics read handlers",
);
assert(
  mockApi.includes("listProviderUsageAnalytics") &&
    mockApi.includes("provider-usage:mock") &&
    mockApi.includes("listProviderErrorAnalytics") &&
    mockApi.includes("provider-error:mock"),
  "renderer mock API omits provider analytics read fixtures",
);
assert(
  usageStore.includes("MAX_PROVIDER_USAGE_RECORDS = 200") &&
    errorStore.includes("MAX_PROVIDER_ERROR_RECORDS = 200"),
  "provider analytics stores must keep bounded local retention",
);
assert(
  !desktopApi.includes("rawPayload") &&
    !preload.includes("rawPayload") &&
    !mockApi.includes("rawPayload"),
  "provider analytics read API exposes raw provider payload fields",
);

console.log("Provider analytics API verification passed.");
