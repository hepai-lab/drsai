import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DESKTOP_ROOT = join(__dirname, "..");
const PY_ROOT = join(__dirname, "..", "..", "..", "python", "packages", "drsai", "src", "drsai", "backend");

const setupSrc = readFileSync(join(DESKTOP_ROOT, "src/renderer/src/screens/Setup/Setup.tsx"), "utf-8");
const preloadSrc = readFileSync(join(DESKTOP_ROOT, "src/preload/index.ts"), "utf-8");
const preloadTypes = readFileSync(join(DESKTOP_ROOT, "src/preload/index.d.ts"), "utf-8");
const gatewaySrc = readFileSync(join(PY_ROOT, "gateway.py"), "utf-8");
const factorySrc = readFileSync(join(PY_ROOT, "run_drsai_agent_factory.py"), "utf-8");

describe("model catalog integration", () => {
  it("gateway exposes a model catalog endpoint backed by the agent factory", () => {
    expect(gatewaySrc).toContain('@app.get("/v1/config/model-catalog")');
    expect(factorySrc).toContain("def build_model_catalog(");
    expect(factorySrc).toContain("display_name");
  });

  it("desktop preload exposes model catalog access", () => {
    expect(preloadSrc).toContain('ipcRenderer.invoke("get-model-catalog")');
    expect(preloadTypes).toContain("getModelCatalog");
  });

  it("setup screen reads the model catalog and renders a flat display-name list", () => {
    expect(setupSrc).toContain("getModelCatalog");
    expect(setupSrc).not.toContain("Anthropic-compatible");
    expect(setupSrc).not.toContain("OpenAI-compatible");
    expect(setupSrc).toContain("displayName");
    expect(setupSrc).toContain("alias");
  });
});
