import { describe, expect, it } from "vitest";
import { isImeComposing } from "./keyboard";

describe("chat keyboard helpers", () => {
  it("detects active IME composition from the native event", () => {
    expect(
      isImeComposing({
        nativeEvent: { isComposing: true },
      }),
    ).toBe(true);
  });

  it("detects IME process key events", () => {
    expect(
      isImeComposing({
        keyCode: 229,
        nativeEvent: { isComposing: false },
      }),
    ).toBe(true);
  });

  it("does not treat regular key events as composing", () => {
    expect(
      isImeComposing({
        keyCode: 13,
        nativeEvent: { isComposing: false },
      }),
    ).toBe(false);
  });
});
