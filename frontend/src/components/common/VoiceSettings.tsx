import React, { useState, useEffect } from "react";
import { Settings, Mic, Volume2 } from "lucide-react";
import {
    useVoiceSettingsStore,
    VoiceSettings as VoiceSettingsType,
} from "../../store/voiceSettings";

interface VoiceSettingsProps {
    className?: string;
}

const VoiceSettings: React.FC<VoiceSettingsProps> = ({ className = "" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [availableVoices, setAvailableVoices] = useState<
        SpeechSynthesisVoice[]
    >([]);
    const { settings, updateSetting } = useVoiceSettingsStore();

    const languages = [
        { code: "zh-CN", name: "中文 (简体)" },
        { code: "zh-TW", name: "中文 (繁体)" },
        { code: "en-US", name: "English (US)" },
        { code: "en-GB", name: "English (UK)" },
        { code: "ja-JP", name: "日本語" },
        { code: "ko-KR", name: "한국어" },
        { code: "fr-FR", name: "Français" },
        { code: "de-DE", name: "Deutsch" },
        { code: "es-ES", name: "Español" },
        { code: "it-IT", name: "Italiano" },
    ];

    useEffect(() => {
        // 获取可用的语音列表
        const loadVoices = () => {
            if ("speechSynthesis" in window) {
                const voices = window.speechSynthesis.getVoices();
                setAvailableVoices(voices);

                // 设置默认语音
                if (voices.length > 0 && !settings.outputVoice) {
                    const defaultVoice =
                        voices.find((v) =>
                            v.lang.startsWith(settings.outputLanguage)
                        ) || voices[0];
                    updateSetting("outputVoice", defaultVoice?.name || "");
                }
            }
        };

        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
        loadVoices();
    }, []);

    const handleSettingChange = (key: keyof VoiceSettingsType, value: any) => {
        updateSetting(key, value);
    };

    const getVoicesForLanguage = (language: string) => {
        return availableVoices.filter((voice) =>
            voice.lang.startsWith(language)
        );
    };

    return (
        <div className={`relative ${className}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
                title="语音设置"
            >
                <Settings className="h-5 w-5" />
            </button>

            {isOpen && (
                <div className="absolute bottom-full mb-2 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4 shadow-lg min-w-80 z-50">
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                            语音设置
                        </h3>

                        {/* 语音输入设置 */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <Mic className="h-4 w-4" />
                                语音输入语言
                            </div>
                            <select
                                value={settings.inputLanguage}
                                onChange={(e) =>
                                    handleSettingChange(
                                        "inputLanguage",
                                        e.target.value
                                    )
                                }
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            >
                                {languages.map((lang) => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 语音输出设置 */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <Volume2 className="h-4 w-4" />
                                语音输出语言
                            </div>
                            <select
                                value={settings.outputLanguage}
                                onChange={(e) => {
                                    const newLang = e.target.value;
                                    handleSettingChange(
                                        "outputLanguage",
                                        newLang
                                    );

                                    // 自动选择对应语言的语音
                                    const voicesForLang =
                                        getVoicesForLanguage(newLang);
                                    if (voicesForLang.length > 0) {
                                        handleSettingChange(
                                            "outputVoice",
                                            voicesForLang[0].name
                                        );
                                    }
                                }}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            >
                                {languages.map((lang) => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 语音选择 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                语音选择
                            </label>
                            <select
                                value={settings.outputVoice}
                                onChange={(e) =>
                                    handleSettingChange(
                                        "outputVoice",
                                        e.target.value
                                    )
                                }
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            >
                                {getVoicesForLanguage(
                                    settings.outputLanguage
                                ).map((voice) => (
                                    <option key={voice.name} value={voice.name}>
                                        {voice.name} ({voice.lang})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 语速设置 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                语速: {settings.outputRate}x
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.1"
                                value={settings.outputRate}
                                onChange={(e) =>
                                    handleSettingChange(
                                        "outputRate",
                                        parseFloat(e.target.value)
                                    )
                                }
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                            />
                        </div>

                        {/* 音调设置 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                音调: {settings.outputPitch}
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.1"
                                value={settings.outputPitch}
                                onChange={(e) =>
                                    handleSettingChange(
                                        "outputPitch",
                                        parseFloat(e.target.value)
                                    )
                                }
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                            />
                        </div>

                        {/* 自动播放设置 */}
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                自动播放回复
                            </label>
                            <input
                                type="checkbox"
                                checked={settings.autoPlay}
                                onChange={(e) =>
                                    handleSettingChange(
                                        "autoPlay",
                                        e.target.checked
                                    )
                                }
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VoiceSettings;
