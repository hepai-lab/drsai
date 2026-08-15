import { useCallback, useEffect, useState } from "react";
import type { DesktopVoiceInteractionMode } from "@shared/desktopApi";

export const VOICE_PREFERENCES_STORAGE_KEY = "opendrsai.voicePreferences.v1";
export const LEGACY_STREAMING_VOICE_MIGRATION_KEY = "opendrsai.voicePreferences.streamingMigrated.v1";
export const VOICE_PREFERENCES_SCHEMA_VERSION = 9;
const VOICE_PREFERENCES_CHANGED_EVENT = "opendrsai:voice-preferences-changed";

export interface VoicePreferences {
  autoReadResponses: boolean;
  confirmBeforeSend: boolean;
  inputDeviceId: string;
  inputLanguage: "auto" | "zh-CN" | "en-US";
  interactionMode: DesktopVoiceInteractionMode;
  playbackRate: number;
  realtimeOutputDeviceId: string;
  realtimeVolume: number;
  realtimeDisclosureFingerprint: string;
  realtimeAutoRecovery: boolean;
  realtimeInputDeviceId: string;
  realtimeLanguage: "auto" | "zh-CN" | "en-US";
  realtimeTranscriptPolicy: "stable" | "none";
  realtimeVoiceName: string;
  remoteSttConsent: boolean;
  remoteTtsConsent: boolean;
  synthesisMode: "system" | "provider";
  voiceName: string;
}

export const defaultVoicePreferences: VoicePreferences = {
  autoReadResponses: false,
  confirmBeforeSend: true,
  inputDeviceId: "",
  inputLanguage: "auto",
  interactionMode: "serial",
  playbackRate: 1,
  realtimeOutputDeviceId: "",
  realtimeVolume: 1,
  realtimeDisclosureFingerprint: "",
  realtimeAutoRecovery: true,
  realtimeInputDeviceId: "",
  realtimeLanguage: "auto",
  realtimeTranscriptPolicy: "stable",
  realtimeVoiceName: "",
  remoteSttConsent: false,
  remoteTtsConsent: false,
  synthesisMode: "system",
  voiceName: "",
};

export function resolveVoiceSynthesisMode(
  mode: VoicePreferences["synthesisMode"],
  remoteTtsConsent: boolean,
): VoicePreferences["synthesisMode"] {
  return mode === "provider" && remoteTtsConsent ? "provider" : "system";
}

export function resolveAvailableVoiceName(preferredName: string, availableNames: readonly string[]): string {
  return preferredName && availableNames.includes(preferredName) ? preferredName : "";
}

export function loadVoicePreferences(): VoicePreferences {
  if (typeof window === "undefined") return defaultVoicePreferences;
  try {
    const raw = window.localStorage.getItem(VOICE_PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultVoicePreferences;
    const parsed = JSON.parse(raw) as unknown;
    const value = parseStoredVoicePreferences(parsed);
    if (!value) return defaultVoicePreferences;
    const inputLanguage = value.inputLanguage === "zh-CN" || value.inputLanguage === "en-US"
      ? value.inputLanguage
      : "auto";
    const playbackRate = typeof value.playbackRate === "number" && Number.isFinite(value.playbackRate)
      ? Math.min(2, Math.max(0.5, value.playbackRate))
      : 1;
    const realtimeVolume = typeof value.realtimeVolume === "number" && Number.isFinite(value.realtimeVolume) ? Math.min(1, Math.max(0, value.realtimeVolume)) : 1;
    const migratedInteractionMode = value.interactionMode === "duplex" ? "duplex" : "serial";
    const resolved: VoicePreferences = {
      autoReadResponses: value.autoReadResponses === true,
      confirmBeforeSend: typeof value.confirmBeforeSend === "boolean"
        ? value.confirmBeforeSend
        : defaultVoicePreferences.confirmBeforeSend,
      inputDeviceId: typeof value.inputDeviceId === "string" ? value.inputDeviceId : "",
      inputLanguage,
      interactionMode: migratedInteractionMode,
      playbackRate,
      realtimeOutputDeviceId: typeof value.realtimeOutputDeviceId === "string" ? value.realtimeOutputDeviceId : "",
      realtimeVolume,
      realtimeDisclosureFingerprint: typeof value.realtimeDisclosureFingerprint === "string" ? value.realtimeDisclosureFingerprint.slice(0, 500) : "",
      realtimeAutoRecovery: value.realtimeAutoRecovery !== false,
      realtimeInputDeviceId: typeof value.realtimeInputDeviceId === "string" ? value.realtimeInputDeviceId : "",
      realtimeLanguage: value.realtimeLanguage === "zh-CN" || value.realtimeLanguage === "en-US" ? value.realtimeLanguage : "auto",
      realtimeTranscriptPolicy: value.realtimeTranscriptPolicy === "none" ? "none" : "stable",
      realtimeVoiceName: typeof value.realtimeVoiceName === "string" ? value.realtimeVoiceName.slice(0, 80) : "",
      remoteSttConsent: value.remoteSttConsent === true,
      remoteTtsConsent: value.remoteTtsConsent === true,
      synthesisMode: value.synthesisMode === "provider" ? "provider" : "system",
      voiceName: typeof value.voiceName === "string" ? value.voiceName : "",
    };
    if (value.interactionMode === "streaming") {
      window.localStorage.setItem(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: VOICE_PREFERENCES_SCHEMA_VERSION, preferences: resolved }));
      window.localStorage.setItem(LEGACY_STREAMING_VOICE_MIGRATION_KEY, new Date().toISOString());
    }
    return resolved;
  } catch {
    return defaultVoicePreferences;
  }
}

function parseStoredVoicePreferences(value: unknown): Partial<VoicePreferences> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if ("version" in stored) {
    const version = Number(stored.version);
    if (![VOICE_PREFERENCES_SCHEMA_VERSION, 8, 7, 6, 5, 4, 3, 2, 1].includes(version)) return null;
    if (!stored.preferences || typeof stored.preferences !== "object" || Array.isArray(stored.preferences)) return null;
    const preferences = stored.preferences as Partial<VoicePreferences>;
    return version < VOICE_PREFERENCES_SCHEMA_VERSION
      ? { ...preferences, confirmBeforeSend: true }
      : preferences;
  }
  return stored as Partial<VoicePreferences>;
}

export function useVoicePreferences(): [
  VoicePreferences,
  (updates: Partial<VoicePreferences>) => void,
] {
  const [preferences, setPreferences] = useState(loadVoicePreferences);

  const updatePreferences = useCallback((updates: Partial<VoicePreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...updates, interactionMode: updates.interactionMode === "streaming" ? "serial" : (updates.interactionMode ?? current.interactionMode) };
      window.localStorage.setItem(VOICE_PREFERENCES_STORAGE_KEY, JSON.stringify({
        version: VOICE_PREFERENCES_SCHEMA_VERSION,
        preferences: next,
      }));
      window.dispatchEvent(new CustomEvent<VoicePreferences>(VOICE_PREFERENCES_CHANGED_EVENT, { detail: next }));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleChange = (event: Event): void => {
      const detail = (event as CustomEvent<VoicePreferences>).detail;
      setPreferences(detail ?? loadVoicePreferences());
    };
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === VOICE_PREFERENCES_STORAGE_KEY) setPreferences(loadVoicePreferences());
    };
    window.addEventListener(VOICE_PREFERENCES_CHANGED_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(VOICE_PREFERENCES_CHANGED_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return [preferences, updatePreferences];
}
