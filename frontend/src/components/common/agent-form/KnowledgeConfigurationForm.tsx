import React from "react";
import { Info, ExternalLink } from "lucide-react";

export interface KnowledgeConfig {
    apiKey: string;
    dataSetName: string;
}

interface KnowledgeConfigurationFormProps {
    config: KnowledgeConfig;
    onConfigChange: (field: keyof KnowledgeConfig, value: string) => void;
    darkMode?: string;
    showLabel?: boolean;
}

const KnowledgeConfigurationForm: React.FC<KnowledgeConfigurationFormProps> = ({
    config,
    onConfigChange,
    darkMode = "light",
    showLabel = true,
}) => {
    const handleGetApiKey = () => {
        // 默认URL，可以根据实际需求修改
        const defaultUrl = "https://aiweb01.ihep.ac.cn:886/user-setting/api";
        window.open(defaultUrl, "_blank");
    };

    const [dataSets, setDataSets] = React.useState<
        { label: string; value: string }[]
    >([]);

    const fetchDataSets = async () => {
        // 模拟异步获取数据集列表
        const response = await fetch(
            "https://aiweb01.ihep.ac.cn:886/api/v1/datasets",
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.apiKey}`,
                },
            }
        );
        const data = await response.json();

        setDataSets(
            data.data.map((item: any) => ({
                label: item.name,
                value: item.name,
            }))
        );
    };
    React.useEffect(() => {
        if (config.apiKey) {
            fetchDataSets();
        }
    }, [config.apiKey]);

    return (
        <div className="space-y-4">
            {/* Knowledge Label */}
            {showLabel && (
                <div className="flex items-center">
                    <label
                        className={`
                            w-20 text-sm font-medium
                            ${darkMode === "dark"
                                ? "text-[#e5e5e5]"
                                : "text-[#4a5568]"
                            }
                        `}
                    >
                        Knowledge:
                    </label>
                    <div
                        className={`flex-1 ml-4 space-y-4 w-full items-center justify-between px-3 py-2 rounded-md
                            border transition-all duration-200  ${darkMode === "dark"
                                ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                            }  `}
                    >
                        {/* API Key Field */}
                        <div className="flex items-center">
                            <label
                                className={`
                                    w-20 text-sm font-medium
                                    ${darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                    }
                                `}
                            >
                                API Key:
                            </label>
                            <div className="flex-1 ml-4 relative group">
                                <input
                                    type="password"
                                    value={config.apiKey}
                                    onChange={(e) =>
                                        onConfigChange("apiKey", e.target.value)
                                    }
                                    placeholder="请输入API Key"
                                    className={`
                                        w-full px-3 py-2 rounded-md border
                                        ${darkMode === "dark"
                                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                        }   
                                        focus:outline-none focus:border-[#4d3dc3]
                                    `}
                                />
                                <button
                                    type="button"
                                    className={`
                                        absolute right-12 top-1/2 transform -translate-y-1/2 p-1
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
                                            请输入您的API
                                            Key以访问知识库服务。如果没有API
                                            Key，请点击"获取"按钮。
                                        </p>
                                        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#3a3a3a]"></div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleGetApiKey}
                                    className={`
                                        absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs rounded
                                        bg-[#4d3dc3] text-white hover:bg-[#3d2db3] transition-colors
                                    `}
                                >
                                    获取
                                </button>
                            </div>
                        </div>

                        {/* DataSet Name Field */}
                        <div className="flex items-center">
                            <label
                                className={`
                                    w-20 text-sm font-medium
                                    ${darkMode === "dark"
                                        ? "text-[#e5e5e5]"
                                        : "text-[#4a5568]"
                                    }
                                `}
                            >
                                DataSet Name:
                            </label>
                            <div className="flex-1 ml-4 relative group">
                                <select
                                    value={config.dataSetName}
                                    onChange={(e) =>
                                        onConfigChange(
                                            "dataSetName",
                                            e.target.value
                                        )
                                    }
                                    className={`
                                        w-full px-3 py-2 rounded-md border
                                        ${darkMode === "dark"
                                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                        }
                                        focus:outline-none focus:border-[#4d3dc3]
                                    `}
                                >
                                    <option value="">请选择数据集名称</option>
                                    {dataSets.map((dataset, index) => (
                                        <option
                                            key={index}
                                            value={dataset.value}
                                        >
                                            {dataset.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {!showLabel && (
                <div
                    className={`space-y-4 w-full items-center justify-between px-3 py-2 rounded-md
                        border transition-all duration-200  ${darkMode === "dark"
                            ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                            : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                        }  `}
                >
                    {/* API Key Field */}
                    <div className="flex items-center">
                        <label
                            className={`
                                w-20 text-sm font-medium
                                ${darkMode === "dark"
                                    ? "text-[#e5e5e5]"
                                    : "text-[#4a5568]"
                                }
                            `}
                        >
                            API Key:
                        </label>
                        <div className="flex-1 ml-4 relative group">
                            <input
                                type="password"
                                value={config.apiKey}
                                onChange={(e) =>
                                    onConfigChange("apiKey", e.target.value)
                                }
                                placeholder="请输入API Key"
                                className={`
                                    w-full px-3 py-2 rounded-md border
                                    ${darkMode === "dark"
                                        ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                        : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                    }   
                                    focus:outline-none focus:border-[#4d3dc3]
                                `}
                            />
                            <button
                                type="button"
                                className={`
                                    absolute right-12 top-1/2 transform -translate-y-1/2 p-1
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
                                        请输入您的API
                                        Key以访问知识库服务。如果没有API
                                        Key，请点击"获取"按钮。
                                    </p>
                                    <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#3a3a3a]"></div>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={handleGetApiKey}
                                className={`
                                    absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs rounded
                                    bg-[#4d3dc3] text-white hover:bg-[#3d2db3] transition-colors
                                `}
                            >
                                获取
                            </button>
                        </div>
                    </div>

                    {/* DataSet Name Field */}
                    <div className="flex items-center">
                        <label
                            className={`
                                w-20 text-sm font-medium
                                ${darkMode === "dark"
                                    ? "text-[#e5e5e5]"
                                    : "text-[#4a5568]"
                                }
                            `}
                        >
                            DataSet Name:
                        </label>
                        <div className="flex-1 ml-4 relative group">
                            <select
                                value={config.dataSetName}
                                onChange={(e) =>
                                    onConfigChange(
                                        "dataSetName",
                                        e.target.value
                                    )
                                }
                                className={`
                                    w-full px-3 py-2 rounded-md border
                                    ${darkMode === "dark"
                                        ? "bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400"
                                        : "bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400"
                                    }
                                    focus:outline-none focus:border-[#4d3dc3]
                                `}
                            >
                                <option value="">请选择数据集名称</option>
                                {dataSets.map((dataset, index) => (
                                    <option key={index} value={dataset.value}>
                                        {dataset.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KnowledgeConfigurationForm;
