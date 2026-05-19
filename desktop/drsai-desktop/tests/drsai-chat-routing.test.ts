import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const drsaiSrc = readFileSync(join(ROOT, "src/main/drsai.ts"), "utf-8");

describe("DrSai chat routing", () => {
  it("does not pipe the interactive CLI TUI into chat output", () => {
    expect(drsaiSrc).not.toContain("sendMessageViaCli");
    expect(drsaiSrc).not.toContain("drsai.backend.run_cli",);
    expect(drsaiSrc).toContain("await waitForApiReady");
    expect(drsaiSrc).toContain("startGateway(profile)");
  });
});
