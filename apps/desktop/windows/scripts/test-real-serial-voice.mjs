import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const stage = String(args.stage || process.env.OPENDRSAI_VOICE_TEST_STAGE || "all").toLowerCase();
assert.ok(["asr", "llm", "tts", "all"].includes(stage), "--stage must be asr, llm, tts, or all");

const gatewayBaseUrl = String(
  args.gateway || process.env.OPENDRSAI_GATEWAY_BASE_URL || "http://127.0.0.1:18642",
).replace(/\/$/, "");
const token = await readGatewayToken(args.token);
const headers = { "X-OpenDrSai-Gateway-Token": token };
const verbose = Boolean(args.verbose);

await requestJson(`${gatewayBaseUrl}/health`, { headers }, "Gateway health");

const results = {};
let transcript = String(args.prompt || process.env.OPENDRSAI_LLM_TEST_PROMPT || "Reply with OK only.");

if (stage === "asr" || stage === "all") {
  const audioPath = resolve(String(args.audio || process.env.OPENDRSAI_VOICE_LIVE_FIXTURE || ""));
  assert.ok(audioPath && existsSync(audioPath), "Provide --audio <path> or set OPENDRSAI_VOICE_LIVE_FIXTURE");
  const audio = await readFile(audioPath);
  assert.ok(audio.length > 0 && audio.length <= 10 * 1024 * 1024, "ASR fixture must be between 1 byte and 10 MB");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeTypeFor(audioPath) }), audioPath.split(/[\\/]/).at(-1));
  form.append("model", String(args.asrModel || process.env.OPENDRSAI_ASR_MODEL || "whisper-1"));
  const language = String(args.language || process.env.OPENDRSAI_VOICE_TEST_LANGUAGE || "").trim();
  if (language) form.append("language", language);

  const startedAt = performance.now();
  const payload = await requestJson(`${gatewayBaseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(readPositiveInt("OPENDRSAI_ASR_TEST_TIMEOUT_MS", 75_000)),
  }, "ASR");
  transcript = String(payload.text || "").trim();
  assert.ok(transcript, "ASR response did not contain text");
  results.asr = { elapsedMs: elapsed(startedAt), textChars: transcript.length };
  if (verbose) results.asr.transcript = transcript;
}

let assistantText = String(args.ttsText || process.env.OPENDRSAI_TTS_TEST_TEXT || "Voice provider test completed.");
if (stage === "llm" || stage === "all") {
  const startedAt = performance.now();
  const response = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-OpenDrSai-User": "voice-provider-test",
      "X-OpenDrSai-Auth-Mode": "offline",
    },
    body: JSON.stringify({
      model: String(args.model || process.env.OPENDRSAI_LLM_TEST_MODEL || "gpt-5.4"),
      messages: [{ role: "user", content: transcript }],
      stream: true,
      user_id: "voice-provider-test",
      thread_id: `thread-voice-provider-${crypto.randomUUID()}`,
      work_dir: process.cwd(),
      metadata: {
        auth_mode: "offline",
        desktop_request_id: `voice-provider-${crypto.randomUUID()}`,
        thinking_effort: String(args.effort || process.env.OPENDRSAI_LLM_TEST_EFFORT || "none"),
      },
    }),
    signal: AbortSignal.timeout(readPositiveInt("OPENDRSAI_LLM_TEST_TIMEOUT_MS", 120_000)),
  });
  const streamText = await response.text();
  assertResponseOk(response, streamText, "LLM");
  const parsed = parseSse(streamText);
  assert.ok(parsed.done, "LLM stream ended without [DONE]");
  assert.ok(!parsed.error, `LLM returned an error: ${parsed.error || "unknown"}`);
  assistantText = parsed.content.trim();
  assert.ok(assistantText, "LLM stream did not contain assistant text");
  results.llm = { elapsedMs: elapsed(startedAt), textChars: assistantText.length, completed: true };
  if (verbose) results.llm.response = assistantText;
}

if (stage === "tts" || stage === "all") {
  const startedAt = performance.now();
  const response = await fetch(`${gatewayBaseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: assistantText,
      language: String(args.language || process.env.OPENDRSAI_VOICE_TEST_LANGUAGE || "") || undefined,
      voice: String(args.voice || process.env.OPENDRSAI_TTS_TEST_VOICE || "alloy"),
      speed: Number(args.speed || process.env.OPENDRSAI_TTS_TEST_SPEED || 1),
      format: String(args.format || process.env.OPENDRSAI_TTS_TEST_FORMAT || "mp3"),
    }),
    signal: AbortSignal.timeout(readPositiveInt("OPENDRSAI_TTS_TEST_TIMEOUT_MS", 75_000)),
  });
  const contentType = response.headers.get("content-type") || "";
  const audio = new Uint8Array(await response.arrayBuffer());
  assertResponseOk(response, new TextDecoder().decode(audio.slice(0, 2048)), "TTS");
  assert.ok(contentType.startsWith("audio/"), `TTS returned unexpected content type: ${contentType}`);
  assert.ok(audio.length > 0 && audio.length <= 10 * 1024 * 1024, "TTS audio must be between 1 byte and 10 MB");
  assertAudioSignature(audio, contentType);
  results.tts = { elapsedMs: elapsed(startedAt), audioBytes: audio.length, contentType };
}

console.log(JSON.stringify({ ok: true, stage, gatewayBaseUrl, results }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--verbose") parsed.verbose = true;
    else if (value.startsWith("--")) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const next = argv[index + 1];
      assert.ok(next && !next.startsWith("--"), `${value} requires a value`);
      parsed[key] = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

async function readGatewayToken(configuredToken) {
  if (configuredToken) return String(configuredToken).trim();
  if (process.env.OPENDRSAI_GATEWAY_INSTANCE_TOKEN?.trim()) {
    return process.env.OPENDRSAI_GATEWAY_INSTANCE_TOKEN.trim();
  }
  const tokenPath = process.env.OPENDRSAI_GATEWAY_TOKEN_PATH || join(homedir(), ".drsai", "runtime", "instance-token");
  return (await readFile(tokenPath, "utf8")).trim();
}

async function requestJson(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  assertResponseOk(response, text, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function assertResponseOk(response, body, label) {
  if (response.ok) return;
  const safeBody = String(body || "").slice(0, 1000).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_KEY]");
  throw new Error(`${label} failed with HTTP ${response.status}: ${safeBody}`);
}

function parseSse(streamText) {
  let content = "";
  let done = false;
  let error = "";
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    if (!data) continue;
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    if (payload.error) {
      error = String(payload.error.message || payload.error.code || payload.error);
      continue;
    }
    const delta = payload.choices?.[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
  }
  return { content, done, error };
}

function assertAudioSignature(bytes, contentType) {
  const startsWith = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (contentType.includes("mpeg")) {
    assert.ok(startsWith(0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), "TTS MP3 signature is invalid");
  } else if (contentType.includes("wav")) {
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF", "TTS WAV signature is invalid");
  } else if (contentType.includes("ogg")) {
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "OggS", "TTS Ogg signature is invalid");
  }
}

function mimeTypeFor(filePath) {
  return {
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
  }[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function elapsed(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function printHelp() {
  console.log(`Usage: node scripts/test-real-serial-voice.mjs [options]

Options:
  --stage <asr|llm|tts|all>  Test one provider stage or the complete serial chain
  --audio <path>             Audio fixture for ASR/all
  --prompt <text>            Prompt for an LLM-only test
  --tts-text <text>          Text for a TTS-only test
  --model <alias>            Gateway LLM alias (default: gpt-5.4)
  --language <locale>        ASR/TTS language hint
  --voice <name>             TTS voice (default: alloy)
  --format <mp3|wav|opus>    TTS output format (default: mp3)
  --gateway <url>            Gateway URL (default: http://127.0.0.1:18642)
  --verbose                  Print transcript and model response
  --help                     Show this help
`);
}
