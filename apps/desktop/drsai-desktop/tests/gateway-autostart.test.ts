import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const indexSrc = readFileSync(join(ROOT, "src/main/index.ts"), "utf-8");

describe("gateway auto-start", () => {
  it("starts the local gateway on desktop launch when DrSai is installed", () => {
    expect(indexSrc).toContain("autoStartLocalGateway");
    expect(indexSrc).toContain("const status = checkInstallStatus();");
    expect(indexSrc).toContain("if (status.installed && !isGatewayRunning())");
    expect(indexSrc).toContain("startGateway();");
    expect(indexSrc).toContain("autoStartLocalGateway();");
  });
});
