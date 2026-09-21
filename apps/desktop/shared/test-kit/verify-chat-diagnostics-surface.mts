import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Resolve sibling sources from the entry path the runner was given rather than
// from `import.meta.url`: the bundled runner executes a copy under a temporary
// directory, so module-relative paths would resolve outside the checkout. Both
// runners pass the entry as argv[2], so this works either way.
const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-chat-diagnostics-surface.mts");
const read = (path: string) => readFile(join(dirname(entryFile), path), "utf8");
const [app, navigation, panel, settings, workspace] = await Promise.all([
  read("../renderer/src/App.tsx"),
  read("../renderer/src/navigation.ts"),
  read("../renderer/src/components/diagnostics/ChatDiagnosticsPanel.tsx"),
  read("../renderer/src/components/SettingsPanel.tsx"),
  read("../renderer/src/components/WorkspaceShell.tsx"),
]);

assert.match(app, /useState<RightTab>\("files"\)/, "files must remain the initial right tab");
assert.match(navigation, /\["files",\s*"diagnostics"\]/, "files must remain first in right-tab order");
assert.match(app, /setActiveRightTab\("diagnostics"\)/, "diagnostics recovery must open the diagnostics tab");
assert.match(app, /errorPresentation\?\.traceId\s*\?\?\s*diagnosticMessage\?\.runtimeRunId/, "diagnostics must use the error trace with the run id as fallback");
assert.match(app, /activeRightTab === "diagnostics"[\s\S]*?<ChatDiagnosticsPanel/, "diagnostics tab must render its dedicated panel");
assert.match(panel, /desktopApi\.getRedactedDiagnosticTrace\(traceId\)/, "panel must query only the narrow redacted trace API");
assert.doesNotMatch(panel, /desktopApi\.(getDiagnosticSnapshot|exportDiagnostics|copyDiagnostics)/, "chat diagnostics must not query broad diagnostic APIs");
assert.match(settings, /\(\["files",\s*"diagnostics"\]/, "both right tabs must remain configurable");
assert.match(workspace, /rightTabs\.some\(\(\{ id \}\) => id === activeRightTab\)/, "workspace must preserve externally activated diagnostic tabs");

console.log("Chat diagnostics surface wiring verification passed.");
