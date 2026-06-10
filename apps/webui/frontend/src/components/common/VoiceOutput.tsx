import React, { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX, Pause, Play } from "lucide-react";
import { useLang } from "../../i18n/useLang";

interface VoiceOutputProps {
    text: string;
    onError?: (error: string) => void;
    disabled?: boolean;
    className?: string;
    language?: string;
    voice?: string;
    rate?: number;
    pitch?: number;
    autoPlay?: boolean;
}

const VoiceOutput: React.FC<VoiceOutputProps> = ({
    text,
    onError,
    disabled = false,
    className = "",
    language = "zh-CN",
    voice,
    rate = 1,
    pitch = 1,
    autoPlay = false,
}) => {
    const { t } = useLang();
    const [isSupported, setIsSupported] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [availableVoices, setAvailableVoices] = useState<
        SpeechSynthesisVoice[]
    >([]);
    const [selectedVoice, setSelectedVoice] =
        useState<SpeechSynthesisVoice | null>(null);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    useEffect(() => {
        // 检查浏览器是否支持语音合成
        if ("speechSynthesis" in window) {
            setIsSupported(true);

            // 获取可用的语音列表
            const loadVoices = () => {
                const voices = window.speechSynthesis.getVoices();
                setAvailableVoices(voices);

                // 选择默认语音
                let defaultVoice =
                    voices.find((v) => v.lang.startsWith(language)) ||
                    voices[0];
                if (voice) {
                    const customVoice = voices.find((v) => v.name === voice);
                    if (customVoice) {
                        defaultVoice = customVoice;
                    }
                }
                setSelectedVoice(defaultVoice);
            };

            // 加载语音列表
            if (window.speechSynthesis.onvoiceschanged !== undefined) {
                window.speechSynthesis.onvoiceschanged = loadVoices;
            }
            loadVoices();
        }
    }, [language, voice]);

    useEffect(() => {
        if (text && autoPlay && isSupported && selectedVoice) {
            speakText();
        }
    }, [text, autoPlay, isSupported, selectedVoice]);

    const speakText = () => {
        if (!isSupported || !selectedVoice || !text.trim()) {
            onError?.(t("voiceoutput.unavailable"));
            return;
        }

        // 停止当前播放
        stopSpeaking();

        try {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = selectedVoice;
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.lang = language;

            utterance.onstart = () => {
                setIsPlaying(true);
                setIsPaused(false);
            };

            utterance.onend = () => {
                setIsPlaying(false);
                setIsPaused(false);
            };

            utterance.onerror = (event) => {
                setIsPlaying(false);
                setIsPaused(false);
                const errorMessage = getErrorMessage(event.error);
                onError?.(errorMessage);
            };

            utteranceRef.current = utterance;
            window.speechSynthesis.speak(utterance);
        } catch (error) {
            onError?.(t("voiceoutput.ttsSynthesisFailed"));
        }
    };

    const pauseSpeaking = () => {
        if (isPlaying && !isPaused) {
            window.speechSynthesis.pause();
            setIsPaused(true);
        }
    };

    const resumeSpeaking = () => {
        if (isPaused) {
            window.speechSynthesis.resume();
            setIsPaused(false);
        }
    };

    const stopSpeaking = () => {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
        setIsPaused(false);
        utteranceRef.current = null;
    };

    const toggleSpeaking = () => {
        if (isPlaying) {
            if (isPaused) {
                resumeSpeaking();
            } else {
                pauseSpeaking();
            }
        } else {
            speakText();
        }
    };

    const getErrorMessage = (error: string) => {
        switch (error) {
            case "canceled":
                return t("voiceoutput.cancelled");
            case "interrupted":
                return t("voiceoutput.interrupted");
            case "audio-busy":
                return t("voiceoutput.busy");
            case "audio-hardware":
                return t("voiceoutput.hardwareError");
            case "network":
                return t("voiceoutput.networkError");
            case "synthesis-not-supported":
                return t("voiceoutput.notSupported");
            case "synthesis-failed":
                return t("voiceoutput.synthesisFailed");
            case "language-not-supported":
                return t("voiceoutput.langNotSupported");
            case "voice-not-supported":
                return "Voice not supported";
            case "text-too-long":
                return "Text too long";
            case "invalid-argument":
                return "Invalid argument";
            default:
                return `${t("voiceoutput.synthesisFailed")}: ${error}`;
        }
    };

    if (!isSupported) {
        return (
            <button
                disabled
                className={`p-2 rounded-lg bg-gray-300 text-gray-500 cursor-not-allowed ${className}`}
                title="浏览器不支持语音合成"
            >
                <VolumeX className="h-5 w-5" />
            </button>
        );
    }

    return (
        <div className="flex items-center gap-1">
            <button
                onClick={toggleSpeaking}
                disabled={disabled || !text.trim()}
                className={`p-1 transition-all duration-200 ${isPlaying
                    ? "text-green-600 hover:text-green-700"
                    : "text-secondary hover:text-primary"
                    } ${disabled || !text.trim()
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer"
                    } ${className}`}
                title={
                    !text.trim()
                        ? "没有文本内容"
                        : isPlaying
                            ? isPaused
                                ? "继续播放"
                                : "暂停播放"
                            : "播放语音"
                }
            >
                {isPlaying ? (
                    isPaused ? (
                        <Play className="h-5 w-5" />
                    ) : (
                        <Pause className="h-5 w-5" />
                    )
                ) : (
                    <Volume2 className="h-5 w-5" />
                )}
            </button>

            {isPlaying && (
                <button
                    onClick={stopSpeaking}
                    className="p-1 text-red-600 hover:text-red-700 transition-colors"
                    title="停止播放"
                >
                    <VolumeX className="h-5 w-5" />
                </button>
            )}
        </div>
    );
};

export default VoiceOutput;
