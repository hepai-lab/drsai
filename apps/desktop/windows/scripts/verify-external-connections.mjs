import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`External connection verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("src/shared/desktopApi.ts");
const readiness = read("src/main/externalConnectionReadiness.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const channelsView = read("src/renderer/src/components/ChannelsView.tsx");
const styles = read("src/renderer/src/styles.css");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const todos = read("docs/external-connections-todos.md");

assert(
  packageJson.includes('"verify:external-connections": "node scripts/verify-external-connections.mjs"'),
  "package script is not registered",
);

assert(api.includes("DesktopExternalConnectionId"), "shared API omits external connection id type");
assert(api.includes("DesktopExternalConnectionReadinessResult"), "shared API omits readiness result type");
assert(api.includes("DesktopExternalReconnectPolicy"), "shared API omits reconnect policy type");
assert(api.includes("reconnectPolicy?: DesktopExternalReconnectPolicy"), "shared API omits optional reconnect policy field");
assert(api.includes("reconnectReadinessChecks?: string[]"), "shared API omits reconnect readiness checks");
assert(api.includes("listExternalConnectionReadiness("), "desktop API omits readiness method");
assert(
    api.includes('| "github"') &&
    api.includes('| "chrome"') &&
    api.includes('| "latex"') &&
    api.includes('| "mobile"') &&
    api.includes('| "slack"') &&
    api.includes('| "docs"') &&
    api.includes('| "calendar"') &&
    api.includes('| "database"') &&
    api.includes('| "log-monitor"') &&
    api.includes('| "unified"'),
  "shared API omits required connection ids",
);

for (const connection of [
  "mobile",
  "github",
  "chrome",
  "latex",
  "slack",
  "docs",
  "calendar",
  "database",
  "log-monitor",
  "unified",
]) {
  assert(readiness.includes(`id: "${connection}"`), `readiness catalog omits ${connection}`);
}

assert(readiness.includes("listChannelAdapters(workspacePath)"), "readiness catalog does not derive from channel adapters");
assert(readiness.includes("mobile-chat") && readiness.includes(".drsai/mobile-context.json"), "readiness catalog omits Mobile connector evidence");
assert(readiness.includes("github-connector"), "readiness catalog omits GitHub connector evidence");
assert(readiness.includes("slack-chat") && readiness.includes(".drsai/slack-context.json"), "readiness catalog omits Slack connector evidence");
assert(readiness.includes("docs-connector") && readiness.includes(".drsai/docs-context.json"), "readiness catalog omits Docs connector evidence");
assert(readiness.includes("calendar-connector") && readiness.includes(".drsai/calendar-context.ics"), "readiness catalog omits Calendar connector evidence");
assert(readiness.includes("database-connector") && readiness.includes(".drsai/database-context.json"), "readiness catalog omits Database connector evidence");
assert(readiness.includes("logs-monitor") && readiness.includes(".drsai/log-monitor.json"), "readiness catalog omits Log monitor evidence");
assert(readiness.includes("reviewed local retention policy hints"), "readiness catalog omits Log monitor retention policy evidence");
assert(readiness.includes("without deleting, rotating, or truncating logs"), "readiness catalog omits no-retention-mutation boundary");
assert(readiness.includes("browser controller approvals"), "readiness catalog omits Chrome/browser approval evidence");
assert(readiness.includes(".tex/.bib/.bibtex/latexmkrc previews"), "readiness catalog omits LaTeX file evidence");
assert(readiness.includes("Approval Center") && readiness.includes("MCP live bridge audit"), "readiness catalog omits unified approval/MCP evidence");
assert(readiness.includes("No OAuth flow, browser process, LaTeX command, provider API call, network request, or workspace mutation was performed"), "readiness catalog omits no-network/no-runtime verification");
assert(readiness.includes("buildReconnectPolicy"), "readiness catalog omits local reconnect policy builder");
assert(readiness.includes("buildReconnectReadinessChecks"), "readiness catalog omits reconnect readiness check builder");
assert(readiness.includes("Local adapter contract is cataloged"), "readiness checks omit local adapter contract evidence");
assert(readiness.includes("Next live gap:"), "readiness checks omit next live gap evidence");
assert(readiness.includes('mode: "manual_review"'), "readiness reconnect policy omits manual review mode");
assert(readiness.includes("automatic: false"), "readiness reconnect policy must not enable autonomous reconnect");
assert(readiness.includes("No credential lookup, OAuth exchange, network request, or remote mutation"), "readiness reconnect policy omits safety boundary");
assert(readiness.includes("no autonomous reconnect or provider runtime was started"), "readiness reconnect policy omits no-runtime verification");

assert(main.includes("listExternalConnectionReadiness") && main.includes("desktop:external-connection-readiness"), "main process omits readiness IPC handler");
assert(preload.includes("listExternalConnectionReadiness") && preload.includes("desktop:external-connection-readiness"), "preload omits readiness bridge");
assert(mock.includes("mockExternalConnectionReadiness") && mock.includes("listExternalConnectionReadiness"), "mock desktop API omits readiness fixture");
assert(mock.includes('id: "slack"') && mock.includes('id: "docs"') && mock.includes('id: "calendar"'), "mock readiness fixture omits expanded connector cards");
assert(mock.includes('id: "mobile"') && mock.includes('id: "database"') && mock.includes('id: "log-monitor"'), "mock readiness fixture omits local channel readiness cards");
assert(mock.includes("buildMockExternalReconnectPolicy"), "mock readiness fixture omits reconnect policy fallback");
assert(mock.includes("buildMockReconnectReadinessChecks"), "mock readiness fixture omits reconnect readiness checks");
assert(mock.includes("Mock reconnect policy is local metadata only"), "mock readiness reconnect policy omits no-runtime evidence");

assert(channelsView.includes("externalReadiness") && channelsView.includes("ExternalReadinessCard"), "Channels view omits readiness rendering");
assert(channelsView.includes("desktopApi.listExternalConnectionReadiness(workspacePath)"), "Channels view does not load readiness from bridge");
assert(channelsView.includes("External connection readiness"), "Channels view omits accessible readiness label");
assert(
  channelsView.includes("external-readiness-gaps") &&
    channelsView.includes("connection.gaps.slice(0, 3)") &&
    channelsView.includes("external-readiness-verification") &&
    channelsView.includes("connection.verification"),
  "Channels view does not expose readiness gaps and verification commitments",
);
assert(
  channelsView.includes("external-readiness-reconnect") &&
    channelsView.includes("Reconnect review") &&
    channelsView.includes("connection.reconnectPolicy.triggers.slice(0, 2)") &&
    channelsView.includes("connection.reconnectPolicy.verification"),
  "Channels view does not expose reconnect policy review details",
);
assert(
  channelsView.includes("external-readiness-checks") &&
    channelsView.includes("Reconnect readiness") &&
    channelsView.includes("connection.reconnectReadinessChecks.slice(0, 4)"),
  "Channels view does not expose reconnect readiness checks",
);
assert(styles.includes(".external-readiness-panel") && styles.includes(".external-readiness-card.partial"), "readiness styles are missing");
assert(
  styles.includes(".external-readiness-gaps") &&
    styles.includes(".external-readiness-verification"),
  "readiness gap and verification styles are missing",
);
assert(styles.includes(".external-readiness-reconnect"), "readiness reconnect policy styles are missing");
assert(styles.includes(".external-readiness-checks"), "readiness reconnect readiness styles are missing");

assert(checklist.includes("external-connection-readiness-agent"), "checklist omits current agent record");
assert(checklist.includes("External Connection Readiness Matrix"), "checklist omits readiness addendum");
assert(checklist.includes("GitHub, Chrome, LaTeX, and unified connection model"), "checklist omits readiness scope");
assert(checklist.includes("external-connection-readiness-expansion-agent"), "checklist omits expanded connector readiness agent record");
assert(checklist.includes("Slack, Docs, and Calendar readiness"), "checklist omits expanded connector readiness scope");
assert(checklist.includes("Mobile, Database, and Log Monitor readiness"), "checklist omits local channel readiness scope");
assert(checklist.includes("External Readiness Gap Detail"), "checklist omits readiness gap detail addendum");
assert(checklist.includes("External Reconnect Policy Review"), "checklist omits reconnect policy addendum");
assert(checklist.includes("External Reconnect Readiness Checks"), "checklist omits reconnect readiness checks addendum");
assert(checklist.includes("no autonomous reconnect or provider runtime was started"), "checklist omits reconnect no-runtime evidence");
assert(checklist.includes("npm run verify:external-connections"), "checklist omits readiness verification command");
assert(roadmap.includes("External connection readiness matrix"), "roadmap omits readiness addendum");
assert(roadmap.includes("Slack, Docs, and Calendar readiness"), "roadmap omits expanded connector readiness addendum");
assert(roadmap.includes("Mobile, Database, and Log Monitor readiness"), "roadmap omits local channel readiness addendum");
assert(roadmap.includes("external readiness gap detail"), "roadmap omits readiness gap detail addendum");
assert(roadmap.includes("external reconnect policy review"), "roadmap omits reconnect policy addendum");
assert(roadmap.includes("external reconnect readiness checks"), "roadmap omits reconnect readiness checks addendum");
assert(
  todos.includes("[~] Mobile") &&
    todos.includes("[~] GitHub") &&
    todos.includes("[~] Chrome") &&
    todos.includes("[~] LaTeX") &&
    todos.includes("[~] Slack") &&
    todos.includes("[~] Docs") &&
    todos.includes("[~] Calendar") &&
    todos.includes("[~] Database") &&
    todos.includes("[~] Log monitor") &&
    todos.includes("[~] Unified connection model"),
  "external connection TODOs were not updated to partial status",
);
assert(todos.includes("local reconnect policy review"), "external connection TODOs omit reconnect policy review");
assert(todos.includes("reconnect readiness checks"), "external connection TODOs omit reconnect readiness checks");

console.log("External connection verification passed.");
