import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";

export const MAIN_WINDOW_STATE_VERSION = 1;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  version: typeof MAIN_WINDOW_STATE_VERSION;
  bounds: WindowBounds;
  maximized: boolean;
  fullScreen: boolean;
}

export interface WindowRestoreDefaults {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface RestoredWindowState {
  bounds: WindowBounds | null;
  maximized: boolean;
  fullScreen: boolean;
}

const MIN_VISIBLE_EDGE = 64;
const MAX_ABSOLUTE_COORDINATE = 1_000_000;
const MAX_WINDOW_DIMENSION = 100_000;

function normalizeBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WindowBounds>;
  const coordinates = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (!coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    return null;
  }

  const x = Math.round(candidate.x as number);
  const y = Math.round(candidate.y as number);
  const width = Math.round(candidate.width as number);
  const height = Math.round(candidate.height as number);
  if (
    Math.abs(x) > MAX_ABSOLUTE_COORDINATE
    || Math.abs(y) > MAX_ABSOLUTE_COORDINATE
    || width <= 0
    || height <= 0
    || width > MAX_WINDOW_DIMENSION
    || height > MAX_WINDOW_DIMENSION
  ) {
    return null;
  }

  return { x, y, width, height };
}

function normalizePersistedWindowState(value: unknown): PersistedWindowState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedWindowState>;
  if (candidate.version !== MAIN_WINDOW_STATE_VERSION) return null;
  if (typeof candidate.maximized !== "boolean" || typeof candidate.fullScreen !== "boolean") return null;
  const bounds = normalizeBounds(candidate.bounds);
  if (!bounds) return null;
  return {
    version: MAIN_WINDOW_STATE_VERSION,
    bounds,
    maximized: candidate.maximized,
    fullScreen: candidate.fullScreen,
  };
}

export function loadMainWindowState(filePath: string): PersistedWindowState | null {
  try {
    return normalizePersistedWindowState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

export function saveMainWindowState(filePath: string, state: PersistedWindowState): void {
  const normalizedState = normalizePersistedWindowState(state);
  if (!normalizedState) throw new Error("Cannot persist an invalid main window state.");

  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  try {
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      // Some Windows filesystems do not replace an existing destination atomically.
      writeFileSync(filePath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
    } finally {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may already have been moved.
      }
    }
    if (!loadMainWindowState(filePath)) throw error;
  }
}

function intersectionArea(left: WindowBounds, right: WindowBounds): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveMainWindowState(
  persistedState: PersistedWindowState | null,
  displayWorkAreas: WindowBounds[],
  defaults: WindowRestoreDefaults,
): RestoredWindowState {
  if (!persistedState) {
    return { bounds: null, maximized: false, fullScreen: false };
  }

  const validWorkAreas = displayWorkAreas
    .map((workArea) => normalizeBounds(workArea))
    .filter((workArea): workArea is WindowBounds => Boolean(workArea));
  if (validWorkAreas.length === 0) {
    return {
      bounds: persistedState.bounds,
      maximized: persistedState.maximized,
      fullScreen: persistedState.fullScreen,
    };
  }

  let targetWorkArea = validWorkAreas[0];
  let largestIntersection = intersectionArea(persistedState.bounds, targetWorkArea);
  for (const workArea of validWorkAreas.slice(1)) {
    const area = intersectionArea(persistedState.bounds, workArea);
    if (area > largestIntersection) {
      largestIntersection = area;
      targetWorkArea = workArea;
    }
  }

  const wasVisible = largestIntersection >= MIN_VISIBLE_EDGE * MIN_VISIBLE_EDGE;
  if (!wasVisible) targetWorkArea = validWorkAreas[0];

  const minimumWidth = Math.min(Math.max(1, defaults.minWidth), targetWorkArea.width);
  const minimumHeight = Math.min(Math.max(1, defaults.minHeight), targetWorkArea.height);
  const width = Math.min(Math.max(persistedState.bounds.width || defaults.width, minimumWidth), targetWorkArea.width);
  const height = Math.min(Math.max(persistedState.bounds.height || defaults.height, minimumHeight), targetWorkArea.height);
  const x = wasVisible
    ? clamp(persistedState.bounds.x, targetWorkArea.x, targetWorkArea.x + targetWorkArea.width - width)
    : targetWorkArea.x + Math.floor((targetWorkArea.width - width) / 2);
  const y = wasVisible
    ? clamp(persistedState.bounds.y, targetWorkArea.y, targetWorkArea.y + targetWorkArea.height - height)
    : targetWorkArea.y + Math.floor((targetWorkArea.height - height) / 2);

  return {
    bounds: { x, y, width, height },
    maximized: persistedState.maximized,
    fullScreen: persistedState.fullScreen,
  };
}
