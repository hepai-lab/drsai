const { existsSync, readdirSync, rmSync } = require("node:fs");
const { join, relative, sep } = require("node:path");
const normalizeNativePermissions = require("./after-pack-native-permissions.cjs");

module.exports = async function prepareThinUpdatePackage(context) {
  await normalizeNativePermissions(context);
  if (process.platform !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const runtime = join(app, "Contents", "Resources", "runtime");
  const relation = relative(app, runtime);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Update Runtime directory escaped the packaged App.");
  if (!existsSync(runtime)) throw new Error("Update package is missing Runtime metadata.");
  for (const name of readdirSync(runtime)) {
    if (name.endsWith(".tar.gz")) rmSync(join(runtime, name), { force: true });
  }
  if (readdirSync(runtime).some((name) => name.endsWith(".tar.gz"))) throw new Error("Thin update package still contains a bundled Runtime archive.");
  if (!existsSync(join(runtime, "runtime-manifest.json"))) throw new Error("Thin update package must retain Runtime compatibility metadata.");
};
