import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopVoiceSynthesisResult } from "../../../shared/api/desktopApi";
import type { SystemVoiceSynthesizer } from "../../../shared/main/voiceTts";

const TTS_TIMEOUT_MS = 60_000;

export const synthesizeWithWindowsSpeech: SystemVoiceSynthesizer = async (request, parentSignal) => {
  const dir = await mkdtemp(join(tmpdir(), "opendrsai-tts-"));
  const scriptPath = join(dir, "speak.ps1");
  const wavPath = join(dir, "speech.wav");
  const payloadPath = join(dir, "text.txt");
  try {
    await writeFile(payloadPath, request.text, "utf8");
    const rate = Math.max(-10, Math.min(10, Math.round((request.speed - 1) * 10)));
    const preferredVoice = request.voice?.trim() ?? "";
    const language = (request.language || "zh-CN").replace(/'/g, "''");
    const voiceBlock = preferredVoice
      ? `
  $preferred = '${preferredVoice.replace(/'/g, "''")}'
  try { $synth.SelectVoice($preferred) } catch {
    $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $preferred } | Select-Object -First 1
    if (-not $match) { $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ('${language}'.Split('-')[0] + '*') } | Select-Object -First 1 }
    if ($match) { $synth.SelectVoice($match.VoiceInfo.Name) }
  }`
      : `
  $match = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ('${language}'.Split('-')[0] + '*') } | Select-Object -First 1
  if ($match) { $synth.SelectVoice($match.VoiceInfo.Name) }`;
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.Rate = ${rate}
${voiceBlock}
  $text = [System.IO.File]::ReadAllText(${JSON.stringify(payloadPath)}, [System.Text.Encoding]::UTF8)
  $synth.SetOutputToWaveFile(${JSON.stringify(wavPath)})
  $synth.Speak($text)
  $synth.SetOutputToNull()
} finally { $synth.Dispose() }
`;
    await writeFile(scriptPath, script, "utf8");
    await runPowerShell(scriptPath, parentSignal);
    const audioData = new Uint8Array(await readFile(wavPath));
    if (audioData.byteLength < 44) throw new Error("Windows speech synthesis produced empty audio.");
    const result: DesktopVoiceSynthesisResult = {
      audioData,
      mimeType: "audio/wav",
      runtimeId: "system",
      createdAt: new Date().toISOString(),
      providerDisclosure: "Reply text was synthesized locally with Windows Speech API.",
    };
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

function runPowerShell(scriptPath: string, parentSignal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { windowsHide: true });
    let stderr = "";
    const finish = (error?: Error): void => error ? reject(error) : resolve();
    const timer = setTimeout(() => { child.kill(); finish(new Error("Windows speech synthesis timed out.")); }, TTS_TIMEOUT_MS);
    const onAbort = (): void => { child.kill(); finish(new DOMException("Cancelled", "AbortError")); };
    parentSignal.addEventListener("abort", onAbort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); parentSignal.removeEventListener("abort", onAbort); finish(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
      if (parentSignal.aborted) return finish(new DOMException("Cancelled", "AbortError"));
      if (code === 0) return finish();
      finish(new Error(stderr.trim() || `Windows speech synthesis failed (exit ${code ?? "unknown"}).`));
    });
  });
}
