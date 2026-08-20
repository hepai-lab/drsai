const fs = require("node:fs");
const path = require("node:path");

const dependencyFile = path.join(
  __dirname,
  "..",
  "node_modules",
  "mdast-util-gfm-autolink-literal",
  "lib",
  "index.js",
);

const unsupportedPattern =
  "/(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu";
const compatiblePattern = "/([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/g";

if (!fs.existsSync(dependencyFile)) {
  throw new Error(
    "mdast-util-gfm-autolink-literal is not installed; run npm install first.",
  );
}

const source = fs.readFileSync(dependencyFile, "utf8");

if (source.includes(compatiblePattern)) {
  console.log("Markdown autolink compatibility patch is already applied.");
  process.exit(0);
}

if (!source.includes(unsupportedPattern)) {
  throw new Error(
    "Unsupported mdast-util-gfm-autolink-literal source; review the compatibility patch before upgrading.",
  );
}

fs.writeFileSync(
  dependencyFile,
  source.replace(unsupportedPattern, compatiblePattern),
  "utf8",
);

console.log(
  "Patched Markdown email autolinks for browsers without RegExp lookbehind.",
);
