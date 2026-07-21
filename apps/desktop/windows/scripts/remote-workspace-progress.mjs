import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptsDir, "..");
const repoRoot = resolve(appRoot, "..", "..", "..");
const statusPath = process.env.OPENDRSAI_ACCEPTANCE_STATUS
  ? resolve(process.env.OPENDRSAI_ACCEPTANCE_STATUS)
  : resolve(appRoot, "tests", "remote-workspace", "acceptance-status.json");
const reportPath = process.env.OPENDRSAI_ACCEPTANCE_REPORT
  ? resolve(process.env.OPENDRSAI_ACCEPTANCE_REPORT)
  : resolve(repoRoot, "docs", "remote_workespace", "OpenDrSai远程工作区开发进度.md");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
if (status.schemaVersion !== 1) throw new Error("Acceptance status schemaVersion must be 1.");
if (!Number.isFinite(Date.parse(status.updatedAt))) throw new Error("Acceptance status updatedAt must be a valid timestamp.");
if (!String(status.plan || "").trim()) throw new Error("Acceptance status must reference its development plan.");
if (!Array.isArray(status.verified) || !Array.isArray(status.knownFailures)) {
  throw new Error("Acceptance status verified and knownFailures must be arrays.");
}
const planPath = process.env.OPENDRSAI_ACCEPTANCE_PLAN
  ? resolve(process.env.OPENDRSAI_ACCEPTANCE_PLAN)
  : resolve(dirname(statusPath), status.plan);
const plan = readFileSync(planPath, "utf8");

function splitMarkdownRow(line) {
  const cells = [];
  let current = "";
  let inCode = false;
  for (const character of line.slice(1, -1)) {
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

const rows = plan.split(/\r?\n/)
  .filter((line) => /^\|\s*M\d{2}-F\d{2}\s*\|/.test(line))
  .map((line) => {
    const [id, title, acceptance] = splitMarkdownRow(line);
    return { id, title, acceptance };
  });
const byId = new Map(rows.map((row) => [row.id, row]));
if (rows.length !== 110 || byId.size !== 110) {
  throw new Error(`Development plan must contain 110 unique feature points; rows=${rows.length}, unique=${byId.size}.`);
}

const verified = new Map();
for (const item of status.verified ?? []) {
  if (!byId.has(item.id)) throw new Error(`Verified feature is not in the plan: ${item.id}`);
  if (verified.has(item.id)) throw new Error(`Duplicate verified feature: ${item.id}`);
  if (!String(item.evidence || "").trim() || !String(item.detail || "").trim()) throw new Error(`Verified feature lacks evidence: ${item.id}`);
  verified.set(item.id, item);
}
const knownFailures = new Map();
for (const item of status.knownFailures) {
  if (!byId.has(item.id)) throw new Error(`Known failure is not in the plan: ${item.id}`);
  if (knownFailures.has(item.id)) throw new Error(`Duplicate known failure: ${item.id}`);
  if (verified.has(item.id)) throw new Error(`Feature cannot be both verified and a known failure: ${item.id}`);
  if (!String(item.detail || "").trim()) throw new Error(`Known failure lacks detail: ${item.id}`);
  knownFailures.set(item.id, item);
}
const classified = new Set([...verified.keys(), ...knownFailures.keys()]);
const unclassified = [...byId.keys()].filter((id) => !classified.has(id));
if (classified.size !== byId.size || unclassified.length) {
  throw new Error(`Every planned feature must be classified exactly once; classified=${classified.size}, planned=${byId.size}, missing=${unclassified.join(",") || "none"}.`);
}

const expectedCounts = [8, 8, 9, 9, 8, 12, 8, 12, 10, 8, 7, 11];
const moduleRows = expectedCounts.map((expected, index) => {
  const module = `M${String(index + 1).padStart(2, "0")}`;
  const total = rows.filter((row) => row.id.startsWith(`${module}-`)).length;
  if (total !== expected) throw new Error(`${module} count drifted: expected=${expected}, actual=${total}`);
  const done = [...verified].filter(([id]) => id.startsWith(`${module}-`)).length;
  return { module, done, total };
});

const completed = verified.size;
const lines = [
  "# OpenDrSai 远程工作区开发进度",
  "",
  `> 更新：${status.updatedAt}`,
  `> 总进度：**${completed}/110**；只有具备直接、可复现验收证据的功能点才计为完成。`,
  "",
  "| 模块 | 已验收 | 总数 | 状态 |",
  "| --- | ---: | ---: | --- |",
  ...moduleRows.map(({ module, done, total }) => `| ${module} | ${done} | ${total} | ${done === total ? "完成" : done ? "进行中" : "未验收"} |`),
  "",
  "## 已验收功能点",
  "",
  ...(completed ? [...verified].map(([id, item]) => `- **${id} ${byId.get(id).title}**：${item.detail} 证据：\`${item.evidence}\``) : ["- 暂无。"]),
  "",
  "## 当前已知失败",
  "",
  ...([...knownFailures.values()].map((item) => `- **${item.id} ${byId.get(item.id).title}**：${item.detail}`)),
  "",
];
const output = lines.join("\n");
if (process.argv.includes("--write")) {
  writeFileSync(reportPath, output, "utf8");
  console.log(`Remote workspace progress report written: ${reportPath}`);
}
console.log(`Remote workspace verified progress: ${completed}/110`);
for (const row of moduleRows) console.log(`${row.module} ${row.done}/${row.total}`);
