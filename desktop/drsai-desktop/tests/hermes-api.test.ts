import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared state for capturing HTTP requests (hoisted before mocks) ──

const { capturedRequests, makeMockRequest, stopHealthPolling } = vi.hoisted(() => {
  const capturedRequests: Array<{
    url: string;
    options: Record<string, unknown>;
    body: string;
  }> = [];

  function makeMockRequest(
    url: string,
    options: Record<string, unknown>,
  ) {
    return {
      write: (body: string) => {
        capturedRequests.push({ url, options, body });
      },
      end: () => {},
      on: (_event: string, _cb: () => void) => {},
      destroy: () => {},
    };
  }

  return { capturedRequests, makeMockRequest, stopHealthPolling: () => capturedRequests.splice(0) };
});

// ── Mock Node.js http/https modules ──

vi.mock("http", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

vi.mock("https", () => ({
  default: {
    request: (url: string, options: Record<string, unknown>) =>
      makeMockRequest(url, options),
  },
}));

// ── Mock project dependencies ──

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-api-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["/dev/null"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: "remote" as const,
    remoteUrl: "http://test-api.example.com",
    apiKey: "test-key",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

// ── Import module under test ──

import { sendMessage, stopHealthPolling as realStopHealthPolling } from "../src/main/hermes";

describe("sendMessageViaApi forwards resumeSessionId", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
  });

  afterEach(() => {
    realStopHealthPolling();
    capturedRequests.length = 0;
  });

  it("includes session_id in request body when resumeSessionId is provided", async () => {
    const testSessionId = "session-abc-123";

    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      testSessionId,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed.session_id).toBe(testSessionId);
  });

  it("does not include session_id field when resumeSessionId is absent", async () => {
    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      undefined,
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed).not.toHaveProperty("session_id");
  });

  it("does not send empty string session_id when resumeSessionId is empty string", async () => {
    await sendMessage(
      "hello",
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
      "default",
      "",
    );

    const chatRequest = capturedRequests.find((r) =>
      r.url.includes("/v1/chat/completions"),
    );
    expect(chatRequest).toBeDefined();
    const parsed = JSON.parse(chatRequest!.body);

    expect(parsed).not.toHaveProperty("session_id");
  });
});
