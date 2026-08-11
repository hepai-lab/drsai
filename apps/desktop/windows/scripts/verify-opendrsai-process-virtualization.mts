import assert from "node:assert/strict";
import {
  boundedProcessWindow,
  PROCESS_ACTIVITY_WINDOW_SIZE,
  PROCESS_PART_WINDOW_SIZE,
} from "../../shared/renderer/src/boundedProcessWindow.ts";

assert.equal(PROCESS_ACTIVITY_WINDOW_SIZE, 16);
assert.equal(PROCESS_PART_WINDOW_SIZE, 8);
assert.deepEqual(boundedProcessWindow(10_000, 0, PROCESS_ACTIVITY_WINDOW_SIZE), {
  page: 0, pageCount: 625, start: 0, end: 16,
});
assert.deepEqual(boundedProcessWindow(10_000, 624, PROCESS_ACTIVITY_WINDOW_SIZE), {
  page: 624, pageCount: 625, start: 9_984, end: 10_000,
});
assert.deepEqual(boundedProcessWindow(10_000, 99_999, PROCESS_ACTIVITY_WINDOW_SIZE), {
  page: 624, pageCount: 625, start: 9_984, end: 10_000,
});
assert.deepEqual(boundedProcessWindow(0, -10, 0), {
  page: 0, pageCount: 1, start: 0, end: 0,
});

const visited = new Set<number>();
for (let page = 0; page < 625; page += 1) {
  const window = boundedProcessWindow(10_000, page, PROCESS_ACTIVITY_WINDOW_SIZE);
  for (let index = window.start; index < window.end; index += 1) visited.add(index);
}
assert.equal(visited.size, 10_000, "bounded pages must preserve access to every evidence item");
console.log(JSON.stringify({ ok: true, total: 10_000, windowSize: 16, pages: 625, accessibleItems: visited.size }, null, 2));
