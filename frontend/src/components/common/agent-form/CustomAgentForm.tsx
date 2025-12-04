import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Select, Input } from "antd";
import type { SelectProps } from "antd";
import { appContext } from "../../../hooks/provider";
import ToolConfigurationForm, { ToolConfig } from "./ToolConfigurationForm";
import KnowledgeConfigurationForm, {
    KnowledgeConfig,
} from "./KnowledgeConfigurationForm";

// 后端需要的最终数据结构
export interface CustomAgentData {
    id?: string;
    name: string;
    avatar?: string;
    description?: string;
    system_message?: string;
    model_client: {
        model: string;
        base_url: string;
        api_key: string;
    };
    mcp_sse_list: ToolConfig[];
    // 注意：后端期望 ragflow_configs 是一个列表
    ragflow_configs: KnowledgeConfig[];
}

// 前端表单内部使用的数据结构
interface CustomAgentFormState {
    name: string;
    avatar: string;
    description: string;
    system_message: string;
    // 模型来源：hepAI / custom
    model_source: string;
    // Provider / 模型名
    llmProvider: string;
    // 自定义模型时使用
    baseUrl: string;
    apiKey: string;
    // 工具配置（对应后端的 mcp_sse_list）
    toolConfigs: ToolConfig[];
    // 知识配置（直接映射到后端的 ragflow_configs）
    ragflow_configs: KnowledgeConfig[];
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
        model_source: initialData?.model_client ? "custom" : "HepAI",
        llmProvider: initialData?.model_client?.model || "",
        baseUrl: initialData?.model_client?.base_url || "",
        apiKey: initialData?.model_client?.api_key || "",
        toolConfigs:
            initialData?.mcp_sse_list && initialData.mcp_sse_list.length > 0
                ? initialData.mcp_sse_list
                : [
                    {
                        id: "1",
                        type: "MCP",
                        url: "",
                        token: "",
                    },
                ],
        ragflow_configs:
            initialData?.ragflow_configs && initialData.ragflow_configs.length > 0
                ? initialData.ragflow_configs
                : [
                    {
                        ragflow_url: "",
                        ragflow_token: "",
                        dataset_ids: [],
                    },
                ]
    });
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    const MAX_AVATAR_SIZE = 1024 * 1024; // 1MB

    // 表单验证错误状态
    const [errors, setErrors] = useState<{
        name?: string;
        description?: string;
        llmProvider?: string;
        baseUrl?: string;
        apiKey?: string;
    }>({});

    // 工具配置错误状态
    const [toolErrors, setToolErrors] = useState<{
        [key: string]: { url?: string };
    }>({});

    // 知识配置错误状态
    const [knowledgeErrors, setKnowledgeErrors] = useState<{
        [key: number]: {
            ragflow_url?: string;
            ragflow_token?: string;
            dataset_ids?: string;
        };
    }>({});

    // 存储每个知识配置的 provider 状态
    const [knowledgeProviders, setKnowledgeProviders] = useState<{
        [key: number]: "ihep" | "local";
    }>({});

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
        // 清除对应字段的错误
        if (errors[field as keyof typeof errors]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field as keyof typeof errors];
                return newErrors;
            });
        }
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
        // 清除对应字段的错误
        if (toolErrors[id] && toolErrors[id][field as keyof typeof toolErrors[string]]) {
            setToolErrors((prev) => {
                const newErrors = { ...prev };
                if (newErrors[id]) {
                    delete newErrors[id][field as keyof typeof newErrors[string]];
                    if (Object.keys(newErrors[id]).length === 0) {
                        delete newErrors[id];
                    }
                }
                return newErrors;
            });
        }
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
        index: number,
        field: keyof KnowledgeConfig,
        value: string | string[]
    ) => {
        setFormData((prev) => {
            const baseConfigs =
                prev.ragflow_configs && prev.ragflow_configs.length > 0
                    ? prev.ragflow_configs
                    : [
                        {
                            ragflow_url: "",
                            ragflow_token: "",
                            dataset_ids: [],
                        } as KnowledgeConfig,
                    ];

            const configs = [...baseConfigs];
            const current =
                configs[index] ??
                ({
                    ragflow_url: "",
                    ragflow_token: "",
                    dataset_ids: [],
                } as KnowledgeConfig);

            configs[index] = {
                ...current,
                [field]: value,
            } as KnowledgeConfig;

            return {
                ...prev,
                ragflow_configs: configs,
            };
        });
        // 清除对应字段的错误
        if (knowledgeErrors[index] && knowledgeErrors[index][field as keyof typeof knowledgeErrors[number]]) {
            setKnowledgeErrors((prev) => {
                const newErrors = { ...prev };
                if (newErrors[index]) {
                    delete newErrors[index][field as keyof typeof newErrors[number]];
                    if (Object.keys(newErrors[index]).length === 0) {
                        delete newErrors[index];
                    }
                }
                return newErrors;
            });
        }
    };

    const addKnowledgeConfig = () => {
        setFormData((prev) => ({
            ...prev,
            ragflow_configs: [
                ...(prev.ragflow_configs || []),
                {
                    ragflow_url: "",
                    ragflow_token: "",
                    dataset_ids: [],
                },
            ],
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // 验证必填字段
        const newErrors: typeof errors = {};

        if (!formData.name.trim()) {
            newErrors.name = "Name 是必填项";
        }

        if (!formData.description.trim()) {
            newErrors.description = "Description 是必填项";
        }

        if (!formData.llmProvider.trim()) {
            newErrors.llmProvider = "Provider 是必填项";
        }

        // 如果是自定义模型，需要验证 baseUrl 和 apiKey
        if (formData.model_source === "custom") {
            if (!formData.baseUrl.trim()) {
                newErrors.baseUrl = "Base URL 是必填项";
            }
            if (!formData.apiKey.trim()) {
                newErrors.apiKey = "API Key 是必填项";
            }
        }

        // 验证工具配置
        const newToolErrors: typeof toolErrors = {};
        let hasToolErrors = false;
        formData.toolConfigs.forEach((tool) => {
            if (!tool.url.trim()) {
                newToolErrors[tool.id] = { url: "URL 是必填项" };
                hasToolErrors = true;
            }
        });

        // 验证知识配置
        const newKnowledgeErrors: typeof knowledgeErrors = {};
        let hasKnowledgeErrors = false;
        formData.ragflow_configs.forEach((cfg, index) => {
            const cfgErrors: typeof newKnowledgeErrors[number] = {};
            if (!cfg.ragflow_token || !cfg.ragflow_token.trim()) {
                cfgErrors.ragflow_token = "Ragflow Token 是必填项";
                hasKnowledgeErrors = true;
            }
            if (!cfg.dataset_ids || cfg.dataset_ids.length === 0) {
                cfgErrors.dataset_ids = "Dataset IDs 是必填项，请至少选择一个数据集";
                hasKnowledgeErrors = true;
            }
            // 如果 provider 是 local，验证 ragflow_url
            const provider = knowledgeProviders[index] || "ihep";
            if (provider === "local" && (!cfg.ragflow_url || !cfg.ragflow_url.trim())) {
                cfgErrors.ragflow_url = "Knowledge URL 是必填项（Local Knowledge 模式）";
                hasKnowledgeErrors = true;
            }
            if (Object.keys(cfgErrors).length > 0) {
                newKnowledgeErrors[index] = cfgErrors;
            }
        });

        setToolErrors(newToolErrors);
        setKnowledgeErrors(newKnowledgeErrors);
        setErrors(newErrors);

        // 如果有错误，不提交
        if (Object.keys(newErrors).length > 0 || hasToolErrors || hasKnowledgeErrors) {
            return;
        }

        // 临时测试数据：表单为空时使用默认值，方便快速联调，测试完可以删掉这段逻辑
        const hasValidRagflowConfig =
            formData.ragflow_configs &&
            formData.ragflow_configs.some(
                (cfg) =>
                    cfg &&
                    (cfg.ragflow_token ||
                        (cfg.dataset_ids && cfg.dataset_ids.length > 0))
            );

        const ragflowConfigs: KnowledgeConfig[] = hasValidRagflowConfig
            ? formData.ragflow_configs
            : [
                {
                    ragflow_url: "https://aiweb01.ihep.ac.cn:886",
                    ragflow_token: "test-knowledge-token",
                    dataset_ids: ["sample-dataset-1"],
                },
            ];

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
            mcp_sse_list:
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
            // 后端需要 ragflow_configs: KnowledgeConfig[]
            ragflow_configs: ragflowConfigs,
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
                                Name <span className="text-red-500">*</span>
                            </label>
                            <Input
                                value={formData.name}
                                onChange={(e) =>
                                    handleInputChange("name", e.target.value)
                                }
                                placeholder="Set name"
                                status={errors.name ? "error" : undefined}
                                style={{ marginTop: '0.25rem', width: '100%', maxWidth: '36rem' }}
                            />
                            {errors.name && (
                                <p className="mt-1 text-xs text-red-500">{errors.name}</p>
                            )}
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
                                Description <span className="text-red-500">*</span>
                            </label>
                            <Input
                                value={formData.description}
                                onChange={(e) =>
                                    handleInputChange("description", e.target.value)
                                }
                                placeholder="一句话描述 Agent 的风格或用途"
                                status={errors.description ? "error" : undefined}
                                style={{ width: '100%' }}
                            />
                            {errors.description && (
                                <p className="mt-1 text-xs text-red-500">{errors.description}</p>
                            )}
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
                            <Input
                                value={formData.system_message}
                                onChange={(e) =>
                                    handleInputChange("system_message", e.target.value)
                                }
                                placeholder="可选提示：例如始终以投研顾问回答"
                                style={{ width: '100%' }}
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
                        {/* model_source 下拉框 */}
                        <div className="flex flex-col gap-1">
                            <span
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                model_source
                            </span>
                            <Select
                                value={formData.model_source || "HepAI"}
                                onChange={(value) => handleInputChange("model_source", value)}
                                placeholder="选择模型来源"
                                style={{ width: '100%' }}
                                options={[
                                    { value: "HepAI", label: "HepAI" },
                                    { value: "custom", label: "自定义模型" },
                                ]}
                            />
                        </div>

                        {/* Provider 始终显示 */}
                        <div className="flex flex-col gap-1">
                            <span
                                className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                    ? "text-gray-400"
                                    : "text-gray-500"
                                    }`}
                            >
                                Provider <span className="text-red-500">*</span>
                            </span>
                            {formData.model_source === "HepAI"
                                ? (
                                    <Select
                                        value={formData.llmProvider || undefined}
                                        onChange={(value) => handleInputChange("llmProvider", value)}
                                        placeholder="选择 Provider"
                                        showSearch
                                        style={{ width: '100%' }}
                                        options={providerOptions}
                                        filterOption={(input, option) =>
                                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                                            (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                                        }
                                        className={`
                                            ${errors.llmProvider ? "ant-select-error" : ""}
                                        `}
                                        status={errors.llmProvider ? "error" : undefined}
                                    />
                                )
                                : (
                                    <>
                                        <Input
                                            value={formData.llmProvider}
                                            onChange={(e) =>
                                                handleInputChange("llmProvider", e.target.value)
                                            }
                                            placeholder="OpenAI / Qwen"
                                            status={errors.llmProvider ? "error" : undefined}
                                            style={{ width: '100%' }}
                                        />
                                        {errors.llmProvider && (
                                            <p className="mt-1 text-xs text-red-500">{errors.llmProvider}</p>
                                        )}
                                    </>
                                )}
                            {formData.model_source === "HepAI" && errors.llmProvider && (
                                <p className="mt-1 text-xs text-red-500">{errors.llmProvider}</p>
                            )}
                        </div>

                        {/* 选中"自定义模型"时展示 Base URL 和 API Key */}
                        {formData.model_source === "custom" && (
                            <>
                                <div className="flex flex-col gap-1">
                                    <span
                                        className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                            ? "text-gray-400"
                                            : "text-gray-500"
                                            }`}
                                    >
                                        Base URL <span className="text-red-500">*</span>
                                    </span>
                                    <Input
                                        value={formData.baseUrl}
                                        onChange={(e) =>
                                            handleInputChange("baseUrl", e.target.value)
                                        }
                                        placeholder="https://api.example.com"
                                        status={errors.baseUrl ? "error" : undefined}
                                        style={{ width: '100%' }}
                                    />
                                    {errors.baseUrl && (
                                        <p className="mt-1 text-xs text-red-500">{errors.baseUrl}</p>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span
                                        className={`text-xs font-medium uppercase tracking-wide ${darkMode === "dark"
                                            ? "text-gray-400"
                                            : "text-gray-500"
                                            }`}
                                    >
                                        API Key <span className="text-red-500">*</span>
                                    </span>
                                    <Input.Password
                                        value={formData.apiKey}
                                        onChange={(e) =>
                                            handleInputChange("apiKey", e.target.value)
                                        }
                                        placeholder="sk-***"
                                        status={errors.apiKey ? "error" : undefined}
                                        style={{ width: '100%' }}
                                    />
                                    {errors.apiKey && (
                                        <p className="mt-1 text-xs text-red-500">{errors.apiKey}</p>
                                    )}
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
                                    errors={toolErrors[config.id]}
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
                                连接到一个或多个知识源，增强 RAG 能力
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={addKnowledgeConfig}
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
                            增加KnowledgeBase
                        </button>
                    </header>

                    {(formData.ragflow_configs && formData.ragflow_configs.length > 0
                        ? formData.ragflow_configs
                        : [
                            {
                                ragflow_url: "",
                                ragflow_token: "",
                                dataset_ids: [],
                            } as KnowledgeConfig,
                        ]
                    ).map((cfg, index) => (
                        <div key={index} className={index === 0 ? "" : "mt-4"}>
                            <KnowledgeConfigurationForm
                                config={cfg}
                                onConfigChange={(field, value) =>
                                    handleKnowledgeConfigChange(index, field, value)
                                }
                                darkMode={darkMode}
                                showLabel={index === 0}
                                errors={knowledgeErrors[index]}
                                onProviderChange={(provider) => {
                                    setKnowledgeProviders((prev) => ({
                                        ...prev,
                                        [index]: provider,
                                    }));
                                }}
                            />
                        </div>
                    ))}
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
