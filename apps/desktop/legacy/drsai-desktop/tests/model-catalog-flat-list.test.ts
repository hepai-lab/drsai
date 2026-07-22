import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const DESKTOP_ROOT = join(__dirname, "..");
const setupSrc = readFileSync(join(DESKTOP_ROOT, "src/renderer/src/screens/Setup/Setup.tsx"), "utf-8");

describe("setup model selector flat list", () => {
  it("renders a flat list of display name plus alias entries without protocol optgroups", () => {
    expect(setupSrc).not.toContain("<optgroup label=\"Anthropic-compatible\"");
    expect(setupSrc).not.toContain("<optgroup label=\"OpenAI-compatible\"");
    expect(setupSrc).toContain("{`${item.displayName} (${item.alias})`}\n");
  });
});
