import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const sessionsSrc = readFileSync(join(ROOT, "src/renderer/src/screens/Sessions/Sessions.tsx"), "utf-8");

describe("Sessions screen sync error handling", () => {
  it("catches gateway list failures and keeps cached sessions visible", () => {
    expect(sessionsSrc).toContain("try {");
    expect(sessionsSrc).toContain("listSessions(50)");
    expect(sessionsSrc).toContain("console.warn(\"[sessions] listSessions failed");
    expect(sessionsSrc).toContain("listCachedSessions(50)");
  });
});
