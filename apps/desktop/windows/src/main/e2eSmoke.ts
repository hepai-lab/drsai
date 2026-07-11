import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { BrowserWindow } from "electron";

interface SmokeResult {
  ok: boolean;
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
  error?: string;
}

interface ForkMergeApprovedFixture {
  fixtureRoot: string;
  sourcePath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  forkCommit: string;
  expectedContent: string;
}

interface ForkMergeConflictFixture {
  fixtureRoot: string;
  sourcePath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  sourceHead: string;
  forkCommit: string;
  sourceContent: string;
}

interface ChannelImportFixture {
  workspacePath: string;
  markdownPath: string;
  cypressJsonPath: string;
  pngPath: string;
  sarifJsonPath: string;
  chatExportJsonPath: string;
  emlxPath: string;
  icsPath: string;
  filePaths: string[];
}

interface IdeContextFixture {
  source: "vscode" | "jetbrains" | "visual_studio";
  workspacePath: string;
  sourcePath: string;
  relativePath: string;
  selectionText: string;
}

interface WorkspaceReviewFixture {
  workspacePath: string;
  stagePath: string;
  revertPath: string;
  stalePath: string;
  stageChangedContent: string;
  revertBaseContent: string;
  nonGitWorkspacePath: string;
  nonGitFilePath: string;
  nonGitBaseContent: string;
}

const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "30000");

export function maybeRunE2eSmoke(window: BrowserWindow): void {
  if (
    process.env.OPENDRSAI_E2E_SMOKE !== "1" &&
    process.env.OPENDRSAI_E2E_CHAT !== "1" &&
    process.env.OPENDRSAI_E2E_CHAT_FAILURES !== "1" &&
    process.env.OPENDRSAI_E2E_AGENT_RUN !== "1" &&
    process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES !== "1" &&
    process.env.OPENDRSAI_E2E_THREADS !== "1" &&
    process.env.OPENDRSAI_E2E_FORK_MERGE !== "1" &&
    process.env.OPENDRSAI_E2E_OIDC !== "1"
  ) return;
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    throw new Error("OPENDRSAI_E2E_RESULT is required for OpenDrSai E2E smoke modes.");
  }

  const watchdog = setTimeout(() => {
    writeResult(resultPath, {
      ok: false,
      checks: {},
      details: {
        url: window.webContents.getURL(),
        title: window.webContents.getTitle(),
        isLoading: window.webContents.isLoading(),
        isLoadingMainFrame: window.webContents.isLoadingMainFrame(),
        startupTrace: (globalThis as { __OPENDRSAI_E2E_TRACE?: unknown }).__OPENDRSAI_E2E_TRACE,
      },
      error: "Packaged app smoke timed out.",
    });
    process.exit(1);
  }, timeoutMs);

  window.webContents.once("did-fail-load", (_event, _code, description) => {
    clearTimeout(watchdog);
    writeResult(resultPath, {
      ok: false,
      checks: {},
      details: {},
      error: `Renderer failed to load: ${description}`,
    });
    process.exit(1);
  });

  window.webContents.once("did-finish-load", () => {
    const runner = process.env.OPENDRSAI_E2E_CHAT_FAILURES === "1"
      ? runChatFailureSmoke
      : process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES === "1"
        ? runAgentRunFailureSmoke
      : process.env.OPENDRSAI_E2E_AGENT_RUN === "1"
        ? runAgentRunSmoke
      : process.env.OPENDRSAI_E2E_THREADS === "1"
        ? runThreadsSmoke
      : process.env.OPENDRSAI_E2E_FORK_MERGE === "1"
        ? runForkMergeSmoke
      : process.env.OPENDRSAI_E2E_OIDC === "1"
        ? runOidcSmoke
      : process.env.OPENDRSAI_E2E_CHAT === "1"
        ? runChatSmoke
        : runSmoke;
    runner(window)
      .then((result) => {
        clearTimeout(watchdog);
        writeResult(resultPath, result);
        process.exit(result.ok ? 0 : 1);
      })
      .catch((error) => {
        clearTimeout(watchdog);
        writeResult(resultPath, {
          ok: false,
          checks: {},
          details: {},
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  });
}

async function runChatFailureSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectChat(requestId, request, options = {}) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onChatEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          let returnedRequestId = null;
          let startError = null;
          try {
            returnedRequestId = await api.startChat({ requestId, model: "drsai", ...request });
          } catch (error) {
            startError = String(error && error.message ? error.message : error);
          }
          if (options.abortAfterStart && !startError) {
            const abortDeadline = Date.now() + 5000;
            while (Date.now() < abortDeadline && !events.some((event) => event.type === "start")) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await api.abortChat(requestId);
          }
          const deadline = Date.now() + (options.waitMs || 12000);
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const threads = await api.listThreads();
          return {
            returnedRequestId,
            startError,
            events,
            threads,
            finalThread: threads.find((thread) => thread.id === requestId) || null,
            durationMs: Date.now() - startedAt,
          };
        } finally {
          unsubscribe();
        }
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      const scenario = ${JSON.stringify(process.env.OPENDRSAI_E2E_CHAT_FAILURE_SCENARIO || "")};
      details.scenario = scenario;
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      if (scenario !== "gateway-unreachable") {
        const health = await api.getHealth();
        details.health = {
          gatewayReady: health.gatewayReady,
          gatewayManaged: health.gateway && health.gateway.managed,
          gatewayExternalReady: health.gateway && health.gateway.externalReady,
          gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
        };
        checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && health.gateway.managed);
      }

      if (scenario === "abort") {
        const requestId = "e2e-failure-abort";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "abort me" }] },
          { abortAfterStart: true, waitMs: 10000 },
        );
        details.abort = summarizeOutcome(outcome);
        checks.abortStart = outcome.events.some((event) => event.type === "start");
        checks.abortEvent = outcome.events.some((event) => event.type === "aborted");
        checks.abortTerminal = details.abort.terminalEventType === "aborted";
        checks.abortThreadError = details.abort.thread && details.abort.thread.status === "error";
        checks.abortNoDone = !outcome.events.some((event) => event.type === "done");
        checks.abortNoError = !outcome.events.some((event) => event.type === "error");
      } else if (scenario === "sse-error") {
        const requestId = "e2e-failure-error";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "trigger sse error" }] },
          { waitMs: 10000 },
        );
        details.sseError = summarizeOutcome(outcome);
        checks.sseErrorStart = outcome.events.some((event) => event.type === "start");
        checks.sseErrorEvent = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("synthetic gateway error"));
        checks.sseErrorTerminal = details.sseError.terminalEventType === "error";
        checks.sseErrorThreadError = details.sseError.thread && details.sseError.thread.status === "error";
        checks.sseErrorNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "gateway-unreachable") {
        const requestId = "e2e-failure-unreachable";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "gateway unreachable" }] },
          { waitMs: 10000 },
        );
        details.gatewayUnreachable = summarizeOutcome(outcome);
        checks.gatewayUnreachableStart = outcome.events.some((event) => event.type === "start");
        checks.gatewayUnreachableError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("Gateway is not ready"));
        checks.gatewayUnreachableTerminal = details.gatewayUnreachable.terminalEventType === "error";
        checks.gatewayUnreachableThreadError = details.gatewayUnreachable.thread && details.gatewayUnreachable.thread.status === "error";
        checks.gatewayUnreachableNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "timeout") {
        const requestId = "e2e-failure-timeout";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "timeout please" }] },
          { waitMs: 10000 },
        );
        details.timeout = summarizeOutcome(outcome);
        checks.timeoutStart = outcome.events.some((event) => event.type === "start");
        checks.timeoutError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("timed out"));
        checks.timeoutTerminal = details.timeout.terminalEventType === "error";
        checks.timeoutThreadError = details.timeout.thread && details.timeout.thread.status === "error";
        checks.timeoutDuration = details.timeout.durationMs >= 1000;
        checks.timeoutNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "empty-done") {
        const requestId = "e2e-failure-empty-done";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "empty done" }] },
          { waitMs: 10000 },
        );
        details.emptyDone = summarizeOutcome(outcome);
        checks.emptyDoneStart = outcome.events.some((event) => event.type === "start");
        checks.emptyDoneEvent = outcome.events.some((event) => event.type === "done");
        checks.emptyDoneTerminal = details.emptyDone.terminalEventType === "done";
        checks.emptyDoneThreadIdle = details.emptyDone.thread && details.emptyDone.thread.status === "idle";
        checks.emptyDoneNoChunk = !outcome.events.some((event) => event.type === "chunk");
        checks.emptyDoneNoError = !outcome.events.some((event) => event.type === "error" || event.type === "aborted");
      } else if (scenario === "chunk-disconnect") {
        const requestId = "e2e-failure-disconnect";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "disconnect after chunk" }] },
          { waitMs: 10000 },
        );
        details.chunkDisconnect = summarizeOutcome(outcome);
        checks.chunkDisconnectStart = outcome.events.some((event) => event.type === "start");
        checks.chunkDisconnectChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("partial before disconnect"));
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("ended before data: [DONE]"));
        checks.chunkDisconnectTerminal = details.chunkDisconnect.terminalEventType === "error";
        checks.chunkDisconnectThreadError = details.chunkDisconnect.thread && details.chunkDisconnect.thread.status === "error";
        checks.chunkDisconnectNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "attachments") {
        const requestId = "e2e-attachments";
        const attachmentFilePath = ${JSON.stringify(process.env.OPENDRSAI_E2E_ATTACHMENT_FILE || "C:\\OpenDrSai\\fixtures\\notes.md")};
        const attachmentFolderPath = ${JSON.stringify(process.env.OPENDRSAI_E2E_ATTACHMENT_FOLDER || "C:\\OpenDrSai\\fixtures\\project")};
        const outcome = await collectChat(
          requestId,
          {
            attachments: [
              { kind: "file", path: attachmentFilePath, name: "notes.md" },
              { kind: "folder", path: attachmentFolderPath, name: "project" },
            ],
            messages: [{ role: "user", content: "use attached files" }],
          },
          { waitMs: 10000 },
        );
        details.attachments = summarizeOutcome(outcome);
        checks.attachmentsStart = outcome.events.some((event) => event.type === "start");
        checks.attachmentsChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent attachments: 2"));
        checks.attachmentsTerminal = details.attachments.terminalEventType === "done";
        checks.attachmentsThreadIdle = details.attachments.thread && details.attachments.thread.status === "idle";
        checks.attachmentsNoError = !outcome.events.some((event) => event.type === "error" || event.type === "aborted");
      } else {
        checks.knownScenario = false;
        details.error = "Unknown failure scenario.";
      }

      function summarizeOutcome(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returnedRequestId: outcome.returnedRequestId,
          startError: outcome.startError,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
          thread: outcome.finalThread,
          threads: outcome.threads,
        };
      }

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runChatSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const health = await api.getHealth();
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
        gatewayExternalReady: health.gateway && health.gateway.externalReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
      };
      checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && health.gateway.managed);

      const thread = await api.createThread({
        kind: "chat",
        title: "E2E chat thread",
        workspacePath: "C:\\\\OpenDrSai\\\\workspace",
      });
      details.thread = thread;
      checks.threadCreated = Boolean(thread && thread.id && thread.kind === "chat");
      const requestId = "e2e-chat-request-0001";
      const runId = "e2e-chat-run-0001";
      const events = [];
      const startedAt = Date.now();
      const unsubscribe = api.onChatEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      try {
        const returnedRequestId = await api.startChat({
          requestId,
          threadId: thread.id,
          runId,
          model: "drsai",
          workspacePath: "C:\\\\OpenDrSai\\\\workspace",
          messages: [{ role: "user", content: "hello e2e chat" }],
        });
        details.returnedRequestId = returnedRequestId;
        checks.startChatReturned = returnedRequestId === requestId;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !events.some((event) => event.type === "done" || event.type === "error" || event.type === "aborted")) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribe();
      }

      const firstEvent = events[0] || null;
      const lastEvent = events[events.length - 1] || null;
      const terminalEvent = events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
      details.chatSummary = {
        durationMs: Date.now() - startedAt,
        firstEventType: firstEvent && firstEvent.type,
        lastEventType: lastEvent && lastEvent.type,
        terminalEventType: terminalEvent && terminalEvent.type,
      };
      details.events = events.map((event) => ({
        type: event.type,
        at: event.at,
        content: event.content,
        error: event.error,
        sessionId: event.sessionId,
        runId: event.runId,
      }));
      checks.chatStartEvent = events.some((event) => event.type === "start");
      checks.chatThreadEvents = events.every((event) => !event.sessionId || event.sessionId === thread.id);
      checks.chatRunEvents = events.every((event) => !event.runId || event.runId === runId);
      checks.chatDistinctIds = thread.id !== requestId && thread.id !== runId && requestId !== runId;
      checks.chatChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent: hello e2e chat"));
      checks.chatDone = events.some((event) => event.type === "done");
      checks.chatTerminalDone = terminalEvent && terminalEvent.type === "done";
      checks.chatDurationRecorded = details.chatSummary.durationMs >= 0;
      checks.noChatError = !events.some((event) => event.type === "error" || event.type === "aborted");
      const threads = await api.listThreads();
      details.threads = threads;
      checks.chatThreadIdle = threads.some((item) =>
        item.id === thread.id &&
        item.status === "idle" &&
        item.lastRequestId === requestId &&
        item.lastRunId === runId &&
        item.title.includes("hello e2e chat")
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runAgentRunSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const health = await api.getHealth();
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
        gatewayExternalReady: health.gateway && health.gateway.externalReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
      };
      checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && health.gateway.managed);

      const thread = await api.createThread({
        kind: "agent_run",
        title: "E2E agent run thread",
        workspacePath: "C:\\\\OpenDrSai\\\\workspace",
      });
      details.thread = thread;
      checks.threadCreated = Boolean(thread && thread.id && thread.kind === "agent_run");
      const requestId = "e2e-agent-run-request-0001";
      const runId = "e2e-agent-run-run-0001";
      const events = [];
      const startedAt = Date.now();
      const unsubscribe = api.onAgentRunEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      try {
        const returned = await api.startAgentRun({
          requestId,
          threadId: thread.id,
          runId,
          task: "write a short plan",
          workspacePath: "C:\\\\OpenDrSai\\\\workspace",
          files: [{ kind: "file", path: "C:\\\\OpenDrSai\\\\fixtures\\\\notes.md", name: "notes.md" }],
          teamConfig: { preset: "general-collaboration" },
          metadata: { source: "e2e-agent-run" },
        });
        details.returned = returned;
        checks.startAgentRunReturned = returned && returned.requestId === requestId && returned.runId === runId && returned.sessionId === thread.id;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribe();
      }

      const firstEvent = events[0] || null;
      const lastEvent = events[events.length - 1] || null;
      const terminalEvent = events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
      details.agentRunSummary = {
        durationMs: Date.now() - startedAt,
        firstEventType: firstEvent && firstEvent.type,
        lastEventType: lastEvent && lastEvent.type,
        terminalEventType: terminalEvent && terminalEvent.type,
      };
      details.events = events.map((event) => ({
        type: event.type,
        at: event.at,
        content: event.content,
        error: event.error,
        sessionId: event.sessionId,
        runId: event.runId,
      }));
      checks.agentRunStartEvent = events.some((event) => event.type === "start");
      checks.agentRunThreadEvents = events.every((event) => !event.sessionId || event.sessionId === thread.id);
      checks.agentRunDistinctIds = thread.id !== requestId && thread.id !== runId && requestId !== runId;
      checks.agentRunChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent-run: write a short plan"));
      checks.agentRunDone = events.some((event) => event.type === "done");
      checks.agentRunTerminalDone = terminalEvent && terminalEvent.type === "done";
      checks.agentRunDurationRecorded = details.agentRunSummary.durationMs >= 0;
      checks.noAgentRunError = !events.some((event) => event.type === "error" || event.type === "aborted");

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runAgentRunFailureSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectAgentRun(requestId, task, options = {}) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onAgentRunEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          let returned = null;
          let startError = null;
          try {
            returned = await api.startAgentRun({
              requestId,
              runId: requestId,
              sessionId: requestId,
              task,
              workspacePath: "C:\\\\OpenDrSai\\\\workspace",
              teamConfig: { preset: "general-collaboration" },
              metadata: { source: "e2e-agent-run-failures" },
            });
          } catch (error) {
            startError = String(error && error.message ? error.message : error);
          }
          if (options.abortAfterStart && !startError) {
            const abortDeadline = Date.now() + 5000;
            while (Date.now() < abortDeadline && !events.some((event) => event.type === "start")) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await api.abortAgentRun(requestId);
          }
          const deadline = Date.now() + (options.waitMs || 12000);
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const threads = await api.listThreads();
          return {
            returned,
            startError,
            events,
            threads,
            finalThread: threads.find((thread) => thread.id === requestId) || null,
            durationMs: Date.now() - startedAt,
          };
        } finally {
          unsubscribe();
        }
      }

      function summarizeOutcome(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returned: outcome.returned,
          startError: outcome.startError,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
          thread: outcome.finalThread,
          threads: outcome.threads,
        };
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      const scenario = ${JSON.stringify(process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURE_SCENARIO || "")};
      details.scenario = scenario;
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const health = await api.getHealth();
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
      };
      checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && health.gateway.managed);

      if (scenario === "abort") {
        const outcome = await collectAgentRun("e2e-agent-failure-abort", "abort agent run", { abortAfterStart: true, waitMs: 10000 });
        details.abort = summarizeOutcome(outcome);
        checks.abortStart = outcome.events.some((event) => event.type === "start");
        checks.abortEvent = outcome.events.some((event) => event.type === "aborted");
        checks.abortTerminal = details.abort.terminalEventType === "aborted";
        checks.abortThreadError = details.abort.thread && details.abort.thread.status === "error";
        checks.abortNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "sse-error") {
        const outcome = await collectAgentRun("e2e-agent-failure-error", "trigger agent sse error", { waitMs: 10000 });
        details.sseError = summarizeOutcome(outcome);
        checks.sseErrorStart = outcome.events.some((event) => event.type === "start");
        checks.sseErrorEvent = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("synthetic agent error"));
        checks.sseErrorTerminal = details.sseError.terminalEventType === "error";
        checks.sseErrorThreadError = details.sseError.thread && details.sseError.thread.status === "error";
        checks.sseErrorNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "timeout") {
        const outcome = await collectAgentRun("e2e-agent-failure-timeout", "timeout agent run", { waitMs: 10000 });
        details.timeout = summarizeOutcome(outcome);
        checks.timeoutStart = outcome.events.some((event) => event.type === "start");
        checks.timeoutError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("timed out"));
        checks.timeoutTerminal = details.timeout.terminalEventType === "error";
        checks.timeoutThreadError = details.timeout.thread && details.timeout.thread.status === "error";
        checks.timeoutDuration = details.timeout.durationMs >= 1000;
        checks.timeoutNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "chunk-disconnect") {
        const outcome = await collectAgentRun("e2e-agent-failure-disconnect", "disconnect agent run", { waitMs: 10000 });
        details.chunkDisconnect = summarizeOutcome(outcome);
        checks.chunkDisconnectStart = outcome.events.some((event) => event.type === "start");
        checks.chunkDisconnectChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("agent partial before disconnect"));
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("ended before data: [DONE]"));
        checks.chunkDisconnectTerminal = details.chunkDisconnect.terminalEventType === "error";
        checks.chunkDisconnectThreadError = details.chunkDisconnect.thread && details.chunkDisconnect.thread.status === "error";
        checks.chunkDisconnectNoDone = !outcome.events.some((event) => event.type === "done");
      } else {
        checks.knownScenario = false;
        details.error = "Unknown agent run failure scenario.";
      }

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runThreadsSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectChat(requestId, threadId, content) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onChatEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          const returnedRequestId = await api.startChat({
            requestId,
            threadId,
            runId: requestId,
            model: "drsai",
            workspacePath: "C:\\\\OpenDrSai\\\\workspace",
            messages: [{ role: "user", content }],
          });
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { returnedRequestId, events, durationMs: Date.now() - startedAt };
        } finally {
          unsubscribe();
        }
      }
      function summarize(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returnedRequestId: outcome.returnedRequestId,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
        };
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = Boolean(login && login.ok);
      details.phase = ${JSON.stringify(process.env.OPENDRSAI_E2E_THREADS_PHASE || "create")};

      if (details.phase === "list") {
        checks.domReady = true;
        const expectedThreadId = ${JSON.stringify(process.env.OPENDRSAI_E2E_THREADS_ID || "")};
        const threads = await api.listThreads();
        details.threads = threads;
        checks.listReturned = Array.isArray(threads);
        checks.threadPersisted = threads.some((thread) =>
          thread.id === expectedThreadId &&
          thread.kind === "chat" &&
          thread.title.includes("second thread message") &&
          thread.lastRunId === "e2e-thread-run-0002" &&
          thread.lastRequestId === "e2e-thread-run-0002" &&
          thread.status === "idle" &&
          thread.messageCount === 1
        );
        checks.sortedByUpdatedAt = threads.every((thread, index) => index === 0 || threads[index - 1].updatedAt >= thread.updatedAt);
        return { checks, details };
      }

      const created = await api.createThread({
        kind: "chat",
        title: "E2E thread smoke",
        workspacePath: "C:\\\\OpenDrSai\\\\workspace",
      });
      details.created = created;
      checks.createdThread = Boolean(
        created &&
        typeof created.id === "string" &&
        created.id.startsWith("thread-") &&
        created.kind === "chat" &&
        created.messageCount === 0 &&
        Date.parse(created.createdAt) > 0 &&
        Date.parse(created.updatedAt) > 0
      );
      const threadId = created.id;

      const first = await collectChat("e2e-thread-run-0001", threadId, "first thread message");
      const second = await collectChat("e2e-thread-run-0002", threadId, "second thread message");
      details.first = summarize(first);
      details.second = summarize(second);
      const threads = await api.listThreads();
      details.threads = threads;

      checks.firstDone = details.first.terminalEventType === "done";
      checks.secondDone = details.second.terminalEventType === "done";
      checks.sameThreadEvents = details.first.events.every((event) => !event.sessionId || event.sessionId === threadId) &&
        details.second.events.every((event) => !event.sessionId || event.sessionId === threadId);
      checks.distinctRuns = details.first.events.some((event) => event.runId === "e2e-thread-run-0001") &&
        details.second.events.some((event) => event.runId === "e2e-thread-run-0002");
      checks.threadListed = threads.some((thread) =>
        thread.id === threadId &&
        thread.title.includes("second thread message") &&
        thread.lastRunId === "e2e-thread-run-0002" &&
        thread.lastRequestId === "e2e-thread-run-0002" &&
        thread.status === "idle"
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runForkMergeSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const approvedFixture = prepareForkMergeApprovedFixture();
  const conflictFixture = prepareForkMergeConflictFixture();
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const parentPath = ${JSON.stringify(process.env.DRSAI_HOME || "")};
      const sourceWorkspace = await api.createWorkspace({
        source: "empty",
        parentPath,
        name: "fork-merge-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "source" },
      });
      const forkWorkspace = await api.createWorkspace({
        source: "empty",
        parentPath,
        name: "fork-merge-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "worktree" },
      });
      details.sourceWorkspace = sourceWorkspace;
      details.forkWorkspace = forkWorkspace;
      checks.workspacesCreated = Boolean(sourceWorkspace && forkWorkspace && sourceWorkspace.path !== forkWorkspace.path);

      const createdAt = new Date().toISOString();
      const thread = await api.createThread({
        kind: "agent_run",
        title: "E2E fork merge-back smoke",
        workspacePath: forkWorkspace.path,
        fork: {
          sourceWorkspacePath: sourceWorkspace.path,
          repoRoot: sourceWorkspace.path,
          worktreePath: forkWorkspace.path,
          branch: "drsai/e2e-fork-merge",
          baseRef: "HEAD",
          createdAt,
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged merge-back review fixture.",
        },
      });
      details.thread = thread;
      checks.threadCreated = Boolean(
        thread &&
        thread.kind === "agent_run" &&
        thread.fork &&
        thread.fork.lifecycleStatus === "active" &&
        thread.workspacePath === forkWorkspace.path
      );

      const approvalResult = await api.requestForkLifecycleApproval({
        threadId: thread.id,
        action: "merge_back",
      });
      details.approvalResult = approvalResult;
      checks.approvalQueued = Boolean(
        approvalResult &&
        approvalResult.queued === true &&
        approvalResult.approval &&
        approvalResult.approval.actionKind === "fork.lifecycle" &&
        approvalResult.approval.source === "fork"
      );

      const pendingBefore = await api.listPendingApprovals();
      details.pendingBefore = pendingBefore;
      const queuedApproval = pendingBefore.find((approval) =>
        approval.id === approvalResult.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        /merge back/i.test(String(approval.title || ""))
      );
      checks.pendingApprovalListed = Boolean(queuedApproval);
      checks.approvalDetailMentionsBoundaries = Boolean(
        queuedApproval &&
        String(queuedApproval.detail || "").includes(sourceWorkspace.path) &&
        String(queuedApproval.detail || "").includes(forkWorkspace.path)
      );

      const rejected = await api.decideApproval({
        id: approvalResult.approval.id,
        approved: false,
        reason: "reject",
      });
      details.rejected = rejected;
      checks.rejectionAccepted = rejected === true;

      const pendingAfter = await api.listPendingApprovals();
      details.pendingAfter = pendingAfter;
      checks.approvalClearedAfterReject = !pendingAfter.some((approval) => approval.id === approvalResult.approval.id);

      const threadsAfter = await api.listThreads();
      const threadAfter = threadsAfter.find((item) => item.id === thread.id);
      details.threadAfter = threadAfter;
      checks.threadStillActiveAfterReject = Boolean(
        threadAfter &&
        threadAfter.fork &&
        threadAfter.fork.lifecycleStatus === "active" &&
        threadAfter.fork.branch === "drsai/e2e-fork-merge"
      );
      checks.rejectDidNotMergeOrClose = Boolean(
        threadAfter &&
        threadAfter.fork &&
        threadAfter.fork.lifecycleStatus !== "merged" &&
        threadAfter.fork.lifecycleStatus !== "closed" &&
        threadAfter.fork.lifecycleStatus !== "cleanup_pending"
      );

      const approvedFixture = ${JSON.stringify(approvedFixture)};
      const approvedSourceWorkspace = await api.createWorkspace({
        source: "existing",
        path: approvedFixture.sourcePath,
        name: "fork-merge-approved-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "approved-source" },
      });
      const approvedForkWorkspace = await api.createWorkspace({
        source: "existing",
        path: approvedFixture.worktreePath,
        name: "fork-merge-approved-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "approved-worktree" },
      });
      details.approvedSourceWorkspace = approvedSourceWorkspace;
      details.approvedForkWorkspace = approvedForkWorkspace;
      checks.approvedWorkspacesRegistered = Boolean(
        approvedSourceWorkspace &&
        approvedForkWorkspace &&
        approvedSourceWorkspace.path === approvedFixture.sourcePath &&
        approvedForkWorkspace.path === approvedFixture.worktreePath
      );

      const approvedThread = await api.createThread({
        kind: "agent_run",
        title: "E2E approved fork merge-back smoke",
        workspacePath: approvedFixture.worktreePath,
        fork: {
          sourceWorkspacePath: approvedFixture.sourcePath,
          repoRoot: approvedFixture.sourcePath,
          worktreePath: approvedFixture.worktreePath,
          branch: approvedFixture.branch,
          baseRef: approvedFixture.baseRef,
          createdAt: new Date().toISOString(),
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged approved merge-back fixture.",
        },
      });
      details.approvedThread = approvedThread;
      checks.approvedThreadCreated = Boolean(
        approvedThread &&
        approvedThread.kind === "agent_run" &&
        approvedThread.fork &&
        approvedThread.fork.lifecycleStatus === "active"
      );

      const approvedProposal = await api.requestForkLifecycleApproval({
        threadId: approvedThread.id,
        action: "merge_back",
      });
      details.approvedProposal = approvedProposal;
      checks.approvedMergeQueued = Boolean(
        approvedProposal &&
        approvedProposal.queued === true &&
        approvedProposal.approval &&
        approvedProposal.approval.actionKind === "fork.lifecycle"
      );

      const approvedPendingBefore = await api.listPendingApprovals();
      details.approvedPendingBefore = approvedPendingBefore;
      checks.approvedPendingListed = approvedPendingBefore.some((approval) =>
        approval.id === approvedProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        String(approval.detail || "").includes(approvedFixture.sourcePath) &&
        String(approval.detail || "").includes(approvedFixture.worktreePath)
      );

      const approved = await api.decideApproval({
        id: approvedProposal.approval.id,
        approved: true,
        reason: "approve throwaway fixture merge",
      });
      details.approved = approved;
      checks.approvalAccepted = approved === true;

      const approvedPendingAfter = await api.listPendingApprovals();
      details.approvedPendingAfter = approvedPendingAfter;
      checks.approvalClearedAfterApprove = !approvedPendingAfter.some((approval) => approval.id === approvedProposal.approval.id);

      const approvedThreadsAfter = await api.listThreads();
      const approvedThreadAfter = approvedThreadsAfter.find((item) => item.id === approvedThread.id);
      details.approvedThreadAfter = approvedThreadAfter;
      checks.threadMergedAfterApprove = Boolean(
        approvedThreadAfter &&
        approvedThreadAfter.fork &&
        approvedThreadAfter.fork.lifecycleStatus === "merged" &&
        approvedThreadAfter.fork.mergedCommit &&
        approvedThreadAfter.fork.branchCleanupStatus === "pending"
      );
      checks.approvedMergeMessageMentionsCleanup = Boolean(
        approvedThreadAfter &&
        approvedThreadAfter.fork &&
        /retained until discard cleanup is approved/i.test(String(approvedThreadAfter.fork.lifecycleMessage || ""))
      );

      const cleanupProposal = await api.requestForkLifecycleApproval({
        threadId: approvedThread.id,
        action: "discard",
      });
      details.cleanupProposal = cleanupProposal;
      checks.cleanupQueued = Boolean(
        cleanupProposal &&
        cleanupProposal.queued === true &&
        cleanupProposal.approval &&
        cleanupProposal.approval.actionKind === "fork.lifecycle"
      );

      const cleanupPendingBefore = await api.listPendingApprovals();
      details.cleanupPendingBefore = cleanupPendingBefore;
      checks.cleanupPendingListed = cleanupPendingBefore.some((approval) =>
        approval.id === cleanupProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        /discard/i.test(String(approval.title || "")) &&
        /git branch -d/i.test(String(approval.detail || ""))
      );

      const cleanupApproved = await api.decideApproval({
        id: cleanupProposal.approval.id,
        approved: true,
        reason: "approve throwaway fixture cleanup",
      });
      details.cleanupApproved = cleanupApproved;
      checks.cleanupApprovalAccepted = cleanupApproved === true;

      const cleanupPendingAfter = await api.listPendingApprovals();
      details.cleanupPendingAfter = cleanupPendingAfter;
      checks.cleanupClearedAfterApprove = !cleanupPendingAfter.some((approval) => approval.id === cleanupProposal.approval.id);

      const cleanupThreadsAfter = await api.listThreads();
      const cleanupThreadAfter = cleanupThreadsAfter.find((item) => item.id === approvedThread.id);
      details.cleanupThreadAfter = cleanupThreadAfter;
      checks.threadClosedAfterCleanup = Boolean(
        cleanupThreadAfter &&
        cleanupThreadAfter.fork &&
        cleanupThreadAfter.fork.lifecycleStatus === "closed" &&
        cleanupThreadAfter.fork.branchCleanupStatus === "deleted"
      );
      checks.cleanupMessageMentionsBranchDelete = Boolean(
        cleanupThreadAfter &&
        cleanupThreadAfter.fork &&
        /git branch -d/i.test(String(cleanupThreadAfter.fork.branchCleanupMessage || ""))
      );

      const conflictFixture = ${JSON.stringify(conflictFixture)};
      const conflictSourceWorkspace = await api.createWorkspace({
        source: "existing",
        path: conflictFixture.sourcePath,
        name: "fork-merge-conflict-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "conflict-source" },
      });
      const conflictForkWorkspace = await api.createWorkspace({
        source: "existing",
        path: conflictFixture.worktreePath,
        name: "fork-merge-conflict-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "conflict-worktree" },
      });
      details.conflictSourceWorkspace = conflictSourceWorkspace;
      details.conflictForkWorkspace = conflictForkWorkspace;
      checks.conflictWorkspacesRegistered = Boolean(
        conflictSourceWorkspace &&
        conflictForkWorkspace &&
        conflictSourceWorkspace.path === conflictFixture.sourcePath &&
        conflictForkWorkspace.path === conflictFixture.worktreePath
      );

      const conflictThread = await api.createThread({
        kind: "agent_run",
        title: "E2E conflict fork merge-back smoke",
        workspacePath: conflictFixture.worktreePath,
        fork: {
          sourceWorkspacePath: conflictFixture.sourcePath,
          repoRoot: conflictFixture.sourcePath,
          worktreePath: conflictFixture.worktreePath,
          branch: conflictFixture.branch,
          baseRef: conflictFixture.baseRef,
          createdAt: new Date().toISOString(),
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged conflict merge-back fixture.",
        },
      });
      details.conflictThread = conflictThread;
      checks.conflictThreadCreated = Boolean(
        conflictThread &&
        conflictThread.kind === "agent_run" &&
        conflictThread.fork &&
        conflictThread.fork.lifecycleStatus === "active"
      );

      const conflictProposal = await api.requestForkLifecycleApproval({
        threadId: conflictThread.id,
        action: "merge_back",
      });
      details.conflictProposal = conflictProposal;
      checks.conflictMergeQueued = Boolean(
        conflictProposal &&
        conflictProposal.queued === true &&
        conflictProposal.approval &&
        conflictProposal.approval.actionKind === "fork.lifecycle"
      );

      const conflictPendingBefore = await api.listPendingApprovals();
      details.conflictPendingBefore = conflictPendingBefore;
      checks.conflictPendingListed = conflictPendingBefore.some((approval) =>
        approval.id === conflictProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        String(approval.detail || "").includes(conflictFixture.sourcePath) &&
        String(approval.detail || "").includes(conflictFixture.worktreePath)
      );

      const conflictApproved = await api.decideApproval({
        id: conflictProposal.approval.id,
        approved: true,
        reason: "approve throwaway conflict fixture merge",
      });
      details.conflictApproved = conflictApproved;
      checks.conflictApprovalAccepted = conflictApproved === true;

      const conflictPendingAfter = await api.listPendingApprovals();
      details.conflictPendingAfter = conflictPendingAfter;
      checks.conflictClearedAfterApprove = !conflictPendingAfter.some((approval) => approval.id === conflictProposal.approval.id);

      const conflictThreadsAfter = await api.listThreads();
      const conflictThreadAfter = conflictThreadsAfter.find((item) => item.id === conflictThread.id);
      details.conflictThreadAfter = conflictThreadAfter;
      checks.threadMergePendingAfterConflict = Boolean(
        conflictThreadAfter &&
        conflictThreadAfter.fork &&
        conflictThreadAfter.fork.lifecycleStatus === "merge_pending" &&
        /manual conflict resolution/i.test(String(conflictThreadAfter.fork.lifecycleMessage || ""))
      );
      checks.conflictDidNotMarkMerged = Boolean(
        conflictThreadAfter &&
        conflictThreadAfter.fork &&
        conflictThreadAfter.fork.lifecycleStatus !== "merged" &&
        !conflictThreadAfter.fork.mergedCommit
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const mergedContent = readFileSync(join(approvedFixture.sourcePath, "notes.txt"), "utf8");
  const mergedHead = runSmokeGit(approvedFixture.sourcePath, ["rev-parse", "--short=12", "HEAD"]);
  const mergeParents = runSmokeGit(approvedFixture.sourcePath, ["rev-list", "--parents", "-n", "1", "HEAD"]);
  const cleanupBranchExists = smokeGitSucceeds(approvedFixture.sourcePath, ["rev-parse", "--verify", approvedFixture.branch]);
  const conflictContent = readFileSync(join(conflictFixture.sourcePath, "notes.txt"), "utf8");
  const conflictHead = runSmokeGit(conflictFixture.sourcePath, ["rev-parse", "--short=12", "HEAD"]);
  const conflictStatus = runSmokeGit(conflictFixture.sourcePath, ["status", "--porcelain=v1"]);
  result.details.approvedFixture = {
    ...approvedFixture,
    mergedHead,
    mergeParents,
    cleanupBranchExists,
    cleanupWorktreeExists: existsSync(approvedFixture.worktreePath),
  };
  result.details.conflictFixture = {
    ...conflictFixture,
    conflictHead,
    conflictStatus,
  };
  result.checks.approvedSourceContainsForkChange =
    normalizeSmokeText(mergedContent) === normalizeSmokeText(approvedFixture.expectedContent);
  result.checks.approvedSourceHeadAdvanced = mergedHead !== approvedFixture.baseRef;
  result.checks.approvedMergeCommitHasTwoParents = mergeParents.trim().split(/\s+/).length === 3;
  result.checks.cleanupRemovedWorktree = !existsSync(approvedFixture.worktreePath);
  result.checks.cleanupDeletedMergedBranch = !cleanupBranchExists;
  result.checks.conflictSourceContentPreserved =
    normalizeSmokeText(conflictContent) === normalizeSmokeText(conflictFixture.sourceContent);
  result.checks.conflictSourceHeadPreserved = conflictHead === conflictFixture.sourceHead;
  result.checks.conflictMergeWasAborted = conflictStatus.trim() === "";

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function prepareForkMergeApprovedFixture(): ForkMergeApprovedFixture {
  const fixtureRoot = join(process.env.DRSAI_HOME || "", "desktop", "fork-worktrees", "e2e-fork-merge-approved");
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the approved fork merge-back fixture.");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
  const sourcePath = join(fixtureRoot, "source");
  const worktreePath = join(fixtureRoot, "worktree");
  const branch = "drsai/e2e-approved-merge";
  mkdirSync(sourcePath, { recursive: true });

  runSmokeGit(sourcePath, ["init"]);
  runSmokeGit(sourcePath, ["config", "user.email", "desktop-e2e@opendrsai.local"]);
  runSmokeGit(sourcePath, ["config", "user.name", "OpenDrSai Desktop E2E"]);
  runSmokeGit(sourcePath, ["checkout", "-B", "main"]);
  writeFileSync(join(sourcePath, "notes.txt"), "base\n", "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "base"]);
  const baseRef = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  runSmokeGit(sourcePath, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  const expectedContent = "base\napproved merge\n";
  writeFileSync(join(worktreePath, "notes.txt"), expectedContent, "utf8");
  runSmokeGit(worktreePath, ["add", "notes.txt"]);
  runSmokeGit(worktreePath, ["commit", "-m", "approved fork change"]);
  const forkCommit = runSmokeGit(worktreePath, ["rev-parse", "--short=12", "HEAD"]);

  return {
    fixtureRoot,
    sourcePath,
    worktreePath,
    branch,
    baseRef,
    forkCommit,
    expectedContent,
  };
}

function prepareForkMergeConflictFixture(): ForkMergeConflictFixture {
  const fixtureRoot = join(process.env.DRSAI_HOME || "", "desktop", "fork-worktrees", "e2e-fork-merge-conflict");
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the conflict fork merge-back fixture.");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
  const sourcePath = join(fixtureRoot, "source");
  const worktreePath = join(fixtureRoot, "worktree");
  const branch = "drsai/e2e-conflict-merge";
  mkdirSync(sourcePath, { recursive: true });

  runSmokeGit(sourcePath, ["init"]);
  runSmokeGit(sourcePath, ["config", "user.email", "desktop-e2e@opendrsai.local"]);
  runSmokeGit(sourcePath, ["config", "user.name", "OpenDrSai Desktop E2E"]);
  runSmokeGit(sourcePath, ["checkout", "-B", "main"]);
  writeFileSync(join(sourcePath, "notes.txt"), "base\n", "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "base"]);
  const baseRef = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  runSmokeGit(sourcePath, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  writeFileSync(join(worktreePath, "notes.txt"), "base\nfork conflicting change\n", "utf8");
  runSmokeGit(worktreePath, ["add", "notes.txt"]);
  runSmokeGit(worktreePath, ["commit", "-m", "conflicting fork change"]);
  const forkCommit = runSmokeGit(worktreePath, ["rev-parse", "--short=12", "HEAD"]);

  const sourceContent = "base\nsource conflicting change\n";
  writeFileSync(join(sourcePath, "notes.txt"), sourceContent, "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "source conflicting change"]);
  const sourceHead = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  return {
    fixtureRoot,
    sourcePath,
    worktreePath,
    branch,
    baseRef,
    sourceHead,
    forkCommit,
    sourceContent,
  };
}

function runSmokeGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function normalizeSmokeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function smokeGitSucceeds(cwd: string, args: string[]): boolean {
  try {
    runSmokeGit(cwd, args);
    return true;
  } catch {
    return false;
  }
}

async function runOidcSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const expectsFakeIdentity = ${JSON.stringify(!process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER)};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      function publicSessionLooksOidc(session) {
        return Boolean(
          session &&
          session.authenticated === true &&
          session.authMode === "oidc" &&
          session.authProvider === "hai" &&
          session.user &&
          typeof session.user.id === "string" && session.user.id.length > 0 &&
          typeof session.user.email === "string" && session.user.email.includes("@") &&
          Array.isArray(session.user.roles) &&
          session.user.roles.length > 0 &&
          Array.isArray(session.user.groups) &&
          session.user.groups.length > 0 &&
          (!expectsFakeIdentity || (
            session.user.id === "e2e-hai-user" &&
            session.user.email === "e2e-hai-user@ihep.ac.cn" &&
            session.user.roles.includes("user") &&
            session.user.groups.includes("desktop-e2e")
          )) &&
          session.refreshable === true &&
          !("accessToken" in session) &&
          !("refreshToken" in session) &&
          !("idToken" in session)
        );
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      details.domTextSample = document.body.innerText.slice(0, 300);
      if (!api) return { checks, details };

      const login = await api.startOidcLogin({ rememberMe: true });
      details.login = {
        ok: login && login.ok,
        message: login && login.message,
        session: login && login.session,
      };
      checks.oidcLoginOk = Boolean(login && login.ok);
      checks.oidcPublicSession = publicSessionLooksOidc(login && login.session);

      const bootstrap = await api.bootstrapDesktop();
      details.bootstrap = bootstrap;
      checks.oidcBootstrapReady = Boolean(
        bootstrap && bootstrap.ready &&
        bootstrap.defaults && bootstrap.defaults.modelAlias === "drsai" &&
        Array.isArray(bootstrap.models) && bootstrap.models.some((model) => model.id === "drsai") &&
        bootstrap.capabilities && bootstrap.capabilities.chat === true &&
        bootstrap.capabilities.tools.includes("files") &&
        bootstrap.capabilities.tools.includes("shell") &&
        bootstrap.capabilities.tools.includes("git")
      );

      const restored = await api.getAuthSession();
      details.restored = restored;
      checks.restoredSession = publicSessionLooksOidc(restored);

      const refreshed = await api.refreshAuthSession();
      details.refreshed = refreshed;
      checks.refreshSession = publicSessionLooksOidc(refreshed);

      const health = await api.getHealth();
      details.gateway = {
        gatewayReady: health && health.gatewayReady,
        gatewayManaged: health && health.gateway && health.gateway.managed,
      };
      checks.oidcGatewayReady = Boolean(health && health.gatewayReady && health.gateway && health.gateway.managed);

      const chatRequestId = "e2e-oidc-chat-0001";
      const chatEvents = [];
      const unsubscribeChat = api.onChatEvent((event) => {
        if (event.requestId === chatRequestId) chatEvents.push(event);
      });
      try {
        const returnedChatRequestId = await api.startChat({
          requestId: chatRequestId,
          model: "drsai",
          messages: [{ role: "user", content: "oidc chat bearer check" }],
        });
        details.oidcChatReturnedRequestId = returnedChatRequestId;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && !chatEvents.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribeChat();
      }
      details.oidcChatEvents = chatEvents.map((event) => ({
        type: event.type,
        requestId: event.requestId,
        content: event.content,
        error: event.error,
      }));
      checks.oidcChatStart = chatEvents.some((event) => event.type === "start");
      checks.oidcChatChunk = chatEvents.some((event) => event.type === "chunk" && String(event.content || "").includes("oidc chat bearer ok"));
      checks.oidcChatDone = chatEvents.some((event) => event.type === "done");
      checks.oidcChatNoError = !chatEvents.some((event) => event.type === "error" || event.type === "aborted");

      const agentRequestId = "e2e-oidc-agent-0001";
      const agentEvents = [];
      const unsubscribeAgent = api.onAgentRunEvent((event) => {
        if (event.requestId === agentRequestId) agentEvents.push(event);
      });
      try {
        const returnedAgent = await api.startAgentRun({
          requestId: agentRequestId,
          sessionId: "e2e-oidc-agent-session",
          runId: "e2e-oidc-agent-run",
          task: "oidc agent bearer check",
          model: "drsai",
          metadata: { source: "e2e-oidc" },
        });
        details.oidcAgentReturned = returnedAgent;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && !agentEvents.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribeAgent();
      }
      details.oidcAgentEvents = agentEvents.map((event) => ({
        type: event.type,
        requestId: event.requestId,
        content: event.content,
        error: event.error,
      }));
      checks.oidcAgentStart = agentEvents.some((event) => event.type === "start");
      checks.oidcAgentChunk = agentEvents.some((event) => event.type === "chunk" && String(event.content || "").includes("oidc agent bearer ok"));
      checks.oidcAgentDone = agentEvents.some((event) => event.type === "done");
      checks.oidcAgentNoError = !agentEvents.some((event) => event.type === "error" || event.type === "aborted");

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const storage = readOidcSessionStorageForSmoke();
  result.details.storage = storage.details;
  result.checks.sessionFileExists = storage.checks.exists;
  result.checks.sessionUsesEncryptedTokens = storage.checks.usesEncryptedTokens;
  result.checks.sessionOmitsPlainTokens = storage.checks.omitsPlainTokens;

  const logout = (await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const logout = await api.logout({ clearLocalData: false });
      const afterLogout = await api.getAuthSession();
      return {
        logout,
        afterLogout,
        logoutOk: Boolean(logout && logout.ok),
        afterLogoutAnonymous: Boolean(afterLogout && afterLogout.authenticated === false),
      };
    })()
  `)) as {
    logout?: unknown;
    afterLogout?: unknown;
    logoutOk?: boolean;
    afterLogoutAnonymous?: boolean;
  };
  result.details.logout = logout.logout;
  result.details.afterLogout = logout.afterLogout;
  result.checks.logoutOk = Boolean(logout.logoutOk);
  result.checks.afterLogoutAnonymous = Boolean(logout.afterLogoutAnonymous);

  const afterLogoutStorage = readOidcSessionStorageForSmoke();
  result.details.afterLogoutStorage = afterLogoutStorage.details;
  result.checks.logoutClearsSessionFile = !afterLogoutStorage.checks.exists;

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function readOidcSessionStorageForSmoke(): {
  checks: { exists: boolean; usesEncryptedTokens: boolean; omitsPlainTokens: boolean };
  details: Record<string, unknown>;
} {
  const sessionPath = join(process.env.DRSAI_HOME || "", "auth", "auth.json");
  if (!process.env.DRSAI_HOME || !existsSync(sessionPath)) {
    return {
      checks: { exists: false, usesEncryptedTokens: false, omitsPlainTokens: false },
      details: { sessionPath, exists: false },
    };
  }
  const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
  const keys = Object.keys(parsed).sort();
  return {
    checks: {
      exists: true,
      usesEncryptedTokens: Boolean(
        parsed.encryptedAccessToken &&
          parsed.encryptedRefreshToken &&
          parsed.encryptedIdToken,
      ),
      omitsPlainTokens: !("accessToken" in parsed) && !("refreshToken" in parsed) && !("idToken" in parsed),
    },
    details: {
      sessionPath,
      exists: true,
      keys,
      authMode: parsed.authMode,
      authProvider: parsed.authProvider,
      hasEncryptedAccessToken: Boolean(parsed.encryptedAccessToken),
      hasEncryptedRefreshToken: Boolean(parsed.encryptedRefreshToken),
      hasEncryptedIdToken: Boolean(parsed.encryptedIdToken),
      hasPlainAccessToken: "accessToken" in parsed,
      hasPlainRefreshToken: "refreshToken" in parsed,
      hasPlainIdToken: "idToken" in parsed,
    },
  };
}

async function runSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const channelImportFixture = prepareChannelImportFixture();
  const ideContextFixtures = prepareIdeContextFixtures();
  const workspaceReviewFixture = prepareWorkspaceReviewFixture();
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      details.domTextSample = document.body.innerText.slice(0, 300);
      if (!api) return { checks, details };

      const health = await api.getHealth();
      details.health = {
        installed: health.installed,
        gatewayReady: health.gatewayReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
        home: health.install && health.install.home,
        apiKeyConfigured: health.install && health.install.apiKeyConfigured,
        bundledBackendAvailable: health.install && health.install.bundledBackendAvailable,
      };
      checks.health = Boolean(health.install && health.install.home);
      checks.bundledBackendAvailable = Boolean(
        health.install && health.install.bundledBackendAvailable,
      );
      checks.unmanagedGatewayRejected = Boolean(
        health.gateway &&
          health.gateway.externalReady === true &&
          health.gateway.externalConflict === true &&
          health.gatewayReady === false,
      );

      const save = await api.saveApiKey("opendrsai-packaged-smoke-key");
      details.saveApiKey = save;
      checks.productionApiKeyRejected = Boolean(
        save && save.ok === false && String(save.message || "").includes("OIDC")
      );

      const afterSave = await api.getHealth();
      details.afterSave = {
        apiKeyConfigured: afterSave.install && afterSave.install.apiKeyConfigured,
      };
      checks.apiKeyStatusUnchanged = Boolean(
        afterSave.install && afterSave.install.apiKeyConfigured === false,
      );

      const badKey = await api.saveApiKey("bad\\nkey");
      details.badKey = badKey;
      checks.badApiKeyRejected = Boolean(badKey && badKey.ok === false);

      let invalidChatRejected = false;
      try {
        await api.startChat({ requestId: "packaged-smoke-invalid", messages: [] });
      } catch (error) {
        details.invalidChatError = String(error && error.message ? error.message : error);
        invalidChatRejected = true;
      }
      checks.invalidChatRejected = invalidChatRejected;

      const outsidePathResult = await api.openPath("C:\\\\\\\\Windows\\\\\\\\win.ini");
      details.outsidePathResult = outsidePathResult;
      checks.openPathOutsideRejected =
        String(outsidePathResult).includes("outside DrSai home") ||
        String(outsidePathResult).includes("not registered as a DrSai or workspace path");

      const reviewFixture = ${JSON.stringify(workspaceReviewFixture)};
      const reviewWorkspace = await api.createWorkspace({ source: "existing", path: reviewFixture.workspacePath, name: "packaged-review-workspace", trusted: true });
      checks.reviewWorkspaceRegistered = Boolean(reviewWorkspace && reviewWorkspace.path === reviewFixture.workspacePath);
      const stageDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath });
      const stageProposal = await api.stageWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath, expectedDiffHash: stageDiff.diffHash });
      const stageApproved = await api.decideApproval({ id: stageProposal.approvalId, approved: true });
      const stagedDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath, staged: true });
      details.stageReview = { stageDiff, stageProposal, stageApproved, stagedDiff };
      checks.fileAcceptRequiresApproval = Boolean(stageProposal.approvalQueued && stageProposal.approvalId && stageApproved);
      checks.fileAcceptStagesReviewedDiff = Boolean(stagedDiff.diff && stagedDiff.diff.includes("accepted packaged change"));

      const revertDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath });
      const revertProposal = await api.revertWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath, expectedDiffHash: revertDiff.diffHash });
      const revertApproved = await api.decideApproval({ id: revertProposal.approvalId, approved: true });
      const revertedDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath });
      details.revertReview = { revertDiff, revertProposal, revertApproved, revertedDiff };
      checks.fileRejectRequiresApproval = Boolean(revertProposal.approvalQueued && revertProposal.approvalId && revertApproved);
      checks.fileRejectClearsReviewedDiff = Boolean(!revertedDiff.diff);

      const staleDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stalePath });
      const staleProposal = await api.revertWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stalePath, expectedDiffHash: staleDiff.diffHash });
      const staleTerminal = await api.createTerminal({ cwd: reviewFixture.workspacePath, workspaceKey: "packaged-review", shellProfile: "cmd", title: "stale-review-writer" });
      await api.writeTerminal(staleTerminal.id, "echo external edit after review>>stale.txt\\r");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await api.killTerminal(staleTerminal.id);
      let staleApprovalRejected = false;
      try {
        await api.decideApproval({ id: staleProposal.approvalId, approved: true });
      } catch (error) {
        details.staleReviewError = String(error && error.message ? error.message : error);
        staleApprovalRejected = String(details.staleReviewError).includes("diff changed since review");
      }
      checks.staleReviewedDiffRejected = staleApprovalRejected;

      let traversalRejected = false;
      try {
        await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: "../outside.txt" });
      } catch (error) {
        details.reviewTraversalError = String(error && error.message ? error.message : error);
        traversalRejected = true;
      }
      checks.reviewPathTraversalRejected = traversalRejected;

      const nonGitWorkspace = await api.createWorkspace({ source: "existing", path: reviewFixture.nonGitWorkspacePath, name: "packaged-non-git-review", trusted: true });
      const nonGitCheckpoint = await api.createWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, label: "Before non-Git packaged edit", maxFiles: 20 });
      const nonGitTerminal = await api.createTerminal({ cwd: reviewFixture.nonGitWorkspacePath, workspaceKey: "packaged-non-git", shellProfile: "cmd", title: "non-git-writer" });
      await api.writeTerminal(nonGitTerminal.id, "echo changed without git>>notes.txt\\r");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await api.killTerminal(nonGitTerminal.id);
      const nonGitPreview = await api.previewWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      const nonGitRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      const nonGitRestoreApproved = await api.decideApproval({ id: nonGitRestore.approvalId, approved: true });
      const nonGitPreviewAfter = await api.previewWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      details.nonGitReview = { nonGitWorkspace, nonGitCheckpoint, nonGitPreview, nonGitRestore, nonGitRestoreApproved, nonGitPreviewAfter };
      checks.nonGitBaselineCaptured = Boolean(nonGitCheckpoint.entries && nonGitCheckpoint.entries.some((entry) => entry.relativePath === reviewFixture.nonGitFilePath && entry.stored));
      checks.nonGitChangeDetected = Boolean(nonGitPreview.changedEntryCount === 1 && nonGitPreview.entries.some((entry) => entry.change === "modified"));
      checks.nonGitRestoreRequiresApproval = Boolean(nonGitRestore.approvalQueued && nonGitRestore.approvalId && nonGitRestoreApproved);
      checks.nonGitRestoreClearsChanges = Boolean(nonGitPreviewAfter.changedEntryCount === 0);

      const channelImportFixture = ${JSON.stringify(channelImportFixture)};
      const channelImport = await api.importChannelContext({
        adapterId: "file-input",
        workspacePath: channelImportFixture.workspacePath,
        paths: channelImportFixture.filePaths,
        limit: 7,
      });
      const channelImportItems = channelImport && channelImport.items ? channelImport.items : [];
      const channelImportItemByTitle = (title) => channelImportItems.find((item) => item && (item.title === title || item.relativePath === title));
      const markdownImportItem = channelImportItemByTitle("packaged-channel-import.md");
      const cypressImportItem = channelImportItemByTitle("packaged.cypress-results.json");
      const pngImportItem = channelImportItemByTitle("packaged-channel-import.png");
      const sarifImportItem = channelImportItemByTitle("packaged-results.sarif.json");
      const chatExportImportItem = channelImportItemByTitle("packaged-slack-export.json");
      const emlxImportItem = channelImportItemByTitle("packaged-message.emlx");
      const icsImportItem = channelImportItemByTitle("packaged-calendar.ics");
      details.channelImport = channelImport;
      checks.channelImportViaPreloadIpc = Boolean(channelImport && channelImport.adapterId === "file-input" && channelImportItems.length === 7);
      checks.channelImportWorkspaceBounded = Boolean(channelImport && channelImport.workspacePath === channelImportFixture.workspacePath);
      checks.channelImportMarkdownSummary = Boolean(
        markdownImportItem &&
          String(markdownImportItem.summary || "").includes("packaged channel import fixture") &&
          String(markdownImportItem.summary || "").includes("Markdown preview read local text only")
      );
      checks.channelImportCypressSummary = Boolean(
        cypressImportItem &&
          String(cypressImportItem.summary || "").includes("Test report preview (Cypress JSON") &&
          String(cypressImportItem.summary || "").includes("Cases: 2; passed: 1; non-passing: 1; skipped: 0") &&
          String(cypressImportItem.summary || "").includes("Packaged smoke > fails visibly [failed]") &&
          String(cypressImportItem.summary || "").includes("token=[redacted]") &&
          !String(cypressImportItem.summary || "").includes("secret-packaged-cypress-token")
      );
      checks.channelImportImageSummary = Boolean(
        pngImportItem &&
          String(pngImportItem.summary || "").includes("Image metadata preview") &&
          String(pngImportItem.summary || "").includes("Format: PNG") &&
          String(pngImportItem.summary || "").includes("1 x 1 px") &&
          String(pngImportItem.summary || "").includes("no OCR, vision model, network call, or provider send")
      );
      checks.channelImportSarifSummary = Boolean(
        sarifImportItem &&
          String(sarifImportItem.summary || "").includes("SARIF static analysis result preview") &&
          String(sarifImportItem.summary || "").includes("CodeQL") &&
          String(sarifImportItem.summary || "").includes("js/path-injection") &&
          String(sarifImportItem.summary || "").includes("src/routes.ts:44") &&
          String(sarifImportItem.summary || "").includes("SARIF extension provenance was preserved") &&
          String(sarifImportItem.summary || "").includes("no scanner/test runner/code execution") &&
          String(sarifImportItem.mime || "").includes("application/sarif+json")
      );
      checks.channelImportChatExportSummary = Boolean(
        chatExportImportItem &&
          String(chatExportImportItem.summary || "").includes("Chat export JSON preview (Slack export JSON") &&
          String(chatExportImportItem.summary || "").includes("packaged-smoke-channel") &&
          String(chatExportImportItem.summary || "").includes("Packaged Slack export message") &&
          String(chatExportImportItem.summary || "").includes("token=[redacted]") &&
          !String(chatExportImportItem.summary || "").includes("secret-packaged-slack-token") &&
          String(chatExportImportItem.summary || "").includes("no Slack/Teams/ChatGPT/OpenAI connector login") &&
          String(chatExportImportItem.mime || "").includes("application/vnd.drsai.chat-export+json")
      );
      checks.channelImportEmlxSummary = Boolean(
        emlxImportItem &&
          String(emlxImportItem.summary || "").includes("Email message preview") &&
          String(emlxImportItem.summary || "").includes("Packaged Apple Mail smoke") &&
          String(emlxImportItem.summary || "").includes("Apple Mail EMLX envelope metadata was stripped") &&
          String(emlxImportItem.summary || "").includes("Packaged EMLX body token=[redacted]") &&
          !String(emlxImportItem.summary || "").includes("secret-packaged-emlx-token") &&
          !String(emlxImportItem.summary || "").includes("<?xml") &&
          String(emlxImportItem.summary || "").includes("no IMAP/SMTP login") &&
          String(emlxImportItem.mime || "").includes("message/rfc822")
      );
      checks.channelImportIcsSummary = Boolean(
        icsImportItem &&
          String(icsImportItem.summary || "").includes("Calendar ICS file preview") &&
          String(icsImportItem.summary || "").includes("Packaged calendar review") &&
          String(icsImportItem.summary || "").includes("Project sync token=[redacted]") &&
          !String(icsImportItem.summary || "").includes("secret-packaged-ics-token") &&
          String(icsImportItem.summary || "").includes("no calendar app access") &&
          String(icsImportItem.mime || "").includes("text/calendar")
      );
      checks.channelImportNoProviderSend = Boolean(
        channelImport &&
          String(channelImport.verification || "").includes("Read-only channel import is limited to workspace-local file summaries")
      );

      const ideContextFixtures = ${JSON.stringify(ideContextFixtures)};
      const ideContexts = [];
      for (const fixture of ideContextFixtures) {
        ideContexts.push(await api.getIdeContext(fixture.workspacePath));
      }
      details.ideContexts = ideContexts;
      checks.ideContextViaPreloadIpc = ideContexts.length === 3 && ideContexts.every((context) => context && context.available === true);
      checks.ideContextSources = ideContexts.every((context, index) => context && context.source === ideContextFixtures[index].source);
      checks.ideContextCurrentFiles = ideContexts.every((context, index) =>
        context &&
          context.currentFile &&
          context.currentFile.relativePath === ideContextFixtures[index].relativePath &&
          String(context.currentFile.path || "").endsWith(ideContextFixtures[index].relativePath.replace(/\\//g, "\\\\"))
      );
      checks.ideContextSelections = ideContexts.every((context, index) =>
        context &&
          context.currentSelection &&
          context.currentSelection.relativePath === ideContextFixtures[index].relativePath &&
          context.currentSelection.text === ideContextFixtures[index].selectionText &&
          context.currentSelection.truncated === false
      );
      checks.ideContextWorkspaceBounded = ideContexts.every((context, index) =>
        context && context.workspacePath === ideContextFixtures[index].workspacePath
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  result.checks.nonGitRestoreRestoresDisk =
    normalizeSmokeText(readFileSync(join(workspaceReviewFixture.nonGitWorkspacePath, workspaceReviewFixture.nonGitFilePath), "utf8")).trimEnd() ===
    normalizeSmokeText(workspaceReviewFixture.nonGitBaseContent).trimEnd();

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function prepareWorkspaceReviewFixture(): WorkspaceReviewFixture {
  if (!process.env.DRSAI_HOME) throw new Error("DRSAI_HOME is required for workspace review smoke.");
  const workspacePath = join(process.env.DRSAI_HOME, "desktop", "workspace-review-e2e");
  removeSmokeFixture(workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  runSmokeGit(workspacePath, ["init"]);
  runSmokeGit(workspacePath, ["config", "user.email", "packaged-review@opendrsai.local"]);
  runSmokeGit(workspacePath, ["config", "user.name", "OpenDrSai Packaged Review"]);
  const stagePath = "accept.txt";
  const revertPath = "reject.txt";
  const stalePath = "stale.txt";
  const revertBaseContent = "base reject content\n";
  writeFileSync(join(workspacePath, stagePath), "base accept content\n", "utf8");
  writeFileSync(join(workspacePath, revertPath), revertBaseContent, "utf8");
  writeFileSync(join(workspacePath, stalePath), "base stale content\n", "utf8");
  runSmokeGit(workspacePath, ["add", "."]);
  runSmokeGit(workspacePath, ["commit", "-m", "workspace review base"]);
  const stageChangedContent = "base accept content\naccepted packaged change\n";
  writeFileSync(join(workspacePath, stagePath), stageChangedContent, "utf8");
  writeFileSync(join(workspacePath, revertPath), "base reject content\nrejected packaged change\n", "utf8");
  writeFileSync(join(workspacePath, stalePath), "base stale content\nreviewed change\n", "utf8");
  const nonGitWorkspacePath = join(process.env.DRSAI_HOME, "desktop", "non-git-review-e2e");
  removeSmokeFixture(nonGitWorkspacePath);
  mkdirSync(nonGitWorkspacePath, { recursive: true });
  const nonGitFilePath = "notes.txt";
  const nonGitBaseContent = "non-git baseline content\n";
  writeFileSync(join(nonGitWorkspacePath, nonGitFilePath), nonGitBaseContent, "utf8");
  return { workspacePath, stagePath, revertPath, stalePath, stageChangedContent, revertBaseContent, nonGitWorkspacePath, nonGitFilePath, nonGitBaseContent };
}

function prepareChannelImportFixture(): ChannelImportFixture {
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the packaged channel import fixture.");
  }
  const workspacePath = join(process.env.DRSAI_HOME, "desktop", "channel-import-e2e", "workspace");
  removeSmokeFixture(workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  const filePath = join(workspacePath, "packaged-channel-import.md");
  writeFileSync(
    filePath,
    [
      "# Packaged channel import fixture",
      "",
      "This packaged channel import fixture verifies real preload IPC to the main-process file-input adapter.",
      "",
    ].join("\n"),
    "utf8",
  );
  const cypressJsonPath = join(workspacePath, "packaged.cypress-results.json");
  writeFileSync(
    cypressJsonPath,
    JSON.stringify({
      totalTests: 2,
      totalPassed: 1,
      totalFailed: 1,
      totalPending: 0,
      totalSkipped: 0,
      totalDuration: 1250,
      runs: [
        {
          spec: { relative: "cypress/e2e/packaged-smoke.cy.ts", name: "packaged-smoke.cy.ts" },
          stats: { tests: 2, passes: 1, failures: 1, pending: 0, skipped: 0, wallClockDuration: 1250 },
          tests: [
            { title: ["Packaged smoke", "imports markdown"], state: "passed", attempts: [{ state: "passed" }] },
            {
              title: ["Packaged smoke", "fails visibly"],
              state: "failed",
              displayError: "Packaged Cypress failure token=secret-packaged-cypress-token",
              attempts: [{ state: "failed" }],
            },
          ],
        },
      ],
    }, null, 2),
    "utf8",
  );
  const pngPath = join(workspacePath, "packaged-channel-import.png");
  writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUzf4QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const sarifJsonPath = join(workspacePath, "packaged-results.sarif.json");
  writeFileSync(
    sarifJsonPath,
    JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "CodeQL", rules: [{ id: "js/path-injection" }] } },
          results: [
            {
              ruleId: "js/path-injection",
              level: "warning",
              message: { text: "Packaged smoke detected untrusted path construction." },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/routes.ts" },
                    region: { startLine: 44 },
                  },
                },
              ],
            },
          ],
        },
      ],
    }, null, 2),
    "utf8",
  );
  const chatExportJsonPath = join(workspacePath, "packaged-slack-export.json");
  writeFileSync(
    chatExportJsonPath,
    JSON.stringify([
      {
        type: "message",
        channel: "packaged-smoke-channel",
        user: "U-packaged-smoke",
        ts: "1783702800.000100",
        text: "Packaged Slack export message token=secret-packaged-slack-token",
      },
    ], null, 2),
    "utf8",
  );
  const emlxPath = join(workspacePath, "packaged-message.emlx");
  const emlxMessage = [
    "From: packaged-sender@example.test",
    "To: packaged-reviewer@example.test",
    "Subject: Packaged Apple Mail smoke",
    "Date: Sat, 11 Jul 2026 09:15:00 +0800",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Packaged EMLX body token=secret-packaged-emlx-token",
  ].join("\r\n");
  writeFileSync(
    emlxPath,
    [
      String(Buffer.byteLength(emlxMessage, "utf8")),
      emlxMessage,
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<plist version=\"1.0\"><dict><key>flags</key><integer>0</integer></dict></plist>",
    ].join("\n"),
    "utf8",
  );
  const icsPath = join(workspacePath, "packaged-calendar.ics");
  writeFileSync(
    icsPath,
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenDrSai//Packaged Smoke//EN",
      "BEGIN:VEVENT",
      "UID:packaged-calendar-smoke@example.test",
      "DTSTAMP:20260711T020000Z",
      "DTSTART:20260711T033000Z",
      "DTEND:20260711T040000Z",
      "SUMMARY:Packaged calendar review",
      "LOCATION:Project sync token=secret-packaged-ics-token",
      "DESCRIPTION:Review packaged calendar IPC fixture.",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
    "utf8",
  );
  return {
    workspacePath,
    markdownPath: filePath,
    cypressJsonPath,
    pngPath,
    sarifJsonPath,
    chatExportJsonPath,
    emlxPath,
    icsPath,
    filePaths: [filePath, cypressJsonPath, pngPath, sarifJsonPath, chatExportJsonPath, emlxPath, icsPath],
  };
}

function prepareIdeContextFixtures(): IdeContextFixture[] {
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the packaged IDE context fixture.");
  }
  const sources: IdeContextFixture["source"][] = ["vscode", "jetbrains", "visual_studio"];
  const selectionTexts: Record<IdeContextFixture["source"], string> = {
    vscode: "packaged vscode IDE selection",
    jetbrains: "packaged jetbrains IDE selection",
    visual_studio: "packaged visual_studio IDE selection",
  };
  return sources.map((source) => {
    const workspacePath = join(process.env.DRSAI_HOME || "", "desktop", "ide-context-e2e", source, "workspace");
    removeSmokeFixture(workspacePath);
    const sourceDir = join(workspacePath, "src");
    const drsaiDir = join(workspacePath, ".drsai");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(drsaiDir, { recursive: true });
    const relativePath = "src/packaged-ide-context.ts";
    const sourcePath = join(workspacePath, "src", "packaged-ide-context.ts");
    const selectionText = selectionTexts[source];
    writeFileSync(
      sourcePath,
      [
        "export function packagedIdeContextFixture() {",
        `  return ${JSON.stringify(selectionText)};`,
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(drsaiDir, "ide-context.json"),
      JSON.stringify({
        source,
        capturedAt: "2026-07-11T09:30:00.000Z",
        currentFile: {
          path: sourcePath,
          relativePath,
          language: "typescript",
          line: 2,
          column: 10,
        },
        currentSelection: {
          path: sourcePath,
          relativePath,
          language: "typescript",
          startLine: 2,
          endLine: 2,
          text: selectionText,
        },
      }, null, 2),
      "utf8",
    );
    return {
      source,
      workspacePath,
      sourcePath,
      relativePath,
      selectionText,
    };
  });
}

function writeResult(path: string, result: SmokeResult): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function removeSmokeFixture(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    // Antivirus/indexing services can briefly retain handles after the
    // terminal and Git subprocesses exit on Windows.
    maxRetries: 10,
    retryDelay: 250,
  });
}
