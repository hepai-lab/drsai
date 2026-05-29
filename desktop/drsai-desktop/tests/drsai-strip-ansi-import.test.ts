import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const drsaiSrc = readFileSync(join(ROOT, "src/main/drsai.ts"), "utf-8");

describe("drsai backend connector imports", () => {
  it("does not need stripAnsi because desktop chat no longer pipes CLI TUI output", () => {
    expect(drsaiSrc).not.toContain("stripAnsi(");
    expect(drsaiSrc).not.toContain('import { stripAnsi } from "./utils";');
    expect(drsaiSrc).toContain("sendMessageViaApi");
  });
});
