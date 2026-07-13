import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const checklist = readFileSync(join(root, "docs", "chatbar-capability-checklist.md"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`Chatbar status summary verification failed: ${message}`);
    process.exit(1);
  }
}

const requiredCapabilities = [
  "Capability 1: Natural Language Task Entry",
  "Capability 2: Slash Command Command System",
  "Capability 3: Context Injection",
  "Capability 4: Execution Control",
  "Capability 5: Task Mode Switching",
  "Capability 6: Multi-Agent And Subtask Collaboration",
  "Capability 7: Memory, Skills, And Reusable Workflows",
  "Capability 8: Cross-Channel Chat",
];

const mainMatrixStart = checklist.indexOf("## Capability 1: Natural Language Task Entry");
const remainingWorkStart = checklist.indexOf("## Prioritized Remaining Work");
assert(mainMatrixStart > 0, "main capability matrix is missing");
assert(remainingWorkStart > mainMatrixStart, "prioritized remaining work must follow the capability matrix");

const mainMatrix = checklist.slice(mainMatrixStart, remainingWorkStart);
const statusRows = mainMatrix
  .split(/\r?\n/)
  .filter((line) => /^\| \[(?:x|~| )\] \|/.test(line));

function parseStatusRow(line) {
  const cells = line.split("|").map((cell) => cell.trim());
  return {
    status: cells[1] ?? "",
    feature: cells[2] ?? "",
    evidence: cells[3] ?? "",
    gap: cells[4] ?? "",
    test: cells[5] ?? "",
  };
}

const counts = {
  complete: statusRows.filter((line) => line.startsWith("| [x] |")).length,
  partial: statusRows.filter((line) => line.startsWith("| [~] |")).length,
  notStarted: statusRows.filter((line) => line.startsWith("| [ ] |")).length,
};
const partialDetails = statusRows
  .map(parseStatusRow)
  .filter((row) => row.status === "[~]");
const partialFeatureNames = partialDetails.map((row) => row.feature).filter(Boolean);

const agentAssignmentRules = [
  {
    agent: "provider-runtime-parity-agent",
    category: "Provider/runtime observability",
    features: [
      "Diff/log/tool-call visibility",
      "Browser, terminal, MCP, and connector context",
    ],
  },
  {
    agent: "file-channel-runtime-agent",
    category: "Voice/image/file runtime depth",
    features: [
      "Voice, image, and file input",
      "Voice, image, and file channel inputs",
    ],
  },
  {
    agent: "automation-workflow-agent",
    category: "Background automation and workflows",
    features: [
      "Background and scheduled modes",
      "Workflow marketplace",
    ],
  },
  {
    agent: "merge-review-agent",
    category: "Multi-agent merge review",
    features: [
      "Merge-back review",
    ],
  },
  {
    agent: "live-connector-agent",
    category: "Live external connector sync",
    features: [
      "Mobile chat entry",
      "Slack connector",
      "GitHub connector",
      "Docs connector",
      "Calendar connector",
      "Database connector",
    ],
  },
];

const partialFeatureSet = new Set(partialFeatureNames);
const assignmentSummaries = agentAssignmentRules.map((rule) => {
  const assignedFeatures = rule.features.filter((feature) => partialFeatureSet.has(feature));
  return {
    ...rule,
    assignedFeatures,
  };
}).filter((rule) => rule.assignedFeatures.length > 0);
const assignedFeatureNames = assignmentSummaries.flatMap((rule) => rule.assignedFeatures);

for (const capability of requiredCapabilities) {
  const heading = `## ${capability}`;
  const start = mainMatrix.indexOf(heading);
  assert(start >= 0, `missing ${capability}`);
  const nextHeading = mainMatrix.indexOf("\n## ", start + heading.length);
  const section = nextHeading >= 0 ? mainMatrix.slice(start, nextHeading) : mainMatrix.slice(start);
  const rows = section.split(/\r?\n/).filter((line) => /^\| \[(?:x|~| )\] \|/.test(line));
  assert(rows.length > 0, `${capability} has no status rows`);
  assert(section.includes("| Status | Feature point | Evidence | Gap / risk | Test commitment |"), `${capability} table header is incomplete`);
}

assert(statusRows.length >= 30, `expected at least 30 atomic feature rows, found ${statusRows.length}`);
assert(counts.complete >= 20, `expected at least 20 verified complete feature rows, found ${counts.complete}`);
assert(counts.partial >= 8, `expected at least 8 partial feature rows, found ${counts.partial}`);
assert(counts.notStarted === 0, `main capability matrix still has ${counts.notStarted} unstarted feature rows`);
assert(partialFeatureNames.length === counts.partial, "partial feature summary does not match partial row count");
assert(
  partialDetails.every((row) => row.feature && row.gap && row.test),
  "partial detail summary must include feature, gap, and test commitment for every partial row",
);
assert(
  partialDetails.every((row) => !/^none\b/i.test(row.gap)),
  "partial detail gaps must describe a real remaining risk",
);
assert(
  partialFeatureNames.includes("Voice, image, and file input") &&
    partialFeatureNames.includes("Workflow marketplace"),
  "partial feature summary omits high-priority follow-up rows",
);
assert(assignmentSummaries.length >= 5, "partial agent assignment summary must group work into at least five agents");
assert(
  assignedFeatureNames.length === partialFeatureNames.length,
  "partial agent assignment summary does not cover every partial feature row",
);
assert(
  new Set(assignedFeatureNames).size === assignedFeatureNames.length,
  "partial agent assignment summary assigns a partial feature more than once",
);
assert(
  partialFeatureNames.every((feature) => assignedFeatureNames.includes(feature)),
  "partial agent assignment summary omitted at least one partial feature",
);
assert(
  assignmentSummaries.some((rule) => rule.agent === "live-connector-agent" && rule.assignedFeatures.includes("Slack connector")),
  "live connector partial rows must be assigned to the live connector agent",
);

const remainingLines = checklist
  .slice(remainingWorkStart)
  .split(/\r?\n/)
  .filter((line) => /^\d+\. `\[~\]`/.test(line));
assert(remainingLines.length >= 5, "prioritized remaining work does not list enough partial follow-up groups");
assert(remainingLines.every((line) => line.includes("[~]")), "remaining work must stay tied to partial status markers");

console.log(
  `Chatbar status summary verified: ${counts.complete} complete, ${counts.partial} partial, ${counts.notStarted} not started across ${statusRows.length} feature rows. Partial feature rows: ${partialFeatureNames.join("; ")}.`,
);
console.log(
  `Partial detail summary: ${partialDetails
    .map((row) => `${row.feature} -> gap: ${row.gap} -> test: ${row.test}`)
    .join(" || ")}`,
);
console.log(
  `Agent assignment summary: ${assignmentSummaries
    .map((rule) => `${rule.agent} (${rule.category}) -> ${rule.assignedFeatures.join("; ")}`)
    .join(" || ")}`,
);
