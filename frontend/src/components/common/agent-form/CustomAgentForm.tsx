import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { appContext } from "../../../hooks/provider";
import ToolConfigurationForm, { ToolConfig } from "./ToolConfigurationForm";
import KnowledgeConfigurationForm, {
    KnowledgeConfig,
} from "./KnowledgeConfigurationForm";

// 后端需要的最终数据结构
export interface CustomAgentData {
    name: string;
    avatar?: string;
    description?: string;
    system_message?: string;
    model_client: {
        model: string;
        base_url: string;
        api_key: string;
    };
    tools: ToolConfig[];
    knowledge: KnowledgeConfig;
}

// 前端表单内部使用的数据结构
interface CustomAgentFormState {
    name: string;
    avatar: string;
    description: string;
    system_message: string;
    // 模型来源：hepAI / custom
    model_cource: string;
    // Provider / 模型名
    llmProvider: string;
    // 自定义模型时使用
    baseUrl: string;
    apiKey: string;
    // 工具配置（对应后端的 tools）
    toolConfigs: ToolConfig[];
    // 知识配置（直接映射到后端的 knowledge）
    knowledge: KnowledgeConfig;
}

interface CustomAgentFormProps {
    onSubmit: (data: CustomAgentData) => void;
    onCancel: () => void;
    initialData?: Partial<CustomAgentData>;
    models: { id: string }[]; // 可选的模型列表
}

const CustomAgentForm: React.FC<CustomAgentFormProps> = ({
    onSubmit,
    onCancel,
    initialData,
    models,
}) => {
    const { darkMode } = React.useContext(appContext);

    const [formData, setFormData] = useState<CustomAgentFormState>({
        name: initialData?.name || "",
        avatar: initialData?.avatar || "",
        description: initialData?.description || "",
        system_message: initialData?.system_message || "",
        // 如果 initialData 里有 model_client，认为是自定义模型
        model_cource: initialData?.model_client ? "custom" : "hepAI",
        llmProvider: initialData?.model_client?.model || "",
        baseUrl: initialData?.model_client?.base_url || "",
        apiKey: initialData?.model_client?.api_key || "",
        toolConfigs:
            initialData?.tools && initialData.tools.length > 0
                ? initialData.tools
                : [
                    {
                        id: "1",
                        type: "MCP",
                        url: "",
                        token: "",
                    },
                ],
        knowledge:
            initialData?.knowledge || {
                apiKey: "",
                dataSetName: [],
            },
    });
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB

    // 为每个下拉框添加独立的状态
    const [llmModelOpen, setLlmModelOpen] = useState(false); // model_cource 下拉开关
    const [llmProviderOpen, setLlmProviderOpen] = useState(false); // Provider 下拉开关
    const [toolsOpen, setToolsOpen] = useState<{ [key: string]: boolean }>({});
    const [llmModelOptions, setLlmModelOptions] = useState<
        { value: string; label: string }[]
    >([]);

    useEffect(() => {
        if (models) {
            setLlmModelOptions(
                models.map((model) => ({ value: model.id, label: model.id }))
            );
        }
    }, [models]);

    // Provider 下拉框选项：优先使用远端加载的 models；如果暂时还没加载到数据，
    // 也保证至少有一个“占位”选项，这样 UI 始终是下拉框而不是退回到输入框。
    const providerOptions = React.useMemo(
        () =>
            llmModelOptions.length > 0
                ? llmModelOptions
                : formData.llmProvider
                    ? [
                        {
                            value: formData.llmProvider,
                            label: formData.llmProvider,
                        },
                    ]
                    : [
                        {
                            value: "",
                            label: "自定义 Provider",
                        },
                    ],
        [llmModelOptions, formData.llmProvider]
    );

    const handleInputChange = (field: keyof CustomAgentFormState, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleToolConfigChange = (
        id: string,
        field: keyof ToolConfig,
        value: string
    ) => {
        setFormData((prev) => ({
            ...prev,
            toolConfigs: prev.toolConfigs.map((config) =>
                config.id === id ? { ...config, [field]: value } : config
            ),
        }));
    };

    const addToolConfig = () => {
        const newId = (formData.toolConfigs.length + 1).toString();
        setFormData((prev) => ({
            ...prev,
            toolConfigs: [
                ...prev.toolConfigs,
                // 新增的配置同样默认是 MCP
                { id: newId, type: "MCP", url: "", token: "" },
            ],
        }));
    };

    const removeToolConfig = (id: string) => {
        if (formData.toolConfigs.length > 1) {
            setFormData((prev) => ({
                ...prev,
                toolConfigs: prev.toolConfigs.filter(
                    (config) => config.id !== id
                ),
            }));
        }
    };

    const handleKnowledgeConfigChange = (
        field: keyof KnowledgeConfig,
        value: string | string[]
    ) => {
        setFormData((prev) => ({
            ...prev,
            knowledge: { ...prev.knowledge, [field]: value } as KnowledgeConfig,
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // 临时测试数据：表单为空时使用默认值，方便快速联调，测试完可以删掉这段逻辑
        const payload: CustomAgentData = {
            name: formData.name || "Test Agent",
            avatar: formData.avatar || undefined,
            description:
                formData.description || "用于测试后端接口的自定义 Agent",
            system_message:
                formData.system_message || "你是一个用于测试的智能体。",
            model_client: {
                model: formData.llmProvider || "gpt-4o-mini",
                base_url:
                    formData.baseUrl || "https://api.openai.com/v1",
                api_key: formData.apiKey || "sk-test-xxxx",
            },
            tools:
                formData.toolConfigs && formData.toolConfigs.length > 0
                    ? formData.toolConfigs
                    : [
                        {
                            id: "1",
                            type: "MCP",
                            url: "https://example.com/mcp-endpoint",
                            token: "test-mcp-token",
                        },
                    ],
            knowledge:
                formData.knowledge.apiKey ||
                    (formData.knowledge.dataSetName &&
                        formData.knowledge.dataSetName.length > 0)
                    ? formData.knowledge
                    : {
                        apiKey: "test-knowledge-api-key",
                        dataSetName: ["sample-dataset-1"],
                    },
        };

        console.log("agent payload :::", payload);
        onSubmit(payload);
    };

    const resetAvatarInput = () => {
        if (avatarInputRef.current) {
            avatarInputRef.current.value = "";
        }
    };

    const triggerAvatarUpload = () => {
        avatarInputRef.current?.click();
    };

    const handleAvatarFileChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            setAvatarError("请上传图片文件");
            resetAvatarInput();
            return;
        }

        if (file.size > MAX_AVATAR_SIZE) {
            setAvatarError("头像大小需小于 1MB");
            resetAvatarInput();
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            handleInputChange("avatar", reader.result as string);
            setAvatarError(null);
            resetAvatarInput();
        };
        reader.onerror = () => {
            setAvatarError("上传头像失败，请重试");
            resetAvatarInput();
        };
        reader.readAsDataURL(file);
    };

    const handleAvatarRemove = () => {
        handleInputChange("avatar", "");
        setAvatarError(null);
        resetAvatarInput();
    };

    const renderSelect = (
        value: string,
        options: { value: string; label: string }[],
        onChange: (value: string) => void,
        placeholder: string,
        isOpen: boolean,
        setIsOpen: (open: boolean) => void
    ) => {
        const selectedOption = options.find((opt) => opt.value === value);

        if (!options || options.length === 0) {
            return (
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`
                        w-full px-3 py-2 rounded-md border
                        ${darkMode === "dark"
                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                        }
                        focus:outline-none focus:border-[#4d3dc3]
                    `}
                />
            );
        }

        return (
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className={`
                        w-full flex items-center justify-between px-3 py-2 rounded-md
                        border transition-all duration-200
                        ${darkMode === "dark"
                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] hover:border-[#e5e5e560]"
                            : "bg-white text-[#4a5568] border-[#e2e8f0] hover:border-[#4d3dc3]"
                        }
                    `}
                >
                    <span className={selectedOption ? "" : "text-gray-400"}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                </button>

                {isOpen && (
                    <div
                        className={`
                        absolute top-full left-0 right-0 mt-1 z-50 rounded-md shadow-lg border
                        ${darkMode === "dark"
                                ? "bg-[#3a3a3a] border-[#e5e5e530]"
                                : "bg-white border-[#e2e8f0]"
                            }
                    `}
                    >
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                                className={`
                                    w-full text-left px-3 py-2 text-sm transition-colors
                                    ${darkMode === "dark"
                                        ? "text-[#e5e5e5] hover:bg-[#444444]"
                                        : "text-[#4a5568] hover:bg-[#f9fafb]"
                                    }
                                    ${value === option.value
                                        ? darkMode === "dark"
                                            ? "bg-[#4d3dc3] text-white"
                                            : "bg-[#e7e5f2] text-[#4d3dc3]"
                                        : ""
                                    }
                                `}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            className={`
            p-6 rounded-2xl border my-4 max-w-[960px] mx-auto
            ${darkMode === "dark"
                    ? "bg-[#1a1a1a] border-[#2f2f2f]"
                    : "bg-[#f9fafb] border-[#e5e7eb]"
                }
        `}
        >
            <h2
                className={`
                text-lg font-semibold mb-4 text-left tracking-tight
                ${darkMode === "dark" ? "text-[#f9fafb]" : "text-[#111827]"}
            `}
            >
                Custom Your Agent
            </h2>

            <form
                onSubmit={handleSubmit}
                className="space-y-5 h-[420px] overflow-auto pr-1"
            >
                {/* Basic Info */}
                <div
                    className={`
                    rounded-2xl border flex flex-col gap-4 p-5
                    ${darkMode === "dark"
                            ? "border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                            : "border-[#e5e7eb] bg-white shadow-sm"
                        }
                `}
                >
                    <header className="flex items-center justify-between">
                        <div>
                            <p
                                className={`text-sm font-semibold tracking-tight ${darkMode === "dark"
                                    ? "text-white"
                                    : "text-[#111827]"
                                    }`}
                            >
                                Basic Info
                            </p>
                        </div>
                    </header>

                    <div className="flex items-center gap-6 flex-wrap">
                        <div className="flex flex-col items-center gap-2">
                            <button
                                type="button"
                                onClick={triggerAvatarUpload}
                                className={`
                                    w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors relative overflow-hidden
                                    ${darkMode === "dark"
                                        ? "border-[#4d3dc3]/40 bg-[#333333] hover:border-[#4d3dc3]"
                                        : "border-[#d6d3f8] bg-[#f5f4ff] hover:border-[#4d3dc3]"
                                    }
                                `}
                            >
                                {formData.avatar ? (
                                    <img
                                        src={formData.avatar}
                                        alt="Agent avatar preview"
                                        className="w-full h-full object-cover rounded-full"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center text-xs text-[#4d3dc3]">
                                        <Plus className="w-4 h-4" />
                                        上传
                                    </div>
                                )}
                            </button>
                            <input
                                ref={avatarInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAvatarFileChange}
                            />
                        </div>

                        <div className="flex-1 min-w-[260px]">
                            <label
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                Name
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) =>
                                    handleInputChange("name", e.target.value)
                                }
                                placeholder="Set name"
                                className={`
                                    mt-1 w-full max-w-xl px-3 py-1.5 rounded-md border text-sm
                                    ${darkMode === "dark"
                                        ? "bg-[#1f2933] text-[#e5e5e5] border-[#3b4252] placeholder:text-gray-500"
                                        : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                `}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 w-full">
                        <div className="flex flex-col gap-1 max-w-xl">
                            <label
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                Description
                            </label>
                            <input
                                type="text"
                                value={formData.description}
                                onChange={(e) =>
                                    handleInputChange("description", e.target.value)
                                }
                                placeholder="一句话描述 Agent 的风格或用途"
                                className={`
                                    w-full px-3 py-1.5 rounded-md border text-sm
                                    ${darkMode === "dark"
                                        ? "bg-[#111827] text-[#e5e5e5] border-[#272b35] placeholder:text-gray-500"
                                        : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                `}
                            />
                        </div>
                        <div className="flex flex-col gap-1 max-w-xl">
                            <label
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                System Message
                            </label>
                            <input
                                type="text"
                                value={formData.system_message}
                                onChange={(e) =>
                                    handleInputChange("system_message", e.target.value)
                                }
                                placeholder="可选提示：例如始终以投研顾问回答"
                                className={`
                                    w-full px-3 py-1.5 rounded-md border text-sm
                                    ${darkMode === "dark"
                                        ? "bg-[#111827] text-[#e5e5e5] border-[#272b35] placeholder:text-gray-500"
                                        : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                `}
                            />
                        </div>
                    </div>
                </div>

                {/* Model Client */}
                <div
                    className={`
                    rounded-2xl border flex flex-col gap-4 p-5
                    ${darkMode === "dark"
                            ? "border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                            : "border-[#e5e7eb] bg-white shadow-sm"
                        }
                `}
                >
                    <header className="flex items-center justify-between">
                        <div>
                            <p
                                className={`text-sm font-semibold tracking-tight ${darkMode === "dark"
                                    ? "text-white"
                                    : "text-[#111827]"
                                    }`}
                            >
                                Model Client
                            </p>
                            <p
                                className={`text-xs ${darkMode === "dark"
                                    ? "text-gray-500"
                                    : "text-gray-500"
                                    }`}
                            >
                                由 Provider + Base URL + API Key 共同决定 Agent 的推理大脑。
                            </p>

                        </div>
                    </header>

                    <div className="flex flex-col gap-3">
                        {/* model_cource 下拉框 */}
                        <div className="flex flex-col gap-1">
                            <span
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                model_cource
                            </span>
                            {renderSelect(
                                formData.model_cource || "hepAI",
                                [
                                    { value: "hepAI", label: "hepAI" },
                                    { value: "custom", label: "自定义模型" },
                                ],
                                (value) => handleInputChange("model_cource", value),
                                "选择模型来源",
                                llmModelOpen,
                                setLlmModelOpen
                            )}
                        </div>

                        {/* Provider 始终显示 */}
                        <div className="flex flex-col gap-1">
                            <span
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                Provider
                            </span>
                            {formData.model_cource === "hepAI"
                                ? renderSelect(
                                    formData.llmProvider || "",
                                    providerOptions,
                                    (value) => handleInputChange("llmProvider", value),
                                    "选择 Provider",
                                    llmProviderOpen,
                                    setLlmProviderOpen
                                )
                                : (
                                    <input
                                        type="text"
                                        value={formData.llmProvider}
                                        onChange={(e) =>
                                            handleInputChange("llmProvider", e.target.value)
                                        }
                                        placeholder="OpenAI / Qwen"
                                        className={`
                                                w-full px-3 py-1.5 rounded-md border text-sm
                                                ${darkMode === "dark"
                                                ? "bg-[#111827] text-[#e5e5e5] border-[#272b35] placeholder:text-gray-500"
                                                : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                            }
                                                focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                            `}
                                    />
                                )}
                        </div>

                        {/* 选中“自定义模型”时展示 Base URL 和 API Key */}
                        {formData.model_cource === "custom" && (
                            <>
                                <div className="flex flex-col gap-1">
                                    <span
                                        className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                            ? "text-gray-400"
                                            : "text-gray-500"
                                            }`}
                                    >
                                        Base URL
                                    </span>
                                    <input
                                        type="text"
                                        value={formData.baseUrl}
                                        onChange={(e) =>
                                            handleInputChange("baseUrl", e.target.value)
                                        }
                                        placeholder="https://api.example.com"
                                        className={`
                                                w-full px-3 py-1.5 rounded-md border text-sm
                                                ${darkMode === "dark"
                                                ? "bg-[#111827] text-[#e5e5e5] border-[#272b35] placeholder:text-gray-500"
                                                : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                            }
                                                focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                            `}
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span
                                        className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                            ? "text-gray-400"
                                            : "text-gray-500"
                                            }`}
                                    >
                                        API Key
                                    </span>
                                    <input
                                        type="password"
                                        value={formData.apiKey}
                                        onChange={(e) =>
                                            handleInputChange("apiKey", e.target.value)
                                        }
                                        placeholder="sk-***"
                                        className={`
                                                w-full px-3 py-1.5 rounded-md border text-sm
                                                ${darkMode === "dark"
                                                ? "bg-[#111827] text-[#e5e5e5] border-[#272b35] placeholder:text-gray-500"
                                                : "bg-white text-[#111827] border-[#e5e7eb] placeholder:text-gray-400"
                                            }
                                                focus:outline-none focus:border-[#4d3dc3] focus:ring-1 focus:ring-[#4d3dc3]
                                            `}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                </div>

                {/* Tools */}
                <div
                    className={
                        darkMode === "dark"
                            ? "rounded-2xl border flex flex-col gap-4 p-5 border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                            : "rounded-2xl border flex flex-col gap-4 p-5 border-[#e5e7eb] bg-white shadow-sm"
                    }
                >
                    <header className="flex items-center justify-between">
                        <div>
                            <p
                                className={`text-sm font-semibold tracking-tight ${darkMode === "dark"
                                    ? "text-white"
                                    : "text-[#111827]"
                                    }`}
                            >
                                Tools
                            </p>
                            <p
                                className={`text-xs ${darkMode === "dark"
                                    ? "text-gray-500"
                                    : "text-gray-500"
                                    }`}
                            >
                                为 Agent 挂载一个或多个工具链
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={addToolConfig}
                            className={`
                                inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium
                                ${darkMode === "dark"
                                    ? "bg-[#4d3dc3] text-white hover:bg-[#3d2db3]"
                                    : "bg-[#4d3dc3] text-white hover:bg-[#3d2db3]"
                                }
                                transition-colors
                            `}
                        >
                            <Plus className="w-3 h-3" />
                            添加工具
                        </button>
                    </header>

                    <div className="space-y-3">
                        {formData.toolConfigs.map((config, index) => (
                            <div
                                key={config.id}
                                className={`
                                    rounded-xl border px-3 py-3
                                    ${darkMode === "dark"
                                        ? "border-[#2f2f2f] bg-[#101010]"
                                        : "border-[#e5e7eb] bg-[#f9fafb]"
                                    }
                                `}
                            >
                                <ToolConfigurationForm
                                    config={config}
                                    index={index}
                                    onConfigChange={handleToolConfigChange}
                                    onRemove={removeToolConfig}
                                    canRemove={formData.toolConfigs.length > 1}
                                    toolsOpen={toolsOpen[config.id] || false}
                                    onToolsOpenChange={(open) =>
                                        setToolsOpen((prev) => ({
                                            ...prev,
                                            [config.id]: open,
                                        }))
                                    }
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Knowledge */}
                <div
                    className={`
                    rounded-2xl border flex flex-col gap-4 p-5 mb-2
                    ${darkMode === "dark"
                            ? "border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                            : "border-[#e5e7eb] bg-white shadow-sm"
                        }
                `}
                >
                    <header className="flex items-center justify-between">
                        <div>
                            <p
                                className={`text-sm font-semibold tracking-tight ${darkMode === "dark"
                                    ? "text-white"
                                    : "text-[#111827]"
                                    }`}
                            >
                                Knowledge
                            </p>
                            <p
                                className={`text-xs ${darkMode === "dark"
                                    ? "text-gray-500"
                                    : "text-gray-500"
                                    }`}
                            >
                                连接到一个知识源，增强 RAG 能力
                            </p>
                        </div>
                    </header>

                    <KnowledgeConfigurationForm
                        config={formData.knowledge}
                        onConfigChange={handleKnowledgeConfigChange}
                        darkMode={darkMode}
                    />
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`
                            px-4 py-2 rounded-md text-sm font-medium border
                            ${darkMode === "dark"
                                ? "border-[#4b5563] text-[#e5e5e5] hover:bg-[#111827]"
                                : "border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50"
                            }
                            transition-colors
                        `}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className={`
                            px-5 py-2 rounded-md text-sm font-medium
                            bg-[#4d3dc3] text-white hover:bg-[#3d2db3]
                            shadow-sm hover:shadow-md transition-all
                        `}
                    >
                        Save
                    </button>
                </div>
            </form >
        </div >
    );
};

export default CustomAgentForm;
