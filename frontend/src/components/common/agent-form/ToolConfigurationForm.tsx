import React, { useState } from "react";
import { X } from "lucide-react";
import { Select, Input } from "antd";
import { appContext } from "../../../hooks/provider";

export interface ToolConfig {
    id: string;
    type: "MCP";
    url: string;
    token: string;
    // 以下为可选高级配置，不是必填
    timeout?: number;
    sse_read_timeout?: number;
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
    errors?: { url?: string };
}

const ToolConfigurationForm: React.FC<ToolConfigurationFormProps> = ({
    config,
    index,
    onConfigChange,
    onRemove,
    canRemove,
    errors,
}) => {
    const { darkMode } = React.useContext(appContext);

    // Tools options - 当前只支持 MCP，但可以配置多个 MCP
    const toolsOptions = [{ value: "MCP", label: "MCP" }];

    const renderInputField = (
        label: string,
        value: string,
        onChange: (value: string) => void,
        type: "text" | "password" = "text",
        placeholder: string = "Value",
        isRequired: boolean = false,
        error?: string
    ) => {
        const InputComponent = type === "password" ? Input.Password : Input;
        return (
            <div className="flex flex-col mb-3">
                <div className="flex items-center">
                    <label
                        className={`
                        w-20 text-sm font-medium
                        ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                    `}
                    >
                        {label}: {isRequired && <span className="text-red-500">*</span>}
                    </label>
                    <div className="flex-1 ml-4">
                        <InputComponent
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder={placeholder}
                            status={error ? "error" : undefined}
                            style={{ width: '100%' }}
                        />
                    </div>
                </div>
                {error && (
                    <p className="mt-1 ml-24 text-xs text-red-500">{error}</p>
                )}
            </div>
        );
    };

    // 根据选择的工具类型渲染不同的字段（当前只支持 MCP）
    const renderFieldsByToolType = () => {
        switch (config.type) {
            case "MCP":
                return (
                    <>
                        {renderInputField("URL", config.url, (value) =>
                            onConfigChange(config.id, "url", value),
                            "text",
                            "Value",
                            true,
                            errors?.url
                        )}
                        {renderInputField(
                            "Token",
                            config.token,
                            (value) =>
                                onConfigChange(config.id, "token", value),
                            "password",
                            false
                        )}
                    </>
                );
            default:
                // 兜底也按 MCP 渲染，保证表单可用
                return (
                    <>
                        {renderInputField("URL", config.url, (value) =>
                            onConfigChange(config.id, "url", value),
                            "text",
                            "Value",
                            true,
                            errors?.url
                        )}
                        {renderInputField(
                            "Token",
                            config.token,
                            (value) =>
                                onConfigChange(config.id, "token", value),
                            "password",
                            false
                        )}
                    </>
                );
        }
    };

    return (
        <div
            className={`
                 rounded-md p-4
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
                    <Select
                        value={config.type}
                        onChange={(value) => onConfigChange(config.id, "type", value)}
                        placeholder="Select Tool Type"
                        style={{ width: '100%' }}
                        options={toolsOptions}
                    />
                </div>
            </div>

            {/* Dynamic Fields Based on Tool Type */}
            {renderFieldsByToolType()}
        </div>
    );
};

export default ToolConfigurationForm;
