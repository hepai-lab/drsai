import { describe, expect, it } from "vitest";
import { buildSshControlOptions } from "../src/main/ssh-options";

describe("ssh control options", () => {
  it("disables SSH multiplexing on Windows", () => {
    expect(buildSshControlOptions("win32")).toEqual([
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      "-o",
      "ControlPersist=no",
    ]);
  });

  it("keeps SSH multiplexing enabled on non-Windows platforms", () => {
    expect(buildSshControlOptions("linux")).toEqual([
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPath=~/.ssh/cm-hermes-%r@%h:%p",
      "-o",
      "ControlPersist=60s",
    ]);
  });
});
