import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DESKTOP_ROOT = join(__dirname, "..");
const PY_ROOT = join(__dirname, "..", "..", "..", "python", "packages", "drsai", "src", "drsai", "backend");

const setupSrc = readFileSync(join(DESKTOP_ROOT, "src/renderer/src/screens/Setup/Setup.tsx"), "utf-8");
const factorySrc = readFileSync(join(PY_ROOT, "run_drsai_agent_factory.py"), "utf-8");

describe("model catalog UI polish", () => {
  it("uses curated display names for common aliases", () => {
    expect(factorySrc).toContain('"claude-sonnet-4-6": "Claude Sonnet 4.6"');
    expect(factorySrc).toContain('"gpt-5.5": "GPT-5.5"');
    expect(factorySrc).toContain('"hepai/deepseek-v4-flash": "HEPAI DeepSeek V4 Flash"');
  });

  it("renders the setup model selector as a simple flat list", () => {
    expect(setupSrc).not.toContain("<optgroup label=\"Anthropic-compatible\"");
    expect(setupSrc).not.toContain("<optgroup label=\"OpenAI-compatible\"");
    expect(setupSrc).toContain("{`${item.displayName} (${item.alias})`}\n");
  });
});
