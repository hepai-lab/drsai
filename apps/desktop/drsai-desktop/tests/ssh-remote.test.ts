import { describe, expect, it } from "vitest";
import { sshSetConfigValue } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

describe("ssh remote config writes", () => {
  it.each([
    ["quote", 'bad"value'],
    ["backslash", "bad\\value"],
    ["newline", "bad\nvalue"],
    ["carriage return", "bad\rvalue"],
  ])("rejects YAML-breaking %s values before remote writes", async (_name, value) => {
    await expect(
      sshSetConfigValue(sshConfig, "base_url", value),
    ).rejects.toThrow("Config value contains illegal characters");
  });
});
