import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PY_ROOT = join(__dirname, "..", "..", "..", "python", "packages", "drsai", "src", "drsai", "backend");
const gatewaySrc = readFileSync(join(PY_ROOT, "gateway.py"), "utf-8");

describe("gateway SSE helper definition order", () => {
  it("defines _event_to_sse before the __main__ block starts uvicorn", () => {
    const helperIndex = gatewaySrc.indexOf("def _event_to_sse(");
    const mainBlockIndex = gatewaySrc.indexOf('if __name__ == "__main__":');
    expect(helperIndex).toBeGreaterThan(-1);
    expect(mainBlockIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeLessThan(mainBlockIndex);
  });
});
