import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const drsaiSrc = readFileSync(join(ROOT, "src/main/drsai.ts"), "utf-8");

describe("DrSai chat fallback", () => {
  it("does not invoke the interactive CLI for desktop chat", () => {
    expect(drsaiSrc).not.toContain('"chat", "-q"');
    expect(drsaiSrc).not.toContain("sendMessageViaCli");
    expect(drsaiSrc).not.toContain("drsai.backend.run_cli");
  });
});
