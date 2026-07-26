import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const [rootArgument, outputArgument] = process.argv.slice(2);
if (!rootArgument || !outputArgument) throw new Error("Usage: generate-runtime-file-inventory.mjs <root> <output>");
const root = resolve(rootArgument);
const files = [];

function visit(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) visit(path);
    else if (info.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), size: info.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
    else throw new Error(`Unsupported Runtime entry: ${path}`);
  }
}

visit(root);
writeFileSync(resolve(outputArgument), `${JSON.stringify(files)}\n`, "utf8");
