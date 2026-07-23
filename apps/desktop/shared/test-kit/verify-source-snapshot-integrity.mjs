import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const generator = resolve(scriptRoot, "generate-source-snapshot.mjs");
const snapshotPath = resolve(desktopRoot, "macos/build/acceptance/source-snapshot.json");
const probePath = resolve(desktopRoot, `macos/.source-snapshot-probe-${process.pid}.txt`);
const probeRelativePath = `apps/desktop/macos/.source-snapshot-probe-${process.pid}.txt`;
const linkPath = resolve(desktopRoot, `macos/.source-snapshot-link-${process.pid}`);
const linkRelativePath = `apps/desktop/macos/.source-snapshot-link-${process.pid}`;
const generate = () => {
  execFileSync(process.execPath, [generator], { cwd: desktopRoot, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(readFileSync(snapshotPath, "utf8"));
};

try {
  const firstBytes = Buffer.from("untracked-source-probe-A\n", "utf8");
  const secondBytes = Buffer.from("untracked-source-probe-B\n", "utf8");
  assert.equal(firstBytes.length, secondBytes.length, "probe must detect same-size content replacement");
  writeFileSync(probePath, firstBytes, { flag: "wx" });
  const first = generate();
  const firstEntry = first.files.find((item) => item.path === probeRelativePath);
  assert.equal(first.schemaVersion, 2);
  assert.equal(firstEntry?.kind, "file");
  assert.equal(firstEntry?.sourceState, "untracked");
  assert.equal(firstEntry?.size, firstBytes.length);
  assert.equal(firstEntry?.sha256, createHash("sha256").update(firstBytes).digest("hex"));
  assert.ok(first.untracked.includes(probeRelativePath));

  writeFileSync(probePath, secondBytes);
  const second = generate();
  const secondEntry = second.files.find((item) => item.path === probeRelativePath);
  assert.notEqual(second.aggregateSha256, first.aggregateSha256, "same-size untracked source mutation must change aggregate hash");
  assert.notEqual(secondEntry?.sha256, firstEntry.sha256);

  rmSync(probePath);
  const removed = generate();
  assert.equal(removed.files.some((item) => item.path === probeRelativePath), false);
  assert.equal(removed.untracked.includes(probeRelativePath), false);
  assert.notEqual(removed.aggregateSha256, second.aggregateSha256, "removing untracked source must change aggregate hash");

  let symlinkSupported = true;
  try { symlinkSync("package.json", linkPath, "file"); } catch (error) {
    if (process.platform === "win32" && (error?.code === "EPERM" || error?.code === "EACCES")) symlinkSupported = false;
    else throw error;
  }
  if (symlinkSupported) {
    const linked = generate();
    const linkEntry = linked.files.find((item) => item.path === linkRelativePath);
    assert.equal(linkEntry?.kind, "symlink");
    assert.equal(linkEntry?.sourceState, "untracked");
    assert.equal(linkEntry?.sha256, createHash("sha256").update("package.json").digest("hex"), "symlink hash must bind the link target text without reading through it");
    rmSync(linkPath);
    generate();
  } else {
    const source = readFileSync(generator, "utf8");
    assert.match(source, /lstatSync\(absolutePath\)/);
    assert.match(source, /kind === "symlink" \? Buffer\.from\(readlinkSync\(absolutePath\)/);
  }
  const generatorSource = readFileSync(generator, "utf8");
  assert.match(generatorSource, /update\("\\0deleted\\0\\0"\)/, "deleted tracked paths must have an explicit aggregate sentinel");
  console.log(`Source snapshot v2 untracked mutation/removal, deleted sentinel and symlink-${symlinkSupported ? "runtime" : "structural"} integrity verification passed.`);
} finally {
  rmSync(probePath, { force: true });
  rmSync(linkPath, { force: true });
  generate();
}
