import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const installScript = join(REPO_ROOT, "scripts", "install.sh");

describe("root install.sh", () => {
  it("exists at scripts/install.sh for raw GitHub desktop installs", () => {
    expect(existsSync(installScript)).toBe(true);
  });

  it("installs into the desktop-expected ~/.drsai/drsai-agent layout", () => {
    const src = readFileSync(installScript, "utf-8");
    expect(src).toContain('DRSAI_HOME="${DRSAI_HOME:-"$HOME/.drsai"}"');
    expect(src).toContain('INSTALL_DIR="${DRSAI_INSTALL_DIR:-"$DRSAI_HOME/drsai-agent"}"');
    expect(src).toContain('python/packages/drsai');
    expect(src).toContain('drsai.backend.run_cli');
    expect(src).toContain('hepai/minimax-m2.7-highspeed');
  });
});
