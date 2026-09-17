import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAIN_WINDOW_STATE_VERSION,
  loadMainWindowState,
  resolveMainWindowState,
  saveMainWindowState,
  type PersistedWindowState,
} from "../src/main/windowState.ts";

const defaults = { width: 1280, height: 820, minWidth: 1100, minHeight: 720 };
const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1040 };
const secondaryDisplay = { x: 1920, y: 0, width: 2560, height: 1400 };
const state: PersistedWindowState = {
  version: MAIN_WINDOW_STATE_VERSION,
  bounds: { x: 2150, y: 140, width: 1440, height: 900 },
  maximized: true,
  fullScreen: false,
};

const temporaryDirectory = mkdtempSync(join(tmpdir(), "opendrsai-window-state-"));
try {
  const statePath = join(temporaryDirectory, "main-window-state.json");
  saveMainWindowState(statePath, state);
  assert.deepEqual(loadMainWindowState(statePath), state, "saved window state should round-trip");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).version, MAIN_WINDOW_STATE_VERSION);

  const visibleState = resolveMainWindowState(state, [primaryDisplay, secondaryDisplay], defaults);
  assert.deepEqual(visibleState.bounds, state.bounds, "a window on a connected secondary display should retain its bounds");
  assert.equal(visibleState.maximized, true, "maximized state should be restored separately from normal bounds");

  const disconnectedDisplayState = resolveMainWindowState(
    { ...state, bounds: { x: 6000, y: 1800, width: 1280, height: 820 } },
    [primaryDisplay],
    defaults,
  );
  assert.deepEqual(
    disconnectedDisplayState.bounds,
    { x: 320, y: 110, width: 1280, height: 820 },
    "an off-screen window should be centered on the primary display",
  );

  const oversizedState = resolveMainWindowState(
    { ...state, bounds: { x: -200, y: -100, width: 5000, height: 3000 } },
    [primaryDisplay],
    defaults,
  );
  assert.deepEqual(
    oversizedState.bounds,
    primaryDisplay,
    "restored bounds should be constrained to the selected display work area",
  );

  writeFileSync(statePath, "{not valid json", "utf8");
  assert.equal(loadMainWindowState(statePath), null, "corrupt state should fall back without throwing");
  writeFileSync(
    statePath,
    JSON.stringify({ ...state, bounds: { ...state.bounds, width: -1 } }),
    "utf8",
  );
  assert.equal(loadMainWindowState(statePath), null, "invalid bounds should be rejected");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Window state persistence verification passed.");
