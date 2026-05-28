import { describe, expect, it } from "vitest";
import DEFAULT_MODELS from "../src/main/default-models";
import { PROVIDERS } from "../src/renderer/src/constants";

describe("HEPAI desktop support", () => {
  it("exposes HEPAI as the first setup provider", () => {
    expect(PROVIDERS.setup[0]).toMatchObject({
      id: "hepai",
      envKey: "HEPAI_API_KEY",
      url: "https://aiapi.ihep.ac.cn",
      needsKey: true,
    });
  });

  it("ships HEPAI default models for both anthropic and openai formats", () => {
    expect(DEFAULT_MODELS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringContaining("HEPAI Claude"),
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          baseUrl: "https://aiapi.ihep.ac.cn/apiv2/anthropic",
        }),
        expect.objectContaining({
          name: expect.stringContaining("HEPAI MiniMax"),
          provider: "anthropic",
          model: "minimax-m2.7-highspeed",
          baseUrl: "https://aiapi.ihep.ac.cn/apiv2/anthropic",
        }),
        expect.objectContaining({
          name: expect.stringContaining("HEPAI DeepSeek"),
          provider: "openai",
          model: "hepai/deepseek-v4-flash",
          baseUrl: "https://aiapi.ihep.ac.cn/apiv2",
        }),
      ]),
    );
  });
});
