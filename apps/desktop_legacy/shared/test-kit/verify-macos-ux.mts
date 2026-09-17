import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isTextCompositionEvent, shouldSubmitTextInput } from "../../shared/renderer/src/imeKeyboardPolicy";
import { stripTrailingSourceList } from "../../shared/renderer/src/sourceListPresentation";

assert.equal(shouldSubmitTextInput({ key: "Enter" }), true);
assert.equal(shouldSubmitTextInput({ key: "Enter", shiftKey: true }), false);
assert.equal(shouldSubmitTextInput({ key: "Enter", isComposing: true }), false, "Enter must not submit an active IME composition");
assert.equal(shouldSubmitTextInput({ key: "Enter", keyCode: 229 }), false, "legacy macOS/Chromium IME events must not submit");
assert.equal(shouldSubmitTextInput({ key: "Process", keyCode: 229 }), false);
assert.equal(isTextCompositionEvent({ isComposing: true }), true);
assert.equal(isTextCompositionEvent({ keyCode: 229 }), true);
assert.equal(isTextCompositionEvent({ isComposing: false, keyCode: 13 }), false);

const citedMarkdown = "Answer[^1] and more[^2].\n\n[^1]: https://example.com/one\n[^2]: https://example.com/two";
assert.equal(stripTrailingSourceList(citedMarkdown), "Answer and more.", "URL-only Markdown footnotes must not duplicate structured source cards");
const explanatoryFootnote = "Answer[^note].\n\n[^note]: This qualification is not a source URL.";
assert.equal(stripTrailingSourceList(explanatoryFootnote), explanatoryFootnote, "explanatory footnotes must remain visible");
const conflictingAppendix = "Answer[^1].\n\n[^1]: https://example.com/one\n\nAdditional text";
assert.equal(stripTrailingSourceList(conflictingAppendix), conflictingAppendix, "non-trailing source definitions must not remove later content");

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");
const [window, index, integrations, preload, app, chat, shell, css] = await Promise.all([
  read("src/main/bootstrap/createWindow.ts"),
  read("src/main/index.ts"),
  read("src/main/bootstrap/installAppIntegrations.ts"),
  read("../shared/main/preload.ts"),
  read("../shared/renderer/src/App.tsx"),
  read("../shared/renderer/src/components/ChatWorkspace.tsx"),
  read("../shared/renderer/src/components/WorkspaceShell.tsx"),
  read("../shared/renderer/src/styles.css"),
]);

for (const control of ['titleBarStyle: "hiddenInset"', "trafficLightPosition", "minWidth: 960", "minHeight: 640"]) assert.ok(window.includes(control), `macOS window omits ${control}`);
for (const adaptiveWindowControl of ["screen.getPrimaryDisplay().workAreaSize", "workArea.width * 0.82", "workArea.height * 0.84", "center: true"]) assert.ok(window.includes(adaptiveWindowControl), `macOS window omits adaptive startup behavior: ${adaptiveWindowControl}`);
for (const control of ["isFullScreen()", "isSimpleFullScreen()", "isMaximized()", "screen.getDisplayMatching", "mainWindow.setBounds"]) assert.ok(index.includes(control), `multi-display/fullscreen policy omits ${control}`);
for (const role of ['role: "appMenu"', 'role: "fileMenu"', 'role: "editMenu"', 'role: "viewMenu"', 'role: "windowMenu"', 'role: "services"', 'accelerator: "CmdOrCtrl+,"']) assert.ok(integrations.includes(role), `native menu omits ${role}`);
for (const platformMarker of ['process.platform === "darwin"', 'DOMContentLoaded', 'dataset.desktopPlatform = desktopPlatform']) assert.ok(preload.includes(platformMarker), `preload omits document-ready platform marker: ${platformMarker}`);
assert.match(app, /prefers-color-scheme: dark/);
assert.match(app, /systemTheme\.addEventListener\("change"/);
assert.match(chat, /shouldSubmitTextInput\(event\.nativeEvent\)/);
assert.match(chat, /isTextCompositionEvent\(event\.nativeEvent\)/);
assert.match(shell, /isTextCompositionEvent\(event\.nativeEvent\)/);
assert.match(shell, /platform-\$\{platformId\}/);
assert.match(app, /platformId=\{platformDescriptor\?\.id/);
for (const control of [
  "-apple-system", "BlinkMacSystemFont", "-webkit-app-region: drag", "-webkit-app-region: no-drag",
  "prefers-reduced-motion: reduce", "animation-duration: 1ms !important", "transition-duration: 1ms !important",
  "prefers-contrast: more", "forced-colors: active", "outline: 3px solid currentColor",
]) assert.ok(css.includes(control), `macOS appearance/accessibility CSS omits ${control}`);
for (const titlebarControl of [
  '--titlebar-leading-inset: 14px', '--titlebar-trailing-inset: 150px',
  '--titlebar-leading-inset: 84px', '--titlebar-trailing-inset: 14px',
  'padding-inline: var(--titlebar-leading-inset) var(--titlebar-trailing-inset)',
  '.app-shell.platform-macos', '.app-shell.platform-macos .workbench-menu-items',
]) assert.ok(css.includes(titlebarControl), `macOS native titlebar layout omits ${titlebarControl}`);

console.log("macOS UX contract passed (window/menu/display, IME composition, themes, motion, contrast and focus).");
