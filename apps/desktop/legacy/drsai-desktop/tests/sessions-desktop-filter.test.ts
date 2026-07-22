import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const sessionsSrc = readFileSync(join(ROOT, "src/main/sessions.ts"), "utf-8");

describe("desktop session gateway mapping", () => {
  it("filters gateway thread list to the desktop workdir", () => {
    expect(sessionsSrc).toContain("const desktopWorkdir = process.cwd();");
    expect(sessionsSrc).toContain("filter((r: Record<string, unknown>) => r.workdir === desktopWorkdir)");
  });

  it("normalizes non-string gateway message content before sending it to React", () => {
    expect(sessionsSrc).toContain("function normalizeMessageContent(content: unknown): string");
    expect(sessionsSrc).toContain("JSON.stringify(content)");
    expect(sessionsSrc).toContain("content: normalizeMessageContent(m.content)");
  });
});
