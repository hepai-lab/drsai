import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const installerSrc = readFileSync(join(ROOT, "src/main/installer.ts"), "utf-8");

describe("installer script source", () => {
  it("downloads the install script from the DrSai repository instead of the removed NousResearch path", () => {
    expect(installerSrc).toContain("https://raw.githubusercontent.com/hepai-lab/drsai/main/scripts/install.sh");
    expect(installerSrc).not.toContain("https://raw.githubusercontent.com/NousResearch/drsai-agent/main/scripts/install.sh");
  });
});
