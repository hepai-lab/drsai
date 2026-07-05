import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const roots = [
  "src/renderer/src",
  "scripts",
];
const extensions = new Set([".ts", ".tsx", ".mjs", ".js", ".css", ".html"]);
const mojibakePatterns = [
  "�",
  "ï¿½",
  "Ã",
  "Â",
  "â€",
  "â€™",
  "â€œ",
  "â€�",
  "â€“",
  "â€”",
  "â€¢",
  "â€¦",
  "鏃",
  "鍙",
  "鎵",
  "淇",
  "缃",
  "鏇",
  "璺",
  "鍚",
  "闇",
  "瀹",
  "妗",
  "褰",
  "鎴",
  "鏅",
  "鎶",
  "璧",
  "妫",
  "鍋",
  "姝",
  "",
  "",
];

const failures = [];
for (const relativeRoot of roots) {
  for (const file of walk(join(root, relativeRoot))) {
    if (!extensions.has(extname(file))) continue;
    if (file.endsWith("verify-no-mojibake.mjs")) continue;
    const content = readFileSync(file, "utf8");
    for (const pattern of mojibakePatterns) {
      if (content.includes(pattern)) {
        failures.push(`${file}: contains suspicious mojibake fragment ${JSON.stringify(pattern)}`);
      }
    }
  }
}

if (failures.length) {
  console.error("Mojibake verification failed:");
  for (const failure of failures.slice(0, 80)) console.error(`- ${failure}`);
  if (failures.length > 80) console.error(`- ...and ${failures.length - 80} more`);
  process.exit(1);
}

console.log("Mojibake verification passed.");

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}
