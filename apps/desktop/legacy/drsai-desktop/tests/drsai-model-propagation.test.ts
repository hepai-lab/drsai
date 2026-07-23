import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const drsaiSrc = readFileSync(join(ROOT, "src/main/drsai.ts"), "utf-8");

describe("DrSai desktop model propagation", () => {
  it("sends the selected model alias from model config to the gateway", () => {
    expect(drsaiSrc).toContain('import { getModelConfig, getUserName } from "./config";');
    expect(drsaiSrc).toContain("const modelConfig = getModelConfig(profile);");
    expect(drsaiSrc).toContain('model: modelConfig.model || "drsai"');
  });
});
