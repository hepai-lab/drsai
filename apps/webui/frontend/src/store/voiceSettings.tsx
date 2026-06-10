import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface VoiceSettings {
    inputLanguage: string;
    outputLanguage: string;
    outputVoice: string;
    outputRate: number;
    outputPitch: number;
    autoPlay: boolean;
}

interface VoiceSettingsStore {
    settings: VoiceSettings;
    setSettings: (settings: VoiceSettings) => void;
    updateSetting: <K extends keyof VoiceSettings>(
        key: K,
        value: VoiceSettings[K]
    ) => void;
    resetSettings: () => void;
}

const defaultSettings: VoiceSettings = {
    inputLanguage: "zh-CN",
    outputLanguage: "zh-CN",
    outputVoice: "",
    outputRate: 1,
    outputPitch: 1,
    autoPlay: false,
};

export const useVoiceSettingsStore = create<VoiceSettingsStore>()(
    persist(
        (set, get) => ({
            settings: defaultSettings,
            setSettings: (settings) => set({ settings }),
            updateSetting: (key, value) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        [key]: value,
                    },
                })),
            resetSettings: () => set({ settings: defaultSettings }),
        }),
        {
            name: "voice-settings",
            version: 1,
        }
    )
);
