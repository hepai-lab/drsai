import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { DesktopVoicePreferences, DesktopVoicePreferencesUpdateRequest } from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const FILE = join(DRSAI_HOME, "desktop", "voice-preferences.json");
const defaults: DesktopVoicePreferences = {
  schemaVersion: 11, revision: 0, realtimeOptIn: false, selectedMode: "serial",
  serial: { inputDeviceId: "", language: "auto", confirmBeforeSend: true },
  duplex: { inputDeviceId: "", outputDeviceId: "", language: "auto", voice: "", volume: 1, autoRecovery: true, transcriptPolicy: "stable", disclosureFingerprint: "" },
  playback: { autoReadResponses: false, playbackRate: 1, remoteSttConsent: false, remoteTtsConsent: false, synthesisMode: "system", voiceName: "" },
};
let writeQueue = Promise.resolve<unknown>(undefined);

export async function getVoicePreferences(): Promise<DesktopVoicePreferences> {
  try { return validate(JSON.parse(await readFile(FILE, "utf8"))); } catch { return structuredClone(defaults); }
}

export function updateVoicePreferences(request: DesktopVoicePreferencesUpdateRequest): Promise<DesktopVoicePreferences> {
  const operation = writeQueue.then(async () => {
    const current = await getVoicePreferences();
    if (!Number.isSafeInteger(request?.expectedRevision) || request.expectedRevision !== current.revision) {
      const error = new Error("Voice preferences changed in another window.");
      Object.assign(error, { code: "VOICE_PREFERENCES_REVISION_CONFLICT", current });
      throw error;
    }
    const next = validate({ ...request.preferences, revision: current.revision + 1 });
    await mkdir(dirname(FILE), { recursive: true });
    const temporary = `${FILE}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, FILE);
    return next;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function validate(raw: unknown): DesktopVoicePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Voice preferences are invalid.");
  const value = raw as Partial<DesktopVoicePreferences>;
  const serial = value.serial as DesktopVoicePreferences["serial"] | undefined;
  const duplex = value.duplex as DesktopVoicePreferences["duplex"] | undefined;
  const playback = value.playback as DesktopVoicePreferences["playback"] | undefined;
  if (value.schemaVersion !== 11 || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0 || !serial || !duplex || !playback) throw new Error("Voice preferences are invalid.");
  const lang = (v: unknown) => v === "zh-CN" || v === "en-US" ? v : "auto";
  const txt = (v: unknown, max = 10_000) => typeof v === "string" ? v.slice(0, max) : "";
  const optIn = value.realtimeOptIn === true;
  return {
    schemaVersion: 11, revision: value.revision!, realtimeOptIn: optIn, selectedMode: optIn && value.selectedMode === "duplex" ? "duplex" : "serial",
    serial: { inputDeviceId: txt(serial.inputDeviceId), language: lang(serial.language), confirmBeforeSend: serial.confirmBeforeSend !== false },
    duplex: { inputDeviceId: txt(duplex.inputDeviceId), outputDeviceId: txt(duplex.outputDeviceId), language: lang(duplex.language), voice: txt(duplex.voice, 80), volume: typeof duplex.volume === "number" && Number.isFinite(duplex.volume) ? Math.min(1, Math.max(0, duplex.volume)) : 1, autoRecovery: duplex.autoRecovery !== false, transcriptPolicy: duplex.transcriptPolicy === "none" ? "none" : "stable", disclosureFingerprint: txt(duplex.disclosureFingerprint, 500) },
    playback: { autoReadResponses: playback.autoReadResponses === true, playbackRate: typeof playback.playbackRate === "number" && Number.isFinite(playback.playbackRate) ? Math.min(2, Math.max(.5, playback.playbackRate)) : 1, remoteSttConsent: playback.remoteSttConsent === true, remoteTtsConsent: playback.remoteTtsConsent === true, synthesisMode: playback.synthesisMode === "provider" ? "provider" : "system", voiceName: txt(playback.voiceName) },
  };
}
