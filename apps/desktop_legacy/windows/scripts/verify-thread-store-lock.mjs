import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(join(root, "src/main/threads.ts"), "utf8");

const markers = [
  "withThreadStoreLock",
  "threadStoreQueue",
  "writeJsonAtomic",
  "copyFile",
  "parseJsonLenient",
  "return withThreadStoreLock(async () => {",
];

for (const marker of markers) {
  if (!source.includes(marker)) {
    throw new Error(`threads.ts missing store-lock marker: ${marker}`);
  }
}

for (const fn of ["createThread", "updateThread", "deleteThread", "updateThreadSnapshot"]) {
  const idx = source.indexOf(`export async function ${fn}`);
  if (idx < 0) throw new Error(`missing ${fn}`);
  const chunk = source.slice(idx, idx + 600);
  if (!chunk.includes("withThreadStoreLock")) {
    throw new Error(`${fn} is not wrapped in withThreadStoreLock`);
  }
}

/** Simulate the same serial queue used by threads.ts against concurrent RMW. */
function createStoreLock() {
  let queue = Promise.resolve();
  return function withLock(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

async function assertConcurrentCreatesPreserveAll() {
  const withLock = createStoreLock();
  let store = [];

  async function unlockedCreate(id) {
    const current = [...store];
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    store = [{ id }, ...current];
  }

  async function lockedCreate(id) {
    return withLock(async () => {
      const current = [...store];
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      store = [{ id }, ...current];
    });
  }

  store = [];
  await Promise.all(Array.from({ length: 20 }, (_, i) => unlockedCreate(`u-${i}`)));
  const unlockedCount = store.length;
  if (unlockedCount === 20) {
    console.warn("unlocked race did not reproduce loss (timing); continuing locked check");
  }

  store = [];
  await Promise.all(Array.from({ length: 20 }, (_, i) => lockedCreate(`l-${i}`)));
  if (store.length !== 20) {
    throw new Error(`locked concurrent creates lost rows: got ${store.length}, expected 20`);
  }
  const ids = new Set(store.map((item) => item.id));
  if (ids.size !== 20) {
    throw new Error(`locked concurrent creates produced duplicate/missing ids: ${ids.size}`);
  }
}

await assertConcurrentCreatesPreserveAll();
console.log("verify-thread-store-lock: ok");
