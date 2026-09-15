import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const sourceStatus = join(root, "tests", "remote-workspace", "acceptance-status.json");
const plan = resolve(root, "..", "..", "..", "docs", "remote_workespace", "OpenDrSai远程工作区开发方案V1.md");
const baseline = JSON.parse(readFileSync(sourceStatus, "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-acceptance-status-"));

try {
  verifyCase("valid", baseline, true);
  verifyCase("duplicate known failure", mutate((status) => {
    const item = status.verified.pop();
    const failure = { id: item.id, detail: "synthetic known failure" };
    status.knownFailures.push(failure, { ...failure });
  }), false, "Duplicate known failure");
  verifyCase("verified/failure overlap", mutate((status) => status.knownFailures.push({ id: status.verified[0].id, detail: "must fail" })), false, "both verified and a known failure");
  verifyCase("unclassified feature", mutate((status) => status.verified.shift()), false, "must be classified exactly once");
  verifyCase("unknown failure", mutate((status) => status.knownFailures.push({ id: "M99-F99", detail: "must fail" })), false, "not in the plan");
  console.log("Remote Workspace progress regressions passed: valid, duplicate, overlap, omission and unknown-ID cases.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function mutate(change) {
  const status = structuredClone(baseline);
  change(status);
  return status;
}

function verifyCase(name, status, shouldPass, expected = "") {
  const statusPath = join(temporary, `${name.replace(/[^a-z0-9]+/gi, "-")}.json`);
  const reportPath = join(temporary, `${name.replace(/[^a-z0-9]+/gi, "-")}.md`);
  writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
  const result = spawnSync(process.execPath, ["scripts/remote-workspace-progress.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      OPENDRSAI_ACCEPTANCE_STATUS: statusPath,
      OPENDRSAI_ACCEPTANCE_PLAN: plan,
      OPENDRSAI_ACCEPTANCE_REPORT: reportPath,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (shouldPass && result.status !== 0) throw new Error(`${name} unexpectedly failed:\n${output}`);
  if (!shouldPass && (result.status === 0 || !output.includes(expected))) {
    throw new Error(`${name} did not fail with ${JSON.stringify(expected)}:\n${output}`);
  }
}
