import { useCallback, useEffect, useState } from "react";

export const VOICE_PREFERENCES_STORAGE_KEY = "opendrsai.voicePreferences.v1";
export const LEGACY_STREAMING_VOICE_MIGRATION_KEY = "opendrsai.voicePreferences.streamingMigrated.v1";
export const VOICE_PREFERENCES_SCHEMA_VERSION = 11;
const VOICE_PREFERENCES_CHANGED_EVENT = "opendrsai:voice-preferences-changed";

export type VoiceInteractionMode = "serial" | "duplex";
export type VoiceLanguage = "auto" | "zh-CN" | "en-US";

/** Canonical persisted P3 voice preference document. */
export interface VoicePreferencesVNext {
  schemaVersion: 11;
  revision: number;
  realtimeOptIn: boolean;
  selectedMode: VoiceInteractionMode;
  serial: {
    inputDeviceId: string;
    language: VoiceLanguage;
    confirmBeforeSend: boolean;
  };
  duplex: {
    inputDeviceId: string;
    outputDeviceId: string;
    language: VoiceLanguage;
    voice: string;
    volume: number;
    autoRecovery: boolean;
    transcriptPolicy: "stable" | "none";
    disclosureFingerprint: string;
  };
  playback: {
    autoReadResponses: boolean;
    playbackRate: number;
    remoteSttConsent: boolean;
    remoteTtsConsent: boolean;
    synthesisMode: "system" | "provider";
    voiceName: string;
  };
}

/** Temporary UI adapter. Persistence always uses VoicePreferencesVNext. */
export interface VoicePreferences {
  revision: number;
  autoReadResponses: boolean; confirmBeforeSend: boolean; inputDeviceId: string; inputLanguage: VoiceLanguage;
  interactionMode: VoiceInteractionMode; playbackRate: number; realtimeOutputDeviceId: string; realtimeVolume: number;
  realtimeDisclosureFingerprint: string; realtimeEnabled: boolean; realtimeAutoRecovery: boolean; realtimeInputDeviceId: string;
  realtimeLanguage: VoiceLanguage; realtimeTranscriptPolicy: "stable" | "none"; realtimeVoiceName: string;
  remoteSttConsent: boolean; remoteTtsConsent: boolean; synthesisMode: "system" | "provider"; voiceName: string;
}

export const defaultVoicePreferencesDocument: VoicePreferencesVNext = {
  schemaVersion: 11, revision: 0, realtimeOptIn: false, selectedMode: "serial",
  serial: { inputDeviceId: "", language: "auto", confirmBeforeSend: true },
  duplex: { inputDeviceId: "", outputDeviceId: "", language: "auto", voice: "", volume: 1, autoRecovery: true, transcriptPolicy: "stable", disclosureFingerprint: "" },
  playback: { autoReadResponses: false, playbackRate: 1, remoteSttConsent: false, remoteTtsConsent: false, synthesisMode: "system", voiceName: "" },
};

function toView(value: VoicePreferencesVNext): VoicePreferences {
  return {
    revision: value.revision, autoReadResponses: value.playback.autoReadResponses,
    confirmBeforeSend: value.serial.confirmBeforeSend, inputDeviceId: value.serial.inputDeviceId, inputLanguage: value.serial.language,
    interactionMode: value.selectedMode, playbackRate: value.playback.playbackRate,
    realtimeOutputDeviceId: value.duplex.outputDeviceId, realtimeVolume: value.duplex.volume,
    realtimeDisclosureFingerprint: value.duplex.disclosureFingerprint, realtimeEnabled: value.realtimeOptIn,
    realtimeAutoRecovery: value.duplex.autoRecovery, realtimeInputDeviceId: value.duplex.inputDeviceId,
    realtimeLanguage: value.duplex.language, realtimeTranscriptPolicy: value.duplex.transcriptPolicy, realtimeVoiceName: value.duplex.voice,
    remoteSttConsent: value.playback.remoteSttConsent, remoteTtsConsent: value.playback.remoteTtsConsent,
    synthesisMode: value.playback.synthesisMode, voiceName: value.playback.voiceName,
  };
}

export const defaultVoicePreferences = toView(defaultVoicePreferencesDocument);

const language = (value: unknown): VoiceLanguage => value === "zh-CN" || value === "en-US" ? value : "auto";
const textValue = (value: unknown, max = Number.MAX_SAFE_INTEGER): string => typeof value === "string" ? value.slice(0, max) : "";
const bounded = (value: unknown, min: number, max: number, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeVoicePreferences(value: unknown): VoicePreferencesVNext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(defaultVoicePreferencesDocument);
  const stored = value as Record<string, any>;
  if (stored.schemaVersion === 11) {
    const serial = stored.serial && typeof stored.serial === "object" ? stored.serial : {};
    const duplex = stored.duplex && typeof stored.duplex === "object" ? stored.duplex : {};
    const playback = stored.playback && typeof stored.playback === "object" ? stored.playback : {};
    const realtimeOptIn = stored.realtimeOptIn === true;
    return {
      schemaVersion: 11, revision: Math.max(0, Number.isSafeInteger(stored.revision) ? stored.revision : 0), realtimeOptIn,
      selectedMode: realtimeOptIn && stored.selectedMode === "duplex" ? "duplex" : "serial",
      serial: { inputDeviceId: textValue(serial.inputDeviceId), language: language(serial.language), confirmBeforeSend: serial.confirmBeforeSend !== false },
      duplex: { inputDeviceId: textValue(duplex.inputDeviceId), outputDeviceId: textValue(duplex.outputDeviceId), language: language(duplex.language), voice: textValue(duplex.voice, 80), volume: bounded(duplex.volume, 0, 1, 1), autoRecovery: duplex.autoRecovery !== false, transcriptPolicy: duplex.transcriptPolicy === "none" ? "none" : "stable", disclosureFingerprint: textValue(duplex.disclosureFingerprint, 500) },
      playback: { autoReadResponses: playback.autoReadResponses === true, playbackRate: bounded(playback.playbackRate, .5, 2, 1), remoteSttConsent: playback.remoteSttConsent === true, remoteTtsConsent: playback.remoteTtsConsent === true, synthesisMode: playback.synthesisMode === "provider" ? "provider" : "system", voiceName: textValue(playback.voiceName) },
    };
  }
  const envelopeVersion = Number(stored.version);
  if ("version" in stored && (!Number.isInteger(envelopeVersion) || envelopeVersion < 1 || envelopeVersion > 10)) return structuredClone(defaultVoicePreferencesDocument);
  const legacy = ("version" in stored ? stored.preferences : stored) as Record<string, any>;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return structuredClone(defaultVoicePreferencesDocument);
  const migratedInteractionMode = legacy.interactionMode === "streaming" ? "serial" : legacy.interactionMode;
  const wasDuplex = migratedInteractionMode === "duplex";
  return {
    schemaVersion: 11, revision: 0, realtimeOptIn: legacy.realtimeEnabled === true || wasDuplex, selectedMode: wasDuplex ? "duplex" : "serial",
    serial: { inputDeviceId: textValue(legacy.inputDeviceId), language: language(legacy.inputLanguage), confirmBeforeSend: envelopeVersion > 0 && envelopeVersion < 10 ? true : legacy.confirmBeforeSend !== false },
    duplex: { inputDeviceId: textValue(legacy.realtimeInputDeviceId), outputDeviceId: textValue(legacy.realtimeOutputDeviceId), language: language(legacy.realtimeLanguage), voice: textValue(legacy.realtimeVoiceName, 80), volume: bounded(legacy.realtimeVolume, 0, 1, 1), autoRecovery: legacy.realtimeAutoRecovery !== false, transcriptPolicy: legacy.realtimeTranscriptPolicy === "none" ? "none" : "stable", disclosureFingerprint: textValue(legacy.realtimeDisclosureFingerprint, 500) },
    playback: { autoReadResponses: legacy.autoReadResponses === true, playbackRate: bounded(legacy.playbackRate, .5, 2, 1), remoteSttConsent: legacy.remoteSttConsent === true, remoteTtsConsent: legacy.remoteTtsConsent === true, synthesisMode: legacy.synthesisMode === "provider" ? "provider" : "system", voiceName: textValue(legacy.voiceName) },
  };
}

function persist(document: VoicePreferencesVNext): void { window.localStorage.setItem(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify(document)); }
export function loadVoicePreferencesDocument(): VoicePreferencesVNext {
  if (typeof window === "undefined") return structuredClone(defaultVoicePreferencesDocument);
  try {
    const raw = window.localStorage.getItem(VOICE_PREFERENCES_STORAGE_KEY);
    if (!raw) return structuredClone(defaultVoicePreferencesDocument);
    const parsed = JSON.parse(raw) as unknown;
    const document = normalizeVoicePreferences(parsed);
    const legacy = !(parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as Record<string, unknown>).schemaVersion === 11);
    if (legacy) {
      persist(document);
      const legacyMode = ((parsed as any)?.preferences ?? parsed)?.interactionMode;
      if (legacyMode === "streaming") window.localStorage.setItem(LEGACY_STREAMING_VOICE_MIGRATION_KEY, new Date().toISOString());
    }
    return document;
  } catch { return structuredClone(defaultVoicePreferencesDocument); }
}
export function loadVoicePreferences(): VoicePreferences { return toView(loadVoicePreferencesDocument()); }

function updateDocument(current: VoicePreferencesVNext, updates: Partial<VoicePreferences>): VoicePreferencesVNext {
  const realtimeOptIn = updates.realtimeEnabled ?? current.realtimeOptIn;
  const requestedMode = updates.interactionMode ?? current.selectedMode;
  return normalizeVoicePreferences({
    ...current, revision: current.revision + 1, realtimeOptIn, selectedMode: realtimeOptIn ? requestedMode : "serial",
    serial: { ...current.serial, inputDeviceId: updates.inputDeviceId ?? current.serial.inputDeviceId, language: updates.inputLanguage ?? current.serial.language, confirmBeforeSend: updates.confirmBeforeSend ?? current.serial.confirmBeforeSend },
    duplex: { ...current.duplex, inputDeviceId: updates.realtimeInputDeviceId ?? current.duplex.inputDeviceId, outputDeviceId: updates.realtimeOutputDeviceId ?? current.duplex.outputDeviceId, language: updates.realtimeLanguage ?? current.duplex.language, voice: updates.realtimeVoiceName ?? current.duplex.voice, volume: updates.realtimeVolume ?? current.duplex.volume, autoRecovery: updates.realtimeAutoRecovery ?? current.duplex.autoRecovery, transcriptPolicy: updates.realtimeTranscriptPolicy ?? current.duplex.transcriptPolicy, disclosureFingerprint: updates.realtimeDisclosureFingerprint ?? current.duplex.disclosureFingerprint },
    playback: { ...current.playback, autoReadResponses: updates.autoReadResponses ?? current.playback.autoReadResponses, playbackRate: updates.playbackRate ?? current.playback.playbackRate, remoteSttConsent: updates.remoteSttConsent ?? current.playback.remoteSttConsent, remoteTtsConsent: updates.remoteTtsConsent ?? current.playback.remoteTtsConsent, synthesisMode: updates.synthesisMode ?? current.playback.synthesisMode, voiceName: updates.voiceName ?? current.playback.voiceName },
  });
}

export function resolveVoiceSynthesisMode(
  mode: VoicePreferences["synthesisMode"],
  consent: boolean,
  remoteAvailable = true,
): VoicePreferences["synthesisMode"] {
  return mode === "provider" && consent && remoteAvailable ? "provider" : "system";
}
export function resolveAvailableVoiceName(preferred: string, available: readonly string[]): string { return preferred && available.includes(preferred) ? preferred : ""; }

export function useVoicePreferences(): [VoicePreferences, (updates: Partial<VoicePreferences>) => void] {
  const [preferences, setPreferences] = useState(loadVoicePreferences);
  const updatePreferences = useCallback((updates: Partial<VoicePreferences>) => {
    setPreferences((currentView) => {
      const current = loadVoicePreferencesDocument();
      const base = current.revision >= currentView.revision ? current : normalizeVoicePreferences(defaultVoicePreferencesDocument);
      const next = updateDocument(base, updates); persist(next);
      const { revision: _revision, ...preferences } = next;
      void window.openDrSai.updateVoicePreferences({ expectedRevision: base.revision, preferences }).catch(async () => {
        const authoritative = normalizeVoicePreferences(await window.openDrSai.getVoicePreferences());
        persist(authoritative);
        setPreferences(toView(authoritative));
      });
      const view = toView(next); window.dispatchEvent(new CustomEvent<VoicePreferences>(VOICE_PREFERENCES_CHANGED_EVENT, { detail: view })); return view;
    });
  }, []);
  useEffect(() => {
    const accept = (candidate: VoicePreferences, allowEqual = false): void => setPreferences((current) => candidate.revision > current.revision || (allowEqual && candidate.revision === current.revision) ? candidate : current);
    const handleChange = (event: Event): void => accept((event as CustomEvent<VoicePreferences>).detail ?? loadVoicePreferences());
    const handleStorage = (event: StorageEvent): void => { if (event.key === VOICE_PREFERENCES_STORAGE_KEY) accept(loadVoicePreferences()); };
    const unsubscribeMain = window.openDrSai.onVoicePreferencesChanged((document) => {
      const normalized = normalizeVoicePreferences(document); persist(normalized); accept(toView(normalized), true);
    });
    void window.openDrSai.getVoicePreferences().then(async (remoteValue) => {
      const remote = normalizeVoicePreferences(remoteValue);
      const local = loadVoicePreferencesDocument();
      if (remote.revision > local.revision || (remote.revision === local.revision && remote.revision > 0)) {
        persist(remote); accept(toView(remote)); return;
      }
      if (local.revision === 0 && JSON.stringify(local) !== JSON.stringify(defaultVoicePreferencesDocument)) {
        const { revision: _revision, ...preferences } = local;
        const saved = normalizeVoicePreferences(await window.openDrSai.updateVoicePreferences({ expectedRevision: remote.revision, preferences }));
        persist(saved); accept(toView(saved));
      }
    }).catch(() => undefined);
    window.addEventListener(VOICE_PREFERENCES_CHANGED_EVENT, handleChange); window.addEventListener("storage", handleStorage);
    return () => { unsubscribeMain(); window.removeEventListener(VOICE_PREFERENCES_CHANGED_EVENT, handleChange); window.removeEventListener("storage", handleStorage); };
  }, []);
  return [preferences, updatePreferences];
}
