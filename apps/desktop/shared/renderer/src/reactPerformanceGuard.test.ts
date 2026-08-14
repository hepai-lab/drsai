import assert from "node:assert/strict";
import { installReactPerformanceMeasureGuard } from "./reactPerformanceGuard";

const calls: unknown[][] = [];
const cloneError = new DOMException("Data cannot be cloned, out of memory.", "DataCloneError");
const fakePerformance = {
  measure(...args: unknown[]): { name: string } {
    calls.push(args);
    const options = args[1] as { detail?: unknown } | undefined;
    if (options?.detail) throw cloneError;
    return { name: String(args[0]) };
  },
};

Object.defineProperty(globalThis, "performance", { configurable: true, value: fakePerformance });
installReactPerformanceMeasureGuard();

const result = performance.measure("react-render", {
  start: 1,
  end: 2,
  detail: { devtools: { properties: new Array(100_000).fill(["prop", "value"]) } },
});
assert.equal(result.name, "react-render");
assert.equal(calls.length, 2);
assert.deepEqual(calls[1], ["react-render", { start: 1, end: 2 }]);

assert.throws(
  () => performance.measure("application-measure", { detail: { application: true } }),
  (error) => error === cloneError,
  "non-React detail clone failures must remain visible",
);

console.log("reactPerformanceGuard tests passed");
