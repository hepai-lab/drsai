import React, { useEffect, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { appContext } from "../../../hooks/provider";
import ToolConfigurationForm, { ToolConfig } from "./ToolConfigurationForm";

export interface DrsaiAgentData {
    name: string;
    planer: {
        llmModel: string;
    };
    coder: {
        llmModel: string;
        knowledge: string;
    };
    tester: ToolConfig;
    host: {
        llmModel: string;
    };
    parser: {
        llmModel: string;
    };
}

interface DrsaiAgentFormProps {
    onSubmit: (data: DrsaiAgentData) => void;
    onCancel: () => void;
    initialData?: Partial<DrsaiAgentData>;
    models: { id: string }[]; // 可选的模型列表
}

const DrsaiAgentForm: React.FC<DrsaiAgentFormProps> = ({
    onSubmit,
    onCancel,
    initialData,
    models,
}) => {
    const { darkMode } = React.useContext(appContext);
    const [formData, setFormData] = useState<DrsaiAgentData>({
        name: initialData?.name || "",
        planer: initialData?.planer || { llmModel: "" },
        coder: initialData?.coder || { llmModel: "", knowledge: "" },
        tester: initialData?.tester || {
            id: "1",
            tools: "",
            url: "",
            token: "",
            workerName: "",
        },
        host: initialData?.host || { llmModel: "" },
        parser: initialData?.parser || { llmModel: "" },
    });

    // 为每个下拉框添加独立的状态
    const [llmModelOpen, setLlmModelOpen] = useState<{
        [key: string]: boolean;
    }>({});
    const [toolsOpen, setToolsOpen] = useState(false);
    const [llmModelOptions, setLlmModelOptions] = useState<
        { value: string; label: string }[]
    >([]);
    const [toolsOptions, setToolsOptions] = useState<
        { value: string; label: string }[]
    >([
        { value: "MCP", label: "MCP" },
        { value: "HepAI", label: "HepAI" },
        { value: "OpenAPI", label: "OpenAPI" },
    ]);

    useEffect(() => {
        if (models) {
            setLlmModelOptions(
                models.map((model) => ({ value: model.id, label: model.id }))
            );
        }
    }, [models]);

    const handleInputChange = (field: keyof DrsaiAgentData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSectionChange = (
        section: keyof Omit<DrsaiAgentData, "name">,
        field: string,
        value: string
    ) => {
        setFormData((prev) => ({
            ...prev,
            [section]: { ...prev[section], [field]: value },
        }));
    };

    const handleTesterConfigChange = (
        id: string,
        field: keyof ToolConfig,
        value: string
    ) => {
        setFormData((prev) => ({
            ...prev,
            tester: { ...prev.tester, [field]: value },
        }));
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

    const renderSection = (
        title: string,
        fields: {
            key: string;
            label: string;
            type: "text" | "select";
            options?: string[];
        }[],
        sectionKey: keyof Omit<DrsaiAgentData, "name">
    ) => (
        <div className="space-y-3">
            <div className="flex items-center">
                <div className="w-2 h-4 bg-[#4d3dc3] rounded mr-3"></div>
                <h3
                    className={`
                    text-sm font-medium
                    ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                `}
                >
                    {title}:
                </h3>
            </div>
            {fields.map((field) => (
                <div key={field.key} className="flex items-center">
                    <label
                        className={`
                        w-20 text-sm font-medium
                        ${darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                            }
                    `}
                    >
                        {field.label}:
                    </label>
                    <div className="flex-1 ml-4">
                        {field.type === "select" ? (
                            renderSelect(
                                formData[sectionKey][
                                field.key as keyof (typeof formData)[typeof sectionKey]
                                ] as string,
                                field.key === "tools"
                                    ? toolsOptions
                                    : llmModelOptions,
                                (value) =>
                                    handleSectionChange(
                                        sectionKey,
                                        field.key,
                                        value
                                    ),
                                "Value",
                                llmModelOpen[`${sectionKey}-${field.key}`] ||
                                false,
                                (open) =>
                                    setLlmModelOpen((prev) => ({
                                        ...prev,
                                        [`${sectionKey}-${field.key}`]: open,
                                    }))
                            )
                        ) : (
                            <input
                                type="text"
                                value={
                                    formData[sectionKey][
                                    field.key as keyof (typeof formData)[typeof sectionKey]
                                    ] as string
                                }
                                onChange={(e) =>
                                    handleSectionChange(
                                        sectionKey,
                                        field.key,
                                        e.target.value
                                    )
                                }
                                placeholder="Value"
                                className={`
                                    w-full px-3 py-2 rounded-md border
                                    ${darkMode === "dark"
                                        ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                        : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3]
                                `}
                            />
                        )}
                    </div>
                    {field.key === "tools" && (
                        <button
                            type="button"
                            onClick={() => {
                                /* Add tool logic */
                            }}
                            className={`
                                p-2 rounded-full bg-[#4d3dc3] text-white hover:bg-[#3d2db3]
                                transition-colors duration-200 ml-2
                            `}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );

    return (
        <div
            className={`
            p-6 px-4 rounded-lg border my-4
            ${darkMode === "dark"
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
                Drsai Agent
            </h2>

            <form
                onSubmit={handleSubmit}
                className="space-y-4 pr-4 h-[400px] overflow-auto"
            >

                {/* Planer Section */}
                {renderSection(
                    "planer",
                    [{ key: "llmModel", label: "LLM Model", type: "select" }],
                    "planer"
                )}

                {/* Coder Section */}
                {renderSection(
                    "coder",
                    [
                        { key: "llmModel", label: "LLM Model", type: "select" },
                        { key: "knowledge", label: "Knowledge", type: "text" },
                    ],
                    "coder"
                )}

                {/* Tester Section */}
                <div className="space-y-3">
                    <div className="flex items-center">
                        <div className="w-2 h-4 bg-[#4d3dc3] rounded mr-3"></div>
                        <h3
                            className={`
                            text-sm font-medium
                            ${darkMode === "dark"
                                    ? "text-[#e5e5e5]"
                                    : "text-[#4a5568]"
                                }
                        `}
                        >
                            Tester:
                        </h3>
                    </div>
                    <div className="ml-5">
                        <ToolConfigurationForm
                            config={formData.tester}
                            index={0}
                            onConfigChange={handleTesterConfigChange}
                            onRemove={() => { }} // 不提供删除功能
                            canRemove={false}
                            toolsOpen={toolsOpen}
                            onToolsOpenChange={setToolsOpen}
                        />
                    </div>
                </div>

                {/* Host Section */}
                {renderSection(
                    "Host",
                    [{ key: "llmModel", label: "LLM Model", type: "select" }],
                    "host"
                )}

                {/* Parser Section */}
                {renderSection(
                    "Parser",
                    [{ key: "llmModel", label: "LLM Model", type: "select" }],
                    "parser"
                )}

                {/* Action Buttons */}
                <div className="flex gap-4 pt-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`
                            flex-1 px-4 py-2 rounded-md font-medium transition-colors
                            ${darkMode === "dark"
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

export default DrsaiAgentForm;
