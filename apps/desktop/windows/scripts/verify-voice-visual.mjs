import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const evidenceDir = join(root, "out", "verification", "voice-visual");
const axePath = join(root, "node_modules", "axe-core", "axe.min.js");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const chromePath = browserCandidates.find((candidate) => existsSync(candidate));

assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before running voice visual verification.");
assert.ok(chromePath, `Chrome or Edge executable not found. Checked: ${browserCandidates.join(", ")}`);
assert.ok(existsSync(axePath), "axe-core is required for voice accessibility verification.");
mkdirSync(evidenceDir, { recursive: true });

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  if (pathname === "/__voice-test__/axe.min.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(readFileSync(axePath));
    return;
  }
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let filePath = resolve(distDir, relativePath);
  if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }
  response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
  response.end(readFileSync(filePath));
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, colorScheme: "light" });
const results = [];
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));

try {
  await page.addInitScript(() => {
    class FakeTrack {
      listeners = new Map();
      addEventListener(type, listener) { this.listeners.set(type, listener); }
      stop() {}
    }
    class FakeStream {
      track = new FakeTrack();
      getAudioTracks() { return [this.track]; }
      getTracks() { return [this.track]; }
    }
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable = null;
      onerror = null;
      onstop = null;
      constructor(stream) { this.stream = stream; }
      start() { this.state = "recording"; }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["fixture-voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    class FakeAudioContext {
      state = "running";
      sampleRate = 48000;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() { return { connect(target) { return target; }, disconnect() {} }; }
      createGain() { return { gain: { value: 1 }, connect(target) { return target; }, disconnect() {} }; }
      createAnalyser() {
        return {
          fftSize: 64,
          smoothingTimeConstant: 0,
          getFloatTimeDomainData(samples) {
            for (let index = 0; index < samples.length; index += 1) {
              samples[index] = Math.sin(index / 2) * 0.48;
            }
          },
        };
      }
      resume() { return Promise.resolve(); }
      close() { this.state = "closed"; return Promise.resolve(); }
    }
    class FakeAudioWorkletNode {
      port = { onmessage: null };
      constructor() {
        window.setTimeout(() => {
          const samples = new Float32Array(9600);
          for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 8) * 0.4;
          this.port.onmessage?.({ data: { type: "audio", channels: [samples] } });
        }, 60);
      }
      connect(target) { return target; }
      disconnect() {}
    }
    class FakeSpeechSynthesisUtterance {
      constructor(text) { this.text = text; }
      lang = "";
      rate = 1;
      voice = null;
      onend = null;
      onerror = null;
    }
    const streamingAudioState = { playCount: 0, pauseCount: 0, endedCount: 0, active: 0 };
    class FakeAudio {
      currentTime = 0;
      onended = null;
      onerror = null;
      timer = null;
      constructor(url) { this.url = url; }
      play() {
        streamingAudioState.playCount += 1;
        streamingAudioState.active += 1;
        this.timer = window.setTimeout(() => {
          this.timer = null;
          streamingAudioState.active = Math.max(0, streamingAudioState.active - 1);
          streamingAudioState.endedCount += 1;
          this.onended?.();
        }, 600);
        return Promise.resolve();
      }
      pause() {
        streamingAudioState.pauseCount += 1;
        if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; streamingAudioState.active = Math.max(0, streamingAudioState.active - 1); }
      }
      removeAttribute(name) {
        if (name === "src") this.url = "";
      }
      load() {}
    }
    const speechState = { cancelCount: 0, pauseCount: 0, resumeCount: 0, speakCount: 0, utterance: null };
    const speechSynthesis = {
      paused: false,
      pending: false,
      speaking: false,
      addEventListener() {},
      removeEventListener() {},
      getVoices: () => [{ name: "Fixture Voice", lang: "zh-CN", default: true }],
      speak(utterance) { speechState.speakCount += 1; speechState.utterance = utterance; this.speaking = true; },
      pause() { speechState.pauseCount += 1; this.paused = true; },
      resume() { speechState.resumeCount += 1; this.paused = false; },
      cancel() { speechState.cancelCount += 1; this.speaking = false; this.paused = false; },
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      addEventListener() {},
      removeEventListener() {},
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "fixture-mic", label: "Fixture microphone" }],
      getUserMedia: async () => {
        if (window.__voiceForceCaptureError) {
          throw new Error("Microphone initialization failed because the selected Windows audio device became unavailable while permission and privacy settings were being checked. Choose another microphone and try again.");
        }
        return new FakeStream();
      },
    } });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "AudioWorkletNode", { configurable: true, value: FakeAudioWorkletNode });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeSpeechSynthesisUtterance });
    Object.defineProperty(window, "Audio", { configurable: true, value: FakeAudio });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speechSynthesis });
    window.__voiceFixtureSpeechState = speechState;
    window.__streamingAudioState = streamingAudioState;
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
  });

  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  await page.addScriptTag({ url: `http://127.0.0.1:${address.port}/__voice-test__/axe.min.js` });
  const assertAccessible = async (selector, name) => {
    const violations = await page.evaluate(async ({ contextSelector }) => {
      const result = await window.axe.run(document.querySelector(contextSelector), {
        resultTypes: ["violations"],
      });
      return result.violations
        .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => ({ html: node.html, target: node.target })),
        }));
    }, { contextSelector: selector });
    assert.deepEqual(violations, [], `${name}: serious accessibility violations: ${JSON.stringify(violations)}`);
  };
  const developerWorkspaceButton = page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ });
  await page.waitForFunction(() => Boolean(
    document.querySelector('[data-testid="developer-workspace-login"]')
    || document.querySelector('[data-testid="composer-input"]'),
  )).catch(async (error) => {
    const bodyText = (await page.locator("body").innerText()).slice(0, 2000);
    throw new Error(`${error.message}; body=${JSON.stringify(bodyText)}; pageErrors=${JSON.stringify(runtimeErrors)}`);
  });
  if (await developerWorkspaceButton.isVisible().catch(() => false)) await developerWorkspaceButton.click();
  await page.locator('[data-testid="composer-input"]').waitFor({ state: "visible" });
  const voiceMode = page.locator('[data-testid="composer-voice-mode"]');
  assert.equal(await voiceMode.inputValue(), "serial", "serial voice must remain the default mode");
  assert.equal(await voiceMode.locator('option[value="streaming"]').isDisabled(), false, "fixture streaming input must be selectable");
  const setConfirmBeforeSend = async (confirmBeforeSend) => page.evaluate((enabled) => {
    const raw = window.localStorage.getItem("opendrsai.voicePreferences.v1");
    const stored = raw ? JSON.parse(raw) : null;
    const preferences = {
      autoReadResponses: false,
      confirmBeforeSend: enabled,
      inputDeviceId: "",
      inputLanguage: "auto",
      interactionMode: "serial",
      playbackRate: 1,
      remoteSttConsent: false,
      remoteTtsConsent: false,
      synthesisMode: "system",
      voiceName: "",
      ...(stored?.preferences || {}),
      confirmBeforeSend: enabled,
    };
    window.localStorage.setItem("opendrsai.voicePreferences.v1", JSON.stringify({ version: 4, preferences }));
    window.dispatchEvent(new CustomEvent("opendrsai:voice-preferences-changed", { detail: preferences }));
  }, confirmBeforeSend);
  await setConfirmBeforeSend(true);
  await page.evaluate(() => {
    window.__voiceTurnPhases = [];
    const composer = document.querySelector("form.composer");
    const record = () => {
      const phase = composer?.getAttribute("data-voice-turn-phase");
      if (phase && window.__voiceTurnPhases.at(-1) !== phase) window.__voiceTurnPhases.push(phase);
    };
    record();
    new MutationObserver(record).observe(composer, { attributes: true, attributeFilter: ["data-voice-turn-phase"] });
  });
  const capture = page.locator(".composer-voice-capture");
  const composerInput = page.locator('[data-testid="composer-input"]');
  await composerInput.fill("Verify microphone access while a reply is running.");
  await page.locator("form.composer").evaluate((form) => form.requestSubmit());
  await page.locator(".composer-submit.stop").waitFor({ state: "visible" });
  const busyVoiceButton = page.getByRole("button", { name: "Start voice recording" });
  assert.equal(await busyVoiceButton.isDisabled(), false, "voice capture must remain enabled while chat is active");
  await busyVoiceButton.click();
  await capture.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("form.composer")?.getAttribute("data-voice-turn-phase") === "recording");
  results.push({ name: "busy-chat-voice-entry", captureVisible: true });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await capture.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  await page.locator(".composer-submit.stop").waitFor({ state: "hidden" });
  const serialUserMessages = page.locator("article.message.user").filter({ hasText: "Fixture voice transcript." });
  await page.evaluate(() => {
    const originalGetVoiceRuntimeStatus = window.openDrSai.getVoiceRuntimeStatus.bind(window.openDrSai);
    window.__voiceRuntimeCheckCount = 0;
    window.openDrSai.getVoiceRuntimeStatus = async (...args) => {
      window.__voiceRuntimeCheckCount += 1;
      return originalGetVoiceRuntimeStatus(...args);
    };
  });
  await page.getByRole("button", { name: "Start voice recording" }).click();
  await capture.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("form.composer")?.getAttribute("data-voice-turn-phase") === "recording");
  assert.equal(
    await page.evaluate(() => window.__voiceRuntimeCheckCount),
    0,
    "starting microphone capture must not wait for voice provider readiness",
  );
  await page.waitForTimeout(350);
  await assertAccessible(".composer", "recording composer");

  const inspectCapture = async (name) => {
    const metrics = await page.evaluate(() => {
      const captureElement = document.querySelector(".composer-voice-capture");
      const wave = document.querySelector(".composer-voice-wave");
      const bars = [...document.querySelectorAll(".composer-voice-wave-bar")];
      const captureRect = captureElement?.getBoundingClientRect();
      const waveRect = wave?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        captureWidth: captureRect?.width || 0,
        waveWidth: waveRect?.width || 0,
        barCount: bars.length,
        visibleBars: bars.filter((bar) => Number.parseFloat(getComputedStyle(bar).opacity) > 0).length,
        maxBarHeight: Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().height)),
      };
    });
    console.log(`${name}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.captureWidth > 120, `${name}: capture bar is too narrow.`);
    assert.ok(metrics.waveWidth > 50, `${name}: waveform has no responsive width.`);
    assert.ok(metrics.barCount >= 20, `${name}: waveform history is missing.`);
    assert.ok(metrics.visibleBars > 0 && metrics.maxBarHeight > 4, `${name}: non-silent input did not produce amplitude.`);
    assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, `${name}: page has horizontal overflow.`);
    const screenshotPath = join(evidenceDir, `${name}-recording.png`);
    const screenshot = await page.screenshot({ path: screenshotPath });
    assert.ok(screenshot.length > 20_000, `${name}: screenshot is unexpectedly blank.`);
    results.push({ name, ...metrics, screenshotPath, screenshotBytes: screenshot.length });
    return metrics;
  };

  const desktop = await inspectCapture("desktop");
  await page.locator(".composer-voice-stop").click();
  const serialProcessingIndicator = page.locator(".composer-voice-button .thread-activity-bubble.running");
  await serialProcessingIndicator.waitFor({ state: "visible" });
  const serialComposer = page.locator('[data-testid="composer-input"]');
  await serialComposer.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-testid="composer-input"]')?.value === "Fixture voice transcript.");
  assert.equal(await page.locator(".composer-voice-review").count(), 0, "serial transcription must not open a separate review panel");
  const review = page.getByRole("textbox", { name: "Review voice transcript" });
  assert.ok(
    await page.evaluate(() => window.__voiceRuntimeCheckCount >= 1),
    "voice provider readiness must be checked after recording stops",
  );
  assert.equal(await serialComposer.inputValue(), "Fixture voice transcript.");
  await assertAccessible(".composer", "serial transcript in composer");
  await serialComposer.fill("");
  await setConfirmBeforeSend(false);
  await voiceMode.selectOption("streaming");
  await page.evaluate(() => { window.__voiceFixtureSlowNetwork = true; });
  assert.equal(await voiceMode.inputValue(), "streaming", "streaming mode selection did not persist in the composer");
  await page.getByRole("button", { name: "Start voice recording" }).click();
  const liveCapture = page.locator(".composer-voice-capture.streaming");
  await liveCapture.waitFor({ state: "visible" });
  await page.getByText("Fixture live…").waitFor({ state: "visible" });
  await page.getByText(/连接较慢|Connection is slow/).waitFor({ state: "visible" });
  assert.equal(await page.locator(".composer-voice-live-transcript .unstable").getAttribute("aria-label"), "Interim transcript");
  assert.equal(await voiceMode.isDisabled(), true, "mode switch must be locked during streaming capture");
  await page.getByRole("button", { name: "Stop live transcription" }).click();
  await review.waitFor({ state: "visible" });
  assert.equal(await review.inputValue(), "Fixture streaming transcript.");
  await review.dispatchEvent("compositionstart");
  assert.equal(await page.getByRole("button", { name: "Insert" }).isDisabled(), true, "IME composition must prevent premature transcript insertion");
  await review.dispatchEvent("compositionend");
  assert.equal(await page.getByRole("button", { name: "Insert" }).isDisabled(), false, "transcript insertion must recover after IME composition");
  await page.getByRole("button", { name: "Insert" }).click();
  const streamingComposer = page.locator('[data-testid="composer-input"]');
  assert.equal(await streamingComposer.inputValue(), "Fixture streaming transcript.");
  await page.locator("form.composer").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => window.__streamingAudioState.playCount > 0);
  const streamingPause = page.getByRole("button", { name: "Pause streaming reply" });
  await streamingPause.waitFor({ state: "visible" });
  await streamingPause.click();
  const streamingResume = page.getByRole("button", { name: "Resume streaming reply" });
  await streamingResume.waitFor({ state: "visible" });
  await streamingResume.click();
  await page.waitForFunction(() => window.__streamingAudioState.endedCount > 0 && window.__streamingAudioState.active === 0);
  const streamingOutputMetrics = await page.evaluate(() => ({ ...window.__streamingAudioState }));
  assert.ok(streamingOutputMetrics.playCount >= 1, "streaming voice response did not play synthesized segments");
  assert.ok(streamingOutputMetrics.pauseCount >= 1, "streaming reply pause did not reach the audio element");
  results.push({ name: "streaming-voice-output", ...streamingOutputMetrics });
  await page.evaluate(() => { window.__voiceFixtureSlowNetwork = false; });
  await voiceMode.selectOption("serial");
  assert.equal(await voiceMode.inputValue(), "serial", "serial mode must remain available after a streaming turn");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 820 });
  await page.getByRole("button", { name: "Start voice recording" }).click();
  await capture.waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  const narrow = await inspectCapture("narrow");
  assert.ok(narrow.waveWidth <= desktop.waveWidth - 60, "waveform width did not follow the narrower composer.");
  const reducedMotionTransition = await page.locator(".composer-voice-wave-bar").first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  assert.ok(reducedMotionTransition <= 0.001, `reduced motion transition remained ${reducedMotionTransition}s`);

  const serialUserCountBeforeNarrow = await serialUserMessages.count();
  await page.locator(".composer-voice-stop").click();
  const composer = page.locator('[data-testid="composer-input"]');
  await page.waitForFunction(({ previousCount }) => {
    return [...document.querySelectorAll("article.message.user")]
      .filter((element) => element.textContent?.includes("Fixture voice transcript.")).length > previousCount;
  }, { previousCount: serialUserCountBeforeNarrow });
  const completedReply = page.locator("article.message.assistant").filter({ hasText: "Mock desktop chat stream." }).last();
  await completedReply.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("form.composer")?.getAttribute("data-voice-turn-phase") === "completed");
  assert.equal(await composer.inputValue(), "", "automatic voice submission did not clear the composer");
  const readButton = completedReply.locator('button[title="朗读回复"], button[title="Read response aloud"]');
  await readButton.waitFor({ state: "visible" });
  const playbackBeforeRead = await page.evaluate(() => ({ ...window.__streamingAudioState }));
  await readButton.click();
  const pauseButton = page.locator('button[title="暂停朗读"], button[title="Pause reading"]').last();
  const playbackError = completedReply.locator(".message-action-error");
  await Promise.race([
    pauseButton.waitFor({ state: "visible" }),
    playbackError.waitFor({ state: "visible" }),
  ]);
  if (await playbackError.isVisible().catch(() => false)) {
    const diagnostics = await page.evaluate(async () => window.openDrSai.getDiagnosticSnapshot({ module: "voice", limit: 50 }));
    throw new Error(`voice playback failed: ${await playbackError.innerText()}; diagnostics=${JSON.stringify(diagnostics.events)}`);
  }
  const playingScreenshotPath = join(evidenceDir, "narrow-playing.png");
  const playingScreenshot = await page.screenshot({ path: playingScreenshotPath });
  assert.ok(playingScreenshot.length > 20_000, "playing screenshot is unexpectedly blank.");
  await assertAccessible(".message-actions.active", "voice playback controls");
  await pauseButton.click();
  const resumeButton = page.locator('button[title="继续朗读"], button[title="Resume reading"]').last();
  await resumeButton.waitFor({ state: "visible" });
  await resumeButton.click();
  await pauseButton.waitFor({ state: "visible" });
  assert.equal(await completedReply.locator(".message-actions").getAttribute("aria-live"), "polite");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => window.__streamingAudioState.active === 0);
  const speechMetrics = await page.evaluate(() => ({
    audio: { ...window.__streamingAudioState },
    cancelCount: window.__voiceFixtureSpeechState.cancelCount,
    pauseCount: window.__voiceFixtureSpeechState.pauseCount,
    resumeCount: window.__voiceFixtureSpeechState.resumeCount,
    speakCount: window.__voiceFixtureSpeechState.speakCount,
    spokenTextLength: window.__voiceFixtureSpeechState.utterance?.text.length || 0,
  }));
  assert.ok(speechMetrics.cancelCount >= 1, "stopping playback did not cancel system speech.");
  assert.ok(speechMetrics.audio.playCount > playbackBeforeRead.playCount, "the selected assistant response did not start audio playback");
  assert.ok(speechMetrics.audio.pauseCount >= playbackBeforeRead.pauseCount + 2, "pause and lifecycle stop did not reach the audio element");
  const turnPhases = await page.evaluate(() => window.__voiceTurnPhases);
  for (const requiredPhase of ["requesting_permission", "recording", "preparing_audio", "transcribing", "ready_to_send", "submitting", "awaiting_response", "response_ready", "completed"]) {
    assert.ok(turnPhases.includes(requiredPhase), `serial turn did not expose ${requiredPhase}: ${turnPhases.join(" -> ")}`);
  }
  results.push({ name: "serial-turn", ...speechMetrics, turnPhases, screenshotPath: playingScreenshotPath, screenshotBytes: playingScreenshot.length });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  await voiceMode.selectOption("streaming");
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__assistantSpeechEvents = [];
    window.addEventListener("opendrsai:assistant-speech-stream", (event) => window.__assistantSpeechEvents.push(event.detail));
  });
  await composer.fill("Verify streaming assistant segmentation.");
  await page.locator("form.composer").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => {
    const form = document.querySelector("form.composer");
    return form?.getAttribute("data-streaming-speech-completed") === "true"
      && Number(form.getAttribute("data-streaming-speech-segments")) > 0;
  }, null, { timeout: 30_000 }).catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({
      events: window.__assistantSpeechEvents,
      completed: document.querySelector("form.composer")?.getAttribute("data-streaming-speech-completed"),
      count: document.querySelector("form.composer")?.getAttribute("data-streaming-speech-segments"),
      input: document.querySelector('[data-testid="composer-input"]')?.value,
    }));
    throw new Error(`${error.message}; speech diagnostics=${JSON.stringify(diagnostics)}`);
  });
  const segmentMetrics = await page.locator("form.composer").evaluate((form) => ({
    completed: form.getAttribute("data-streaming-speech-completed"),
    count: Number(form.getAttribute("data-streaming-speech-segments")),
  }));
  assert.equal(segmentMetrics.completed, "true");
  assert.ok(segmentMetrics.count > 0, "assistant SSE text did not produce a speech segment");
  results.push({ name: "streaming-assistant-segmentation", ...segmentMetrics });
  await voiceMode.selectOption("serial");
  assert.equal(await voiceMode.inputValue(), "serial", "serial mode did not recover after streaming verification");
  await page.evaluate(() => {
    window.__voiceForceCaptureError = true;
  });
  for (const zoom of [1.5, 2]) {
    await page.evaluate((value) => { document.body.style.zoom = String(value); }, zoom);
    await page.getByRole("button", { name: "Start voice recording" }).click();
    const errorStatus = page.locator(".composer-voice-status.error");
    const selectedDebugTab = page.locator('.debug-view-tabs button[aria-selected="true"]');
    await selectedDebugTab.waitFor({ state: "visible" });
    assert.match(await selectedDebugTab.innerText(), /App/, "voice capture failure did not open the App Errors debug view");
    const diagnosticError = page.locator(".app-error-view .diagnostic-error-card").first();
    await diagnosticError.waitFor({ state: "visible" });
    assert.match(await diagnosticError.innerText(), /Microphone initialization failed/);
    const captureFailure = await page.evaluate(async () => {
      const snapshot = await window.openDrSai.getDiagnosticSnapshot({ module: "voice", limit: 200 });
      return snapshot.events.find((event) => event.operation === "voice.capture" && event.status === "failed");
    });
    assert.ok(captureFailure, "voice capture failure was not persisted in diagnostics");
    assert.equal(captureFailure.domain, "app");
    assert.equal(captureFailure.level, "error");
    assert.ok(captureFailure.stack?.length, "voice capture diagnostic did not preserve the error stack");
    assert.equal(captureFailure.attributes?.stage, "capture_initialization");
    await page.locator('[data-testid="titlebar-right-panel-toggle"]').evaluate((button) => button.click());
    await errorStatus.waitFor({ state: "visible" });
    const metrics = await errorStatus.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        right: rect.right,
        scrollWidth: element.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${zoom * 100}%: long voice error text overflowed its container.`);
    assert.ok(metrics.right <= metrics.viewportWidth + 1, `${zoom * 100}%: voice error escaped the viewport.`);
    const screenshotPath = join(evidenceDir, `voice-error-${Math.round(zoom * 100)}.png`);
    const screenshot = await page.screenshot({ path: screenshotPath });
    assert.ok(screenshot.length > 20_000, `${zoom * 100}%: error screenshot is unexpectedly blank.`);
    results.push({ name: `error-${Math.round(zoom * 100)}`, ...metrics, screenshotPath, screenshotBytes: screenshot.length });
  }
  await page.evaluate(() => { document.body.style.zoom = ""; });
  const invalidTransitions = await page.evaluate(async () => {
    const snapshot = await window.openDrSai.getDiagnosticSnapshot({ module: "voice", limit: 200 });
    return snapshot.events.filter((event) => event.component === "turn" && event.errorCode === "invalid_transition");
  });
  assert.deepEqual(invalidTransitions, [], `serial voice UI emitted invalid transitions: ${JSON.stringify(invalidTransitions)}`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

const reportPath = join(evidenceDir, "report.json");
writeFileSync(reportPath, `${JSON.stringify({ ok: true, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`Voice visual and serial-turn verification passed (${results.length + 1} screenshots, report: ${reportPath}).`);
