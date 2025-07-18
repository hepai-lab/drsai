import React, { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { appContext } from "../../../hooks/provider";

export interface ToolConfig {
    id: string;
    type: string;
    url: string;
    token: string;
    workerName?: string; // 为HepAI添加worker name字段
}

export interface ToolConfigurationFormProps {
    config: ToolConfig;
    index: number;
    onConfigChange: (
        id: string,
        field: keyof ToolConfig,
        value: string
    ) => void;
    onRemove: (id: string) => void;
    canRemove: boolean;
    toolsOpen: boolean;
    onToolsOpenChange: (open: boolean) => void;
}

const ToolConfigurationForm: React.FC<ToolConfigurationFormProps> = ({
    config,
    index,
    onConfigChange,
    onRemove,
    canRemove,
    toolsOpen,
    onToolsOpenChange,
}) => {
    const { darkMode } = React.useContext(appContext);

    // Tools options
    const toolsOptions = [
        { value: "MCP", label: "MCP" },
        { value: "HepAI", label: "HepAI" },
        { value: "OpenAPI", label: "OpenAPI" },
    ];

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

    const renderInputField = (
        label: string,
        value: string,
        onChange: (value: string) => void,
        type: "text" | "password" = "text",
        placeholder: string = "Value"
    ) => (
        <div className="flex items-center mb-3">
            <label
                className={`
                w-20 text-sm font-medium
                ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
            `}
            >
                {label}:
            </label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={`
                    flex-1 ml-4 px-3 py-2 rounded-md border
                    ${darkMode === "dark"
                        ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                        : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                    }
                    focus:outline-none focus:border-[#4d3dc3]
                `}
            />
        </div>
    );

    // 根据选择的工具类型渲染不同的字段
    const renderFieldsByToolType = () => {
        switch (config.type) {
            case "MCP":
                return (
                    <>
                        {renderInputField("URL", config.url, (value) =>
                            onConfigChange(config.id, "url", value)
                        )}
                        {renderInputField(
                            "Token",
                            config.token,
                            (value) =>
                                onConfigChange(config.id, "token", value),
                            "password"
                        )}
                    </>
                );
            case "HepAI":
                return (
                    <>
                        {renderInputField(
                            "Worker Name",
                            config.workerName || "",
                            (value) =>
                                onConfigChange(config.id, "workerName", value)
                        )}
                        {renderInputField("URL", config.url, (value) =>
                            onConfigChange(config.id, "url", value)
                        )}
                    </>
                );
            case "OpenAPI":
                return (
                    <>
                        {renderInputField("URL", config.url, (value) =>
                            onConfigChange(config.id, "url", value)
                        )}
                    </>
                );
            default:
                return null;
        }
    };

    return (
        <div
            className={`
                border-2 rounded-md p-4
                ${darkMode === "dark"
                    ? "border-[#e5e5e530] bg-[#3a3a3a]"
                    : "border-[#e2e8f0] bg-[#f9fafb]"
                }
            `}
        >
            <div className="flex items-center justify-between mb-3">
                <span
                    className={`
                    text-sm font-medium
                    ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                `}
                >
                    Configuration {index + 1}
                </span>
                {canRemove && (
                    <button
                        type="button"
                        onClick={() => onRemove(config.id)}
                        className={`
                            p-1 rounded-full hover:bg-gray-100
                            ${darkMode === "dark" ? "hover:bg-gray-400" : ""}
                        `}
                    >
                        <X className="w-4 h-4 text-gray-500 hover:text-white" />
                    </button>
                )}
            </div>

            {/* Tools Selection */}
            <div className="flex items-center mb-3">
                <label
                    className={`
                    w-20 text-sm font-medium
                    ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                `}
                >
                    Type:
                </label>
                <div className="flex-1 ml-4">
                    {renderSelect(
                        config.type,
                        toolsOptions,
                        (value) => onConfigChange(config.id, "type", value),
                        "Select Tool Type",
                        toolsOpen,
                        onToolsOpenChange
                    )}
                </div>
            </div>

            {/* Dynamic Fields Based on Tool Type */}
            {renderFieldsByToolType()}
        </div>
    );
};

export default ToolConfigurationForm;
