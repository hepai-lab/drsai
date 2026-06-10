import React from "react";
import { Select, Input } from "antd";
import { Info, X } from "lucide-react";

export interface KnowledgeConfig {
    // 后端需要的字段：ragflow_url / ragflow_token / dataset_ids
    ragflow_url: string;
    ragflow_token: string;
    // 支持多选数据集
    dataset_ids: string[];
}

interface KnowledgeConfigurationFormProps {
    config: KnowledgeConfig;
    index: number;
    // ragflow_url / ragflow_token 传 string，dataset_ids 传 string[]
    onConfigChange: (field: keyof KnowledgeConfig, value: string | string[]) => void;
    onRemove?: () => void;
    canRemove?: boolean;
    darkMode?: string;
    showLabel?: boolean;
    errors?: {
        ragflow_url?: string;
        ragflow_token?: string;
        dataset_ids?: string;
    };
    provider?: "ihep" | "local";
    onProviderChange?: (provider: "ihep" | "local") => void;
}

const KnowledgeConfigurationForm: React.FC<KnowledgeConfigurationFormProps> = ({
    config,
    index,
    onConfigChange,
    onRemove,
    canRemove = false,
    darkMode = "light",
    showLabel = true,
    errors,
    provider: externalProvider,
    onProviderChange,
}) => {
    const handleGetApiKey = () => {
        // 默认URL，可以根据实际需求修改
        const defaultUrl = "https://ragflow.ihep.ac.cn/user-setting/api";
        window.open(defaultUrl, "_blank");
    };

    const [dataSets, setDataSets] = React.useState<
        { label: string; value: string }[]
    >([]);
    // Provider 选择：Ihep Knowledge / Local Knowledge
    const [provider, setProvider] = React.useState<"ihep" | "local">(
        externalProvider || "ihep"
    );

    // 使用 ref 存储 onProviderChange，避免依赖问题
    const onProviderChangeRef = React.useRef(onProviderChange);
    React.useEffect(() => {
        onProviderChangeRef.current = onProviderChange;
    }, [onProviderChange]);

    // 如果外部传入 provider，使用外部的
    const currentProvider = externalProvider || provider;

    React.useEffect(() => {
        const fetchDataSets = async () => {
            if (!config.ragflow_url || !config.ragflow_token) return;

            const baseUrl = config.ragflow_url.replace(/\/+$/, "");
            const response = await fetch(`${baseUrl}/api/v1/datasets`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.ragflow_token}`,
                },
            });
            const data = await response.json();

            setDataSets(
                (data.data || []).map((item: any) => ({
                    label: item.name,
                    value: item.id ?? item.name,
                }))
            );
        };
        if (config.ragflow_url && config.ragflow_token) {
            fetchDataSets();
        }
    }, [config.ragflow_url, config.ragflow_token]);

    // 如果是 IHEP Provider 且 ragflow_url 还是空，自动填充默认 URL
    React.useEffect(() => {
        if (currentProvider === "ihep" && !config.ragflow_url) {
            onConfigChange("ragflow_url", "https://ragflow.ihep.ac.cn");
        }
    }, [currentProvider, config.ragflow_url, onConfigChange]);

    // 当 provider 改变时，同步到外部（如果需要）
    React.useEffect(() => {
        if (externalProvider && externalProvider !== provider) {
            setProvider(externalProvider);
            // 如果外部 provider 是 ihep，则自动设置默认的 Ragflow URL
            if (externalProvider === "ihep") {
                onConfigChange("ragflow_url", "https://ragflow.ihep.ac.cn");
            }
        }
    }, [externalProvider, provider, onConfigChange]);

    // 当 provider 改变时，通知父组件
    React.useEffect(() => {
        if (onProviderChangeRef.current) {
            onProviderChangeRef.current(currentProvider);
        }
    }, [currentProvider]);

    const renderContent = (labelWidth: string) => (
        <div
            className={`flex-1 space-y-4 w-full items-center justify-between px-3 py-2 rounded-md
                border transition-all duration-200  ${darkMode === "dark"
                    ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                    : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                }  `}
        >
            {/* Provider Field */}
            <div className="flex items-center">
                <label
                    className={`
                        ${labelWidth} text-sm font-medium
                        ${darkMode === "dark"
                            ? "text-[#e5e5e5]"
                            : "text-[#4a5568]"
                        }
                    `}
                >
                    Provider:
                </label>
                <div className="flex-1 ml-4">
                    <Select
                        value={currentProvider}
                        onChange={(value) => {
                            const newProvider = value as "ihep" | "local";
                            setProvider(newProvider);
                            // 如果切换到非 local（即 ihep），自动设置默认 Ragflow URL
                            if (newProvider === "ihep") {
                                onConfigChange("ragflow_url", "https://ragflow.ihep.ac.cn");
                            }
                        }}
                        style={{ width: '100%' }}
                        options={[
                            { value: "ihep", label: "Ihep Knowledge" },
                            { value: "local", label: "Local Knowledge" },
                        ]}
                    />
                </div>
            </div>

            {/* Local Knowledge: URL 输入 */}
            {currentProvider === "local" && (
                <div className="flex items-center">
                    <label
                        className={`
                            ${labelWidth} text-sm font-medium
                            ${darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                            }
                        `}
                    >
                        Knowledge URL: <span className="text-red-500">*</span>
                    </label>
                    <div className="flex-1 ml-4">
                        <Input
                            value={config.ragflow_url}
                            onChange={(e) =>
                                onConfigChange("ragflow_url", e.target.value)
                            }
                            placeholder="例如 http://localhost:886"
                            status={errors?.ragflow_url ? "error" : undefined}
                            style={{ width: '100%' }}
                        />
                        {errors?.ragflow_url && (
                            <p className="mt-1 text-xs text-red-500">{errors.ragflow_url}</p>
                        )}
                    </div>
                </div>
            )}

            {/* Ragflow Token Field */}
            <div className="flex items-center">
                <label
                    className={`
                        ${labelWidth} text-sm font-medium
                        ${darkMode === "dark"
                            ? "text-[#e5e5e5]"
                            : "text-[#4a5568]"
                        }
                    `}
                >
                    Ragflow Token: <span className="text-red-500">*</span>
                </label>
                <div className="flex-1 ml-4 relative group">
                    <Input.Password
                        value={config.ragflow_token}
                        onChange={(e) =>
                            onConfigChange("ragflow_token", e.target.value)
                        }
                        placeholder="请输入 Ragflow Token"
                        status={errors?.ragflow_token ? "error" : undefined}
                        style={{ width: '100%' }}
                    />
                    {errors?.ragflow_token && (
                        <p className="mt-1 text-xs text-red-500 absolute top-full left-0">{errors.ragflow_token}</p>
                    )}
                    <button
                        type="button"
                        className={`
                            absolute right-12 top-1/2 transform -translate-y-1/2 p-1 z-10
                            ${darkMode === "dark"
                                ? "text-[#e5e5e5] hover:text-[#4d3dc3]"
                                : "text-[#4a5568] hover:text-[#4d3dc3]"
                            }
                        `}
                    >
                        <Info className="w-4 h-4" />
                        {/* API Key Help Tooltip */}
                        <div
                            className={`
                                absolute bottom-full right-0 mb-2 p-3 rounded-md text-sm w-64 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10
                                ${darkMode === "dark"
                                    ? "bg-[#3a3a3a] text-[#e5e5e5] border border-[#e5e5e530]"
                                    : "bg-[#f9fafb] text-[#4a5568] border border-[#e2e8f0]"
                                }
                            `}
                        >
                            <p>
                                请输入用于访问 Ragflow 的 Token。如果没有 Token，
                                请点击"获取"按钮。
                            </p>
                            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#3a3a3a]"></div>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={handleGetApiKey}
                        className={`
                            absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs rounded z-10
                            bg-[#4d3dc3] text-white hover:bg-[#3d2db3] transition-colors
                        `}
                    >
                        获取
                    </button>
                </div>
            </div>

            {/* Dataset IDs Field */}
            <div className="flex items-center">
                <label
                    className={`
                        ${labelWidth} text-sm font-medium
                        ${darkMode === "dark"
                            ? "text-[#e5e5e5]"
                            : "text-[#4a5568]"
                        }
                    `}
                >
                    Dataset IDs: <span className="text-red-500">*</span>
                </label>
                <div className="flex-1 ml-4 relative group">
                    <Select
                        mode="multiple"
                        allowClear
                        value={config.dataset_ids}
                        onChange={(values) =>
                            onConfigChange("dataset_ids", values)
                        }
                        options={dataSets}
                        placeholder={"请选择数据集名称"}
                        style={{ width: "100%" }}
                        size="middle"
                        status={errors?.dataset_ids ? "error" : undefined}
                    />
                    {errors?.dataset_ids && (
                        <p className="mt-1 text-xs text-red-500">{errors.dataset_ids}</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span
                    className={`
                        text-sm font-medium
                        ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                    `}
                >
                    Knowledge {index + 1}
                </span>
                {canRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className={`
                            p-1 rounded-full hover:bg-gray-100
                            ${darkMode === "dark" ? "hover:bg-gray-500" : ""}
                        `}
                    >
                        <X className="w-4 h-4 text-gray-500 hover:text-white" />
                    </button>
                )}
            </div>
            {showLabel ? renderContent("w-24") : renderContent("w-20")}
        </div>
    );
};

export default KnowledgeConfigurationForm;
