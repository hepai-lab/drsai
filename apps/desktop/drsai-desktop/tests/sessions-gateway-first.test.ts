import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const sessionsSrc = readFileSync(join(ROOT, "src/renderer/src/screens/Sessions/Sessions.tsx"), "utf-8");

describe("Sessions screen gateway-first loading", () => {
  it("loads sessions through the gateway listSessions API instead of syncing native sqlite cache", () => {
    expect(sessionsSrc).toContain("window.drsaiAPI.listSessions(50)");
    expect(sessionsSrc).not.toContain("syncSessionCache()");
  });
});
