type MeasureArguments = Parameters<Performance["measure"]>;

let installed = false;

function isReactDevToolsMeasureOptions(value: unknown): value is PerformanceMeasureOptions & {
  detail: { devtools: unknown };
} {
  if (!value || typeof value !== "object" || !("detail" in value)) return false;
  const detail = (value as { detail?: unknown }).detail;
  return Boolean(detail && typeof detail === "object" && "devtools" in detail);
}

export function isPerformanceDetailCloneError(error: unknown): boolean {
  if (!(error instanceof DOMException) || error.name !== "DataCloneError") return false;
  return /(?:cannot|failed to).*clone|out of memory/i.test(error.message);
}

/**
 * React 19's development-only Performance Tracks attach a recursively expanded
 * changed-props table to PerformanceMeasureOptions.detail. Chromium must clone
 * that table and can reject very wide object graphs with DataCloneError/OOM.
 * Preserve the timing entry in that case, but retry without optional metadata.
 */
export function installReactPerformanceMeasureGuard(): void {
  if (installed || typeof performance === "undefined" || typeof performance.measure !== "function") return;
  installed = true;

  const originalMeasure = performance.measure;
  const guardedMeasure = ((...args: MeasureArguments): PerformanceMeasure => {
    try {
      return Reflect.apply(originalMeasure, performance, args) as PerformanceMeasure;
    } catch (error) {
      const options = args[1];
      if (!isPerformanceDetailCloneError(error) || !isReactDevToolsMeasureOptions(options)) throw error;

      const { detail: _omitted, ...timingOptions } = options;
      return Reflect.apply(originalMeasure, performance, [args[0], timingOptions]) as PerformanceMeasure;
    }
  }) as Performance["measure"];

  Object.defineProperty(performance, "measure", {
    configurable: true,
    value: guardedMeasure,
  });
}
