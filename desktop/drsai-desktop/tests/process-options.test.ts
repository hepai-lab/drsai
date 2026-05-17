import { describe, expect, it } from "vitest";

import { hiddenSubprocessOptions } from "../src/main/process-options";

describe("hiddenSubprocessOptions", () => {
  it("forces child process console windows to stay hidden", () => {
    const options = hiddenSubprocessOptions({
      cwd: "C:\\work",
      timeout: 1000,
      windowsHide: false,
    });

    expect(options).toEqual({
      cwd: "C:\\work",
      timeout: 1000,
      windowsHide: true,
    });
  });

  it("does not mutate the caller's options object", () => {
    const original = { stdio: "ignore" as const };

    const options = hiddenSubprocessOptions(original);

    expect(original).toEqual({ stdio: "ignore" });
    expect(options).toEqual({ stdio: "ignore", windowsHide: true });
  });
});
