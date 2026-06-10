import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const sessionCacheSrc = readFileSync(join(ROOT, "src/main/session-cache.ts"), "utf-8");

describe("session cache native sqlite fallback", () => {
  it("does not import better-sqlite3 at module load time", () => {
    expect(sessionCacheSrc).not.toContain('import Database from "better-sqlite3"');
  });

  it("handles missing better-sqlite3 native bindings inside getDb", () => {
    expect(sessionCacheSrc).toContain('require("better-sqlite3")');
    expect(sessionCacheSrc).toContain('console.warn("[session-cache] better-sqlite3 unavailable');
    expect(sessionCacheSrc).toContain("return null");
  });
});
