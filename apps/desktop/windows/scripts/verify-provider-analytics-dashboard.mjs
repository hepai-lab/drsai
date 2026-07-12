import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Provider analytics dashboard verification failed: ${message}`);
    process.exit(1);
  }
}

const app = read("src/renderer/src/App.tsx");
const navigation = read("src/renderer/src/navigation.ts");
const component = read("src/renderer/src/components/ProviderAnalyticsView.tsx");
const css = read("src/renderer/src/styles.css");
const packageJson = read("package.json");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes('"verify:provider-analytics-dashboard": "node scripts/verify-provider-analytics-dashboard.mjs"'),
  "package script is not registered",
);
assert(
  navigation.includes("{ id: MENU_IDS.usageAnalytics, enabled: true }"),
  "usage analytics navigation is not enabled",
);
assert(
  app.includes("ProviderAnalyticsView") && app.includes("MENU_IDS.usageAnalytics"),
  "App does not route Usage Analytics to ProviderAnalyticsView",
);
assert(
  component.includes("desktopApi.listProviderUsageAnalytics()") &&
    component.includes("desktopApi.listProviderErrorAnalytics()"),
  "dashboard does not read both provider analytics APIs",
);
assert(
    component.includes("AnalyticsKind") &&
    component.includes("ProviderFilter") &&
    component.includes("AnalyticsChartItem") &&
    component.includes("setQuery") &&
    component.includes("copyFilteredJson") &&
    component.includes("copyFilteredCsv") &&
    component.includes("downloadFilteredFile") &&
    component.includes("buildFilteredJson") &&
    component.includes("buildFilteredCsv") &&
    component.includes("chartGroups") &&
    component.includes("chartBarWidth") &&
    component.includes("trendBuckets") &&
    component.includes("toTrendDayKey") &&
    component.includes("chartBarHeight"),
  "dashboard omits filter/search/copy controls",
);
assert(
  component.includes("navigator.clipboard.writeText") &&
    component.includes("JSON.stringify") &&
    component.includes("csvCell") &&
    component.includes("FileSpreadsheet") &&
    component.includes("URL.createObjectURL") &&
    component.includes("new Blob") &&
    component.includes("opendrsai-provider-analytics-") &&
    component.includes("URL.revokeObjectURL") &&
    !component.includes("rawPayload"),
  "dashboard copy/download export is missing CSV/JSON support or exposes raw provider payloads",
);
assert(
  component.includes("expandedRowId") &&
    component.includes("aria-expanded") &&
    component.includes("toSafeAnalyticsRecord"),
  "dashboard omits safe per-record drilldown",
);
assert(
  css.includes(".provider-analytics-view") &&
    css.includes(".provider-analytics-summary-grid") &&
    css.includes(".provider-analytics-table") &&
    css.includes(".provider-analytics-row") &&
    css.includes(".provider-analytics-chart-grid") &&
    css.includes(".provider-analytics-chart-card") &&
    css.includes(".provider-analytics-bar-row") &&
    css.includes(".provider-analytics-trend-card") &&
    css.includes(".provider-analytics-trend-bars") &&
    css.includes(".provider-analytics-trend-stack") &&
    css.includes(".provider-analytics-detail-toggle") &&
    css.includes(".provider-analytics-detail") &&
    css.includes("@media (max-width: 860px)"),
  "dashboard CSS or responsive coverage is missing",
);
assert(
  checklist.includes("provider-analytics-dashboard-agent") &&
    checklist.includes("Provider Analytics Dashboard") &&
    checklist.includes("npm run verify:provider-analytics-dashboard"),
  "checklist omits dashboard agent, addendum, or verifier evidence",
);
assert(
    roadmap.includes("provider analytics dashboard") &&
    roadmap.includes("filter/search/copy JSON") &&
    roadmap.includes("CSV clipboard export and safe per-record drilldown") &&
    roadmap.includes("provider analytics local charts") &&
    roadmap.includes("provider analytics local trend") &&
    roadmap.includes("provider analytics local file export"),
  "roadmap omits dashboard addendum or export/drilldown capability evidence",
);

console.log("Provider analytics dashboard verification passed.");
