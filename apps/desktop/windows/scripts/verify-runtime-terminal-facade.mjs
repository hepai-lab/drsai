import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const terminal = readFileSync(resolve(root, "src/main/terminal.ts"), "utf8");
const runtimeClient = readFileSync(resolve(root, "src/main/runtimeClient.ts"), "utf8");
const gateway = readFileSync(resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
const panel = readFileSync(resolve(root, "src/renderer/src/components/TerminalPanel.tsx"), "utf8");

for (const operation of ["pty.create", "pty.attach", "pty.write", "pty.resize", "pty.detach", "pty.kill"]) {
  assert(terminal.includes(`"${operation}"`), `Terminal Runtime Facade does not use ${operation}`);
}
assert.match(terminal, /if \(options\.workspaceId\)[\s\S]*createRuntimeTerminalSession/,
  "Local Workspace Terminal does not default to Runtime ownership");
assert.match(terminal, /OPENDRSAI_ENABLE_LEGACY_DESKTOP_PTY/,
  "Legacy Electron PTY path is not explicitly gated");
assert.match(terminal, /destroyed[\s\S]*detachTerminalsForOwner/,
  "WebContents destruction does not detach Runtime Terminal leases");
assert.match(terminal, /executeOWOP\(session\.workspaceId, "pty\.detach"/,
  "Detach does not go through OWOP");
assert.match(terminal, /else if \(session\.remoteSocket\)[\s\S]*session\.detached = true;[\s\S]*session\.remoteSocket\.close\(\)/,
  "Remote Renderer destruction still kills the Runtime PTY instead of detaching its subscriber");
assert.match(runtimeClient, /binding: \{ kind: this\.location === "local" \? "local_ipc" : "ssh" \}/,
  "Local and Remote Terminal operations do not share OWOP with Binding-only transport differences");
assert.match(gateway, /TerminalStateService[\s\S]*RuntimeTerminalOWOPOperations/,
  "Gateway does not own Terminal state and expose the OWOP adapter");
const projection = terminal.match(/interface TerminalProjection \{([\s\S]*?)\}/)?.[1] || "";
assert.match(projection, /sequence: number; generation: number;/,
  "Desktop Terminal projection does not persist replay cursor and generation");
assert.doesNotMatch(projection, /buffer|screen|snapshot/,
  "Desktop persists an authoritative Terminal buffer or screen");
assert.match(terminal, /terminal-projections\.json/,
  "Desktop Terminal cursor projection is not durable across Main-process restart");
assert.match(panel, /terminalSelectionKey[\s\S]*terminalShellKey/,
  "Renderer does not persist selected Terminal and UI shell preference");
const initialSessionLoad = panel.match(/async function loadExistingSessions[\s\S]*?\n    \}\n    void loadExistingSessions/)?.[0] || "";
assert.ok(initialSessionLoad, "Terminal panel does not have an explicit existing-session load path");
assert.doesNotMatch(initialSessionLoad, /createTerminal/,
  "Terminal panel creates a process merely because the panel mounted");
assert.match(panel, /next\.length === 0\) setStatusNote\("Select \+ to start a terminal\."\)/,
  "Closing the final Terminal session still creates a replacement process");
assert.match(terminal, /prefer_snapshot: true/,
  "Desktop reconstruction does not request snapshot before applying deltas");

console.log("Runtime-owned Terminal Desktop Facade verification passed.");
