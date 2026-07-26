import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../macos/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [model, adr, index, window, navigation, protocol, runtimePolicy] = await Promise.all([
  read("docs/security/macos-threat-model.md"),
  read("docs/adr/0001-electron-swift-helper.md"),
  read("src/main/index.ts"),
  read("src/main/bootstrap/createWindow.ts"),
  read("src/main/rendererNavigationPolicy.ts"),
  read("native/OpenDrSaiNativeHelper/Sources/OpenDrSaiNativeProtocol/NativeProtocol.swift"),
  read("src/main/runtimeFilesystemPolicy.ts"),
]);

for (const boundary of ["Renderer", "Electron main", "Swift Helper", "文件系统", "Gateway/PTY", "Keychain"]) {
  assert.ok(model.includes(boundary), `Threat model omits trust boundary: ${boundary}`);
}
for (const threat of ["XSS → IPC", "开发 URL/导航注入", "Helper 协议/命令注入", "路径穿越和符号链接逃逸", "Secret 泄漏", "恶意持久状态/审批重放", "子进程逃逸或残留", "工件或更新替换"]) {
  assert.ok(model.includes(threat), `Threat model omits threat: ${threat}`);
}
assert.match(model, /下次强制复核：2026-10-01/);
assert.match(model, /sandbox: false/);
assert.match(adr, /重新评估触发条件/);
assert.match(index, /app\.isPackaged \? undefined : process\.env\.ELECTRON_RENDERER_URL/);
assert.match(index, /if \(app\.isPackaged\) return false/);
for (const control of ["contextIsolation: true", "nodeIntegration: false", "setWindowOpenHandler", 'webContents.on("will-navigate"', "isAllowedRendererNavigation"]) assert.ok(window.includes(control), `Window policy omits ${control}`);
for (const control of ["isLoopback", 'target.protocol === "file:"', "target.origin === expected.origin"]) assert.ok(navigation.includes(control), `Navigation policy omits ${control}`);
for (const control of ["unknown_operation", "invalid_parameters", "allowedParameters", "requestKeys"]) assert.ok(protocol.includes(control), `Helper protocol omits ${control}`);
for (const control of ["readlink", "realpath", "isAbsolute", "assertInside"]) assert.ok(runtimePolicy.includes(control), `Runtime symlink policy omits ${control}`);

console.log("macOS threat model contract passed (8 threats, trust boundaries, navigation, Helper allowlist, paths and sandbox review date).");
