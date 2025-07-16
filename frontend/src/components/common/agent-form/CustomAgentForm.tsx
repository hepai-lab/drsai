import React, { useState } from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import { appContext } from "../../../hooks/provider";

export interface ToolConfig {
    id: string;
    tools: string;
    url: string;
    token: string;
}

export interface CustomAgentData {
    name: string;
    llmModel: string;
    toolConfigs: ToolConfig[];
    knowledge: string;
}

interface CustomAgentFormProps {
    onSubmit: (data: CustomAgentData) => void;
    onCancel: () => void;
    initialData?: Partial<CustomAgentData>;
}

const CustomAgentForm: React.FC<CustomAgentFormProps> = ({
    onSubmit,
    onCancel,
    initialData,
}) => {
    const { darkMode } = React.useContext(appContext);
    const [formData, setFormData] = useState<CustomAgentData>({
        name: initialData?.name || "",
        llmModel: initialData?.llmModel || "MCP",
        toolConfigs: initialData?.toolConfigs || [
            { id: "1", tools: "", url: "", token: "" },
        ],
        knowledge: initialData?.knowledge || "none",
    });

    // 为每个下拉框添加独立的状态
    const [llmModelOpen, setLlmModelOpen] = useState(false);
    const [knowledgeOpen, setKnowledgeOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState<{ [key: string]: boolean }>({});

    // LLM Model options
    const llmModelOptions = [
        { value: "MCP", label: "MCP" },
        { value: "HepAI", label: "HepAI" },
        { value: "Open API", label: "Open API" },
        { value: "GPT-4", label: "GPT-4" },
        { value: "Claude", label: "Claude" },
    ];

    // Knowledge options
    const knowledgeOptions = [
        { value: "none", label: "无知识库" },
        { value: "general", label: "通用知识库" },
        { value: "scientific", label: "科学知识库" },
        { value: "custom", label: "自定义知识库" },
        { value: "besiii", label: "BESIII实验知识库" },
    ];

    // Tools options (示例)
    const toolsOptions = [
        { value: "web_search", label: "Web搜索" },
        { value: "file_reader", label: "文件读取" },
        { value: "calculator", label: "计算器" },
        { value: "code_executor", label: "代码执行" },
        { value: "database", label: "数据库查询" },
    ];

    const handleInputChange = (field: keyof CustomAgentData, value: string) => {
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
                { id: newId, tools: "", url: "", token: "" },
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
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

        return (
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className={`
                        w-full flex items-center justify-between px-3 py-2 rounded-md
                        border transition-all duration-200
                        ${
                            darkMode === "dark"
                                ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] hover:border-[#e5e5e560]"
                                : "bg-white text-[#4a5568] border-[#e2e8f0] hover:border-[#4d3dc3]"
                        }
                    `}
                >
                    <span className={selectedOption ? "" : "text-gray-400"}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                            isOpen ? "rotate-180" : ""
                        }`}
                    />
                </button>

                {isOpen && (
                    <div
                        className={`
                        absolute top-full left-0 right-0 mt-1 z-50 rounded-md shadow-lg border
                        ${
                            darkMode === "dark"
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
                                    ${
                                        darkMode === "dark"
                                            ? "text-[#e5e5e5] hover:bg-[#444444]"
                                            : "text-[#4a5568] hover:bg-[#f9fafb]"
                                    }
                                    ${
                                        value === option.value
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
            p-6 rounded-lg border my-4
            ${
                darkMode === "dark"
                    ? "bg-[#2a2a2a] border-[#e5e5e530]"
                    : "bg-white border-[#e2e8f0]"
            }
        `}
        >
            <h2
                className={`
                text-xl font-semibold text-center mb-6
                ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
            `}
            >
                Custom Your Agent
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name Field */}
                <div className="flex items-center">
                    <label
                        className={`
                        w-20 text-sm font-medium
                        ${
                            darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                        }
                    `}
                    >
                        Name:
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                            handleInputChange("name", e.target.value)
                        }
                        placeholder="Value"
                        className={`
                            flex-1 ml-4 px-3 py-2 rounded-md border
                            ${
                                darkMode === "dark"
                                    ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                    : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                            }
                            focus:outline-none focus:border-[#4d3dc3]
                        `}
                    />
                </div>

                {/* LLM Model Field */}
                <div className="flex items-center">
                    <label
                        className={`
                        w-20 text-sm font-medium
                        ${
                            darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                        }
                    `}
                    >
                        LLM Model:
                    </label>
                    <div className="flex-1 ml-4">
                        {renderSelect(
                            formData.llmModel,
                            llmModelOptions,
                            (value) => handleInputChange("llmModel", value),
                            "Value",
                            llmModelOpen,
                            setLlmModelOpen
                        )}
                    </div>
                </div>

                {/* Tool Configs */}
                {formData.toolConfigs.map((config, index) => (
                    <div
                        key={config.id}
                        className={`
                            border-2 rounded-md p-4
                            ${
                                darkMode === "dark"
                                    ? "border-[#e5e5e530] bg-[#3a3a3a]"
                                    : "border-[#e2e8f0] bg-[#f9fafb]"
                            }
                        `}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <span
                                className={`
                                text-sm font-medium
                                ${
                                    darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                }
                            `}
                            >
                                Configuration {index + 1}
                            </span>
                            {formData.toolConfigs.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeToolConfig(config.id)}
                                    className={`
                                        p-1 rounded-full hover:bg-red-100
                                        ${
                                            darkMode === "dark"
                                                ? "hover:bg-red-900"
                                                : ""
                                        }
                                    `}
                                >
                                    <X className="w-4 h-4 text-red-500" />
                                </button>
                            )}
                        </div>

                        {/* Tools */}
                        <div className="flex items-center mb-3">
                            <label
                                className={`
                                w-16 text-sm font-medium
                                ${
                                    darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                }
                            `}
                            >
                                Tools:
                            </label>
                            <div className="flex-1 ml-4 flex items-center gap-2">
                                {renderSelect(
                                    config.tools,
                                    toolsOptions,
                                    (value) =>
                                        handleToolConfigChange(
                                            config.id,
                                            "tools",
                                            value
                                        ),
                                    "Value",
                                    toolsOpen[config.id] || false,
                                    (open) =>
                                        setToolsOpen((prev) => ({
                                            ...prev,
                                            [config.id]: open,
                                        }))
                                )}
                                <button
                                    type="button"
                                    onClick={addToolConfig}
                                    className={`
                                        p-2 rounded-full bg-[#4d3dc3] text-white hover:bg-[#3d2db3]
                                        transition-colors duration-200
                                    `}
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* URL */}
                        <div className="flex items-center mb-3">
                            <label
                                className={`
                                w-16 text-sm font-medium
                                ${
                                    darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                }
                            `}
                            >
                                URL:
                            </label>
                            <input
                                type="text"
                                value={config.url}
                                onChange={(e) =>
                                    handleToolConfigChange(
                                        config.id,
                                        "url",
                                        e.target.value
                                    )
                                }
                                placeholder="Value"
                                className={`
                                    flex-1 ml-4 px-3 py-2 rounded-md border
                                    ${
                                        darkMode === "dark"
                                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3]
                                `}
                            />
                        </div>

                        {/* Token */}
                        <div className="flex items-center">
                            <label
                                className={`
                                w-16 text-sm font-medium
                                ${
                                    darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                }
                            `}
                            >
                                Token:
                            </label>
                            <input
                                type="password"
                                value={config.token}
                                onChange={(e) =>
                                    handleToolConfigChange(
                                        config.id,
                                        "token",
                                        e.target.value
                                    )
                                }
                                placeholder="Value"
                                className={`
                                    flex-1 ml-4 px-3 py-2 rounded-md border
                                    ${
                                        darkMode === "dark"
                                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3]
                                `}
                            />
                        </div>
                    </div>
                ))}

                {/* Knowledge Field */}
                <div className="flex items-center">
                    <label
                        className={`
                        w-20 text-sm font-medium
                        ${
                            darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                        }
                    `}
                    >
                        Knowledge:
                    </label>
                    <div className="flex-1 ml-4">
                        {renderSelect(
                            formData.knowledge,
                            knowledgeOptions,
                            (value) => handleInputChange("knowledge", value),
                            "Value",
                            knowledgeOpen,
                            setKnowledgeOpen
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`
                            flex-1 px-4 py-2 rounded-md font-medium transition-colors
                            ${
                                darkMode === "dark"
                                    ? "bg-gray-600 text-[#e5e5e5] hover:bg-gray-700"
                                    : "bg-gray-200 text-[#4a5568] hover:bg-gray-300"
                            }
                        `}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="flex-1 px-4 py-2 rounded-md font-medium bg-[#4d3dc3] text-white hover:bg-[#3d2db3] transition-colors"
                    >
                        Save
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CustomAgentForm;
