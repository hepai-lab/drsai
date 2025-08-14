import React, { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    onError?: (error: string) => void;
    disabled?: boolean;
    className?: string;
    language?: string;
}

const VoiceInput: React.FC<VoiceInputProps> = ({
    onTranscript,
    onError,
    disabled = false,
    className = "",
    language = "zh-CN",
}) => {
    const [isListening, setIsListening] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const [recognition, setRecognition] = useState<any>(null);
    const [interimTranscript, setInterimTranscript] = useState("");

    useEffect(() => {
        // 检查浏览器是否支持语音识别
        const SpeechRecognition =
            window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            setIsSupported(true);
            const recognitionInstance = new SpeechRecognition();
            recognitionInstance.continuous = true;
            recognitionInstance.interimResults = true;
            recognitionInstance.lang = language;

            recognitionInstance.onstart = () => {
                setIsListening(true);
                setInterimTranscript("");
            };

            recognitionInstance.onresult = (event: any) => {
                let finalTranscript = "";
                let interimTranscript = "";

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                        console.log("Final transcript:", finalTranscript);
                    } else {
                        interimTranscript += transcript;
                    }
                }

                if (finalTranscript) {
                    onTranscript(finalTranscript);
                    setInterimTranscript("");
                } else {
                    setInterimTranscript(interimTranscript);
                }
            };

            recognitionInstance.onerror = (event: any) => {
                setIsListening(false);
                const errorMessage = getErrorMessage(event.error);
                onError?.(errorMessage);
            };

            recognitionInstance.onend = () => {
                setIsListening(false);
                setInterimTranscript("");
            };

            setRecognition(recognitionInstance);
        }
    }, [language, onTranscript, onError]);

    const getErrorMessage = (error: string) => {
        switch (error) {
            case "no-speech":
                return "没有检测到语音，请重试";
            case "audio-capture":
                return "无法访问麦克风，请检查权限设置";
            case "not-allowed":
                return "麦克风权限被拒绝，请在浏览器设置中允许麦克风访问";
            case "network":
                return "网络错误，请检查网络连接";
            default:
                return `语音识别错误: ${error}`;
        }
    };

    const toggleListening = () => {
        if (!isSupported || disabled) return;

        if (isListening) {
            recognition?.stop();
        } else {
            try {
                recognition?.start();
            } catch (error) {
                onError?.("启动语音识别失败");
            }
        }
    };

    if (!isSupported) {
        return (
            <button
                disabled
                className={`p-2 rounded bg-gray-300 text-gray-500 cursor-not-allowed ${className}`}
                title="浏览器不支持语音识别"
            >
                <Mic className="h-5 w-5" />
            </button>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={toggleListening}
                disabled={disabled}
                className={`p-2 rounded-full transition-all duration-200 ${isListening
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "hover:bg-gray-600 text-white"
                    } ${disabled
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer"
                    } ${className}`}
                title={isListening ? "停止语音输入" : "开始语音输入"}
            >
                {isListening ? (
                    <MicOff className="h-5 w-5 animate-pulse" />
                ) : (
                    <Mic className="h-5 w-5" />
                )}
            </button>

            {interimTranscript && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-2 text-sm text-gray-600 dark:text-gray-300 max-w-xs">
                    {interimTranscript}
                </div>
            )}
        </div>
    );
};

export default VoiceInput;
