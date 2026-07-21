import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const cache = join(root, ".cache", "bundled-openssh-contract");
const resources = join(cache, "resources");
const bundledDir = join(resources, "tools", "openssh");
const hostOpenSsh = join(process.env.WINDIR || "C:\\Windows", "System32", "OpenSSH");
const hostCrypto = join(process.env.WINDIR || "C:\\Windows", "System32", "libcrypto.dll");
rmSync(cache, { recursive: true, force: true });
mkdirSync(bundledDir, { recursive: true });
copyFileSync(join(hostOpenSsh, "ssh.exe"), join(bundledDir, "ssh.exe"));
copyFileSync(join(hostOpenSsh, "ssh-keyscan.exe"), join(bundledDir, "ssh-keyscan.exe"));
copyFileSync(join(hostOpenSsh, "scp.exe"), join(bundledDir, "scp.exe"));
copyFileSync(hostCrypto, join(bundledDir, "libcrypto.dll"));

run(process.execPath, ["node_modules/esbuild/bin/esbuild", "src/main/sshExecutable.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=.cache/bundled-openssh-contract/sshExecutable.mjs"]);
Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
const module = await import(pathToFileURL(join(cache, "sshExecutable.mjs")).href + `?t=${Date.now()}`);
const resolved = module.resolveSshExecutable();
assert(resolved === join(bundledDir, "ssh.exe"), `bundled client was not preferred: ${resolved}`);
const version = spawnSync(resolved, ["-V"], { encoding: "utf8", windowsHide: true });
assert(version.status === 0 && `${version.stdout}${version.stderr}`.includes("OpenSSH"), "bundled ssh.exe could not execute");
assert(module.resolveSshKeyscanExecutable() === join(bundledDir, "ssh-keyscan.exe"), "bundled ssh-keyscan.exe was not preferred");
assert(module.resolveScpExecutable() === join(bundledDir, "scp.exe"), "bundled scp.exe was not preferred");

const override = join(cache, "explicit-ssh.exe");
copyFileSync(join(hostOpenSsh, "ssh.exe"), override);
process.env.OPENDRSAI_SSH_EXECUTABLE = override;
assert(module.resolveSshExecutable() === override, "explicit SSH executable override was not honored");

const packager = readFileSync(resolve(root, "..", "installers", "windows", "create-opendrsai-runtime.ps1"), "utf8");
for (const marker of ["Add-BundledOpenSshClient", "resources\\tools\\openssh", "libcrypto.dll", 'ssh = "app/resources/tools/openssh/ssh.exe"', "Get-AuthenticodeSignature"]) {
  assert(packager.includes(marker), `runtime packager lacks ${marker}`);
}
console.log("Bundled OpenSSH verification passed: packaged preference, executable smoke, override, signature and manifest contract.");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
