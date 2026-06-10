import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const setupSrc = readFileSync(join(ROOT, "src/renderer/src/screens/Setup/Setup.tsx"), "utf-8");

describe("setup model catalog fallback", () => {
  it("renders bundled Python-default models when the gateway catalog is unavailable", () => {
    expect(setupSrc).toContain("FALLBACK_MODEL_CATALOG");
    expect(setupSrc).toContain('alias: "claude-sonnet-4-6"');
    expect(setupSrc).toContain('alias: "hepai/minimax-m2.7-highspeed"');
    expect(setupSrc).toContain('alias: "gpt-5.5"');
    expect(setupSrc).toContain("setCatalogModels(FALLBACK_MODEL_CATALOG)");
  });

  it("defaults to the Python default alias so the selected value has a matching option", () => {
    expect(setupSrc).toContain('useState("hepai/minimax-m2.7-highspeed")');
  });
});
