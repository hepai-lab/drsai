import { describe, expect, it } from "vitest";
import {
  buildWindowsScriptCommandLine,
  isWindowsCommandScript,
  pickWindowsCommandCandidate,
} from "../src/main/claw3d";

describe("Claw3D command resolution", () => {
  it("detects Windows command scripts", () => {
    expect(isWindowsCommandScript("npm.cmd")).toBe(true);
    expect(isWindowsCommandScript("C:\\node\\npm.BAT")).toBe(true);
    expect(isWindowsCommandScript("git.exe")).toBe(false);
    expect(isWindowsCommandScript("/usr/local/bin/npm")).toBe(false);
  });

  it("prefers npm.cmd over extensionless npm on Windows", () => {
    const command = pickWindowsCommandCandidate([
      "C:\\nvm4w\\nodejs\\npm",
      "C:\\nvm4w\\nodejs\\npm.cmd",
    ]);

    expect(command).toEqual({
      command: "C:\\nvm4w\\nodejs\\npm.cmd",
      windowsScript: true,
    });
  });

  it("runs native executables directly", () => {
    const command = pickWindowsCommandCandidate([
      "C:\\Program Files\\Git\\cmd\\git.exe",
    ]);

    expect(command).toEqual({
      command: "C:\\Program Files\\Git\\cmd\\git.exe",
      windowsScript: false,
    });
  });

  it("wraps Windows command scripts for cmd.exe without losing spaces", () => {
    expect(
      buildWindowsScriptCommandLine("C:\\Program Files\\nodejs\\npm.cmd", [
        "run",
        "dev",
      ]),
    ).toBe('""C:\\Program Files\\nodejs\\npm.cmd" "run" "dev""');
  });
});
