import React, { useContext, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { RefreshCw, Sparkles, X } from "lucide-react";
import CustomAgentForm, { CustomAgentData } from "../../common/agent-form/CustomAgentForm";
import { appContext } from "../../../hooks/provider";

interface CustomAgentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: CustomAgentData) => void | Promise<void>;
    models: { id: string }[];
    isLoadingModels?: boolean;
    onReloadModels?: () => void;
    isSaving?: boolean;
}

const CustomAgentModal: React.FC<CustomAgentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    models,
    isLoadingModels = false,
    onReloadModels,
    isSaving = false,
}) => {
    const { darkMode } = useContext(appContext);
    const [modalRoot, setModalRoot] = useState<HTMLElement | null>(null);
    const [formInstanceKey, setFormInstanceKey] = useState(0);

    useEffect(() => {
        if (isOpen) {
            const root = document.getElementById("___gatsby") || document.body;
            setModalRoot(root);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setFormInstanceKey((prev) => prev + 1);
        }
    }, [isOpen]);

    if (!isOpen || !modalRoot) return null;

    const renderHeaderAction = () => {
        if (!onReloadModels) return null;

        return (
            <button
                type="button"
                onClick={onReloadModels}
                disabled={isLoadingModels}
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${darkMode === "dark"
                    ? "border-gray-700 text-gray-200 hover:bg-gray-800 disabled:text-gray-500"
                    : "border-gray-200 text-gray-600 hover:bg-gray-100 disabled:text-gray-400"
                    }`}
            >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingModels ? "animate-spin" : ""}`} />
                {isLoadingModels ? "刷新中" : "刷新模型"}
            </button>
        );
    };

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            style={{ zIndex: 1000 }}
        >
            <div
                className={`relative rounded-2xl shadow-xl border w-[800px] max-w-[95vw] max-h-[92vh] overflow-hidden flex flex-col ${darkMode === "dark"
                    ? "bg-[#101010] border-gray-800"
                    : "bg-white border-gray-200"
                    }`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                            <h2 className={`text-lg font-semibold ${darkMode === "dark" ? "text-gray-100" : "text-gray-800"}`}>
                                自定义智能体
                            </h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                配置多模态能力、工具链以及知识库，打造个性化智能体。
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {renderHeaderAction()}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            aria-label="关闭"
                        >
                            <X className="h-4 w-4 text-gray-500 dark:text-gray-300" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto p-5">
                    {!models.length && !isLoadingModels && (
                        <div className="mb-4 text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
                            暂未检测到模型列表，可点击右上角刷新或直接在输入框中填入模型名称。
                        </div>
                    )}

                    {isLoadingModels ? (
                        <div className="flex items-center justify-center h-64 text-sm text-gray-500 dark:text-gray-300">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                正在加载可用模型，请稍候...
                            </div>
                        </div>
                    ) : (
                        <CustomAgentForm
                            key={formInstanceKey}
                            models={models}
                            onSubmit={onSave}
                            onCancel={onClose}
                        />
                    )}
                </div>

                {isSaving && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-2xl">
                        <div className="flex items-center gap-2 text-white text-sm">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            保存中...
                        </div>
                    </div>
                )}
            </div>
        </div>,
        modalRoot
    );
};

export default CustomAgentModal;

