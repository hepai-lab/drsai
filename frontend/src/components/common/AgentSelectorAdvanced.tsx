import { Bot, ChevronDown } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { appContext } from "../../hooks/provider";
import { useModeConfigStore } from "../../store/modeConfig";
import { useSettingsStore } from "../store";
import { agentAPI, settingsAPI } from "../views/api";
import CustomAgentForm, { CustomAgentData } from "./agent-form/CustomAgentForm";
import DrsaiAgentForm, { DrsaiAgentData } from "./agent-form/DrsaiAgentForm";
// 导入智能体图标
import magneticOneIcon from "../../assets/magnetic-one.png";
import magneticTwoIcon from "../../assets/magnetic-two.svg";

export interface Agent {
    mode: string;
    name: string;
    type?:
    | "custom"
    | "drsai-besiii"
    | "drsai-agent"
    | "magentic-one"
    | "remote";
    description?: string;
    icon?: React.ReactNode;
    tags?: string[];
    config?: CustomAgentData;
}

interface AgentSelectorAdvancedProps {
    agents: Agent[];
    models: { id: string }[];
    selectedAgent?: Agent;
    onAgentSelect: (agent: Agent) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    searchable?: boolean;
    maxHeight?: string;
}

// 根据智能体模式返回对应的图标
const getAgentIcon = (mode: string) => {
    switch (mode) {
        case "magentic-one":
            return magneticOneIcon;
        case "besiii":
            return magneticTwoIcon;
        default:
            return null; // 使用默认的 Bot 图标
    }
};

const AgentSelectorAdvanced: React.FC<AgentSelectorAdvancedProps> = ({
    agents,
    models,
    selectedAgent,
    onAgentSelect,
    placeholder = "Select Your Agent",
    disabled = false,
    className = "",
    searchable = false,
    maxHeight = "400px",
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [showDrsaiForm, setShowDrsaiForm] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const { darkMode } = React.useContext(appContext);
    const { user } = React.useContext(appContext);
    const {
        mode,
        setMode,
        setConfig,
        selectedAgent: persistedSelectedAgent,
        setSelectedAgent: setPersistedSelectedAgent,
        lastSelectedAgentMode,
        setLastSelectedAgentMode,
    } = useModeConfigStore();

    // 初始化时恢复持久化的智能体选择
    useEffect(() => {
        const initializeAgentSelection = async () => {
            // 如果有持久化的智能体选择，优先使用
            if (persistedSelectedAgent && agents.length > 0) {
                // 检查持久化的智能体是否仍然在可用列表中
                const isStillAvailable = agents.some(
                    (agent) => agent.mode === persistedSelectedAgent.mode
                );

                if (isStillAvailable) {
                    // 恢复智能体配置
                    try {
                        const agentConfig = await agentAPI.getAgentConfig(
                            user?.email || "",
                            persistedSelectedAgent.mode
                        );

                        if (agentConfig) {
                            setConfig(agentConfig.config);
                            setMode(agentConfig.mode);
                        }

                        // 通知父组件
                        onAgentSelect(persistedSelectedAgent);
                    } catch (error) {
                        console.warn("Failed to restore agent config:", error);
                        // 即使配置恢复失败，也要恢复选中的智能体
                        onAgentSelect(persistedSelectedAgent);
                    }
                }
            }
            // 如果没有持久化的智能体，但有 lastSelectedAgentMode，尝试恢复
            else if (lastSelectedAgentMode && agents.length > 0) {
                // 尝试从可用智能体列表中找到之前选中的智能体
                const previouslySelectedAgent = agents.find(
                    (agent) => agent.mode === lastSelectedAgentMode
                );

                if (previouslySelectedAgent) {
                    // 恢复智能体配置
                    try {
                        const agentConfig = await agentAPI.getAgentConfig(
                            user?.email || "",
                            lastSelectedAgentMode
                        );

                        if (agentConfig) {
                            setConfig(agentConfig.config);
                            setMode(agentConfig.mode);
                            setPersistedSelectedAgent(previouslySelectedAgent);
                            onAgentSelect(previouslySelectedAgent);
                        }
                    } catch (error) {
                        console.warn("Failed to restore agent config:", error);
                        // 即使配置恢复失败，也要恢复选中的智能体
                        setPersistedSelectedAgent(previouslySelectedAgent);
                        onAgentSelect(previouslySelectedAgent);
                    }
                }
            }
            // 如果没有任何持久化的智能体选择，设置默认agent为BESIII
            else if (agents.length > 0 && user?.email) {
                const besiiiAgent = agents.find(agent => agent.mode === "magentic-one");
                if (besiiiAgent) {
                    // 设置默认agent为BESIII
                    try {
                        const agentConfig = await agentAPI.getAgentConfig(
                            user.email,
                            "magentic-one"
                        );

                        if (agentConfig) {
                            setConfig(agentConfig.config);
                            setMode("magentic-one");
                            setPersistedSelectedAgent(besiiiAgent);
                            setLastSelectedAgentMode("magentic-one");
                            onAgentSelect(besiiiAgent);
                        }
                    } catch (error) {
                        console.warn("Failed to load BESIII agent config:", error);
                        // 即使配置加载失败，也要设置选中的智能体
                        setMode("magentic-one");
                        setPersistedSelectedAgent(besiiiAgent);
                        setLastSelectedAgentMode("magentic-one");
                        onAgentSelect(besiiiAgent);
                    }
                }
            }
        };

        initializeAgentSelection();
    }, [
        agents,
        persistedSelectedAgent,
        lastSelectedAgentMode,
        user?.email,
        setConfig,
        setMode,
        setPersistedSelectedAgent,
        onAgentSelect,
    ]);

    // Filter agents based on search term
    const filteredAgents = useMemo(() => {
        if (!searchable || !searchTerm.trim()) {
            return agents;
        }

        const term = searchTerm.toLowerCase();
        return agents.filter(
            (agent) =>
                agent.name.toLowerCase().includes(term) ||
                agent.description?.toLowerCase().includes(term) ||
                agent.tags?.some((tag) => tag.toLowerCase().includes(term))
        );
    }, [agents, searchTerm, searchable]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
                setSearchTerm("");
                setFocusedIndex(-1);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // Handle keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isOpen) return;

            switch (event.key) {
                case "Escape":
                    setIsOpen(false);
                    setSearchTerm("");
                    setFocusedIndex(-1);
                    break;
                case "ArrowDown":
                    event.preventDefault();
                    setFocusedIndex((prev) =>
                        prev < filteredAgents.length - 1 ? prev + 1 : 0
                    );
                    break;
                case "ArrowUp":
                    event.preventDefault();
                    setFocusedIndex((prev) =>
                        prev > 0 ? prev - 1 : filteredAgents.length - 1
                    );
                    break;
                case "Enter":
                    event.preventDefault();
                    if (focusedIndex >= 0 && filteredAgents[focusedIndex]) {
                        handleAgentSelect(filteredAgents[focusedIndex]);
                    }
                    break;
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };


    }, [isOpen, filteredAgents, focusedIndex]);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && searchable && searchInputRef.current) {
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 100);
        }
    }, [isOpen, searchable]);

    const handleAgentSelect = async (agent: Agent) => {
        // 创建新的自定义智能体
        const newCustomAgent: Agent = {
            mode: agent.mode,
            name: agent.name,
            config: {},
            user_id: user?.email || "",
        };

        try {
            const res = await agentAPI.saveAgentConfig(newCustomAgent);
            const res2 = await agentAPI.getAgentConfig("", agent.mode);
            if (res2) {
                setConfig(res2.config);
                setMode(res2.mode);
            }

            // 持久化选中的智能体
            setPersistedSelectedAgent(agent);
            setLastSelectedAgentMode(agent.mode);

            onAgentSelect(newCustomAgent);
            setIsOpen(false);
        } catch (error) {
            // 即使保存失败，也要更新本地状态
            setPersistedSelectedAgent(agent);
            setLastSelectedAgentMode(agent.mode);
            onAgentSelect(newCustomAgent);
            setIsOpen(false);
        }
    };

    const handleCustomFormSubmit = async (data: CustomAgentData) => {
        // 创建新的自定义智能体
        const newCustomAgent: Agent = {
            mode: `custom`,
            name: data.name || "Custom Agent",
            config: data,
            user_id: user?.email || "",
        };
        const modelConfigYaml = `model_config: &client
  provider: ${data.llmProvider || "OpenAIChatCompletionClient"}
  config:
    model: ${data.llmModel}
    api_key: ${data.apiKey || "{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}"}
    base_url: ${data.baseUrl || "https://api.openai.com/v1"}
    max_retries: 5

orchestrator_client: *client
coder_client: *client
web_surfer_client: *client
file_surfer_client: *client
action_guard_client: *client

# Custom agent configuration
custom_agent_config:
  name: ${data.name || "Custom Agent"}
  type: "custom"
  tools: ${JSON.stringify(data.toolConfigs)}
  knowledge: ${JSON.stringify(data.knowledge)}
`;

        try {
            const res = await agentAPI.saveAgentConfig(newCustomAgent);

            // 更新 settings store
            const currentSettings = useSettingsStore.getState().config;
            const sessionSettingsConfig = {
                ...currentSettings,
                model_configs: modelConfigYaml,
            };
            useSettingsStore.getState().updateConfig(sessionSettingsConfig);

            if (user?.email) {
                try {
                    await settingsAPI.updateSettings(
                        user.email,
                        sessionSettingsConfig
                    );
                    console.log("Custom agent configuration saved to database");
                } catch (error) {
                    console.error(
                        "Failed to save custom agent configuration:",
                        error
                    );
                }
            }

            // 持久化选中的智能体
            setPersistedSelectedAgent(newCustomAgent);
            setLastSelectedAgentMode(newCustomAgent.mode);

            onAgentSelect(newCustomAgent);
            setShowCustomForm(false);
        } catch (error) {
            console.error("Failed to save custom agent:", error);
            // 即使保存失败，也要更新本地状态
            setPersistedSelectedAgent(newCustomAgent);
            setLastSelectedAgentMode(newCustomAgent.mode);
            onAgentSelect(newCustomAgent);
            setShowCustomForm(false);
        }
    };

    const handleCustomFormCancel = () => {
        setShowCustomForm(false);
    };

    const handleDrsaiFormSubmit = async (data: DrsaiAgentData) => {
        // 创建新的 Drsai 智能体
        const newDrsaiAgent: Agent = {
            mode: `drsai-${Date.now()}`,
            name: data.name || "Dr.Sai Agent",
            type: "drsai-agent",
            description: `Planer: ${data.planer.llmModel}, Coder: ${data.coder.llmModel}, Tester: ${data.tester.type}`,
        };

        // 持久化选中的智能体
        setPersistedSelectedAgent(newDrsaiAgent);
        setLastSelectedAgentMode(newDrsaiAgent.mode);

        onAgentSelect(newDrsaiAgent);
        setShowDrsaiForm(false);
    };

    const handleDrsaiFormCancel = () => {
        setShowDrsaiForm(false);
    };

    const toggleDropdown = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
            if (!isOpen) {
                setSearchTerm("");
                setFocusedIndex(-1);
            }
        }
    };

    // 使用持久化的选中智能体或传入的 selectedAgent
    const currentSelectedAgent = selectedAgent || persistedSelectedAgent;

    return (
        <>
            <div ref={dropdownRef} className={`relative ${className}`}>
                {/* Dropdown Button */}
                <button
                    type="button"
                    onClick={toggleDropdown}
                    disabled={disabled}
                    className={`
           flex items-center justify-between mx-2 px-2 py-2 rounded-xl
          transition-all duration-200 ease-in-out
          ${darkMode === "dark"
                            ? "text-[#e5e5e5] hover:bg-[#444444]"
                            : "text-[#4a5568] hover:bg-[#f5f5f5]"
                        }
          ${disabled
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer"
                        }
        `}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                >
                    <div className="flex items-center gap-3 ">

                        <span className="text-xl font-medium ">
                            {currentSelectedAgent
                                ? currentSelectedAgent.name
                                : placeholder}
                        </span>
                    </div>
                    <ChevronDown
                        className={`w-5 h-5 text-secondary/70 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div
                        className={`
            absolute top-full left-3 w-[340px] mt-1 z-[9999] rounded-2xl shadow-lg
            border transition-all duration-200 ease-in-out
            ${darkMode === "dark"
                                ? "bg-[#3a3a3a] border-[#e5e5e530] shadow-black/20"
                                : "bg-white border-[#e2e8f0] shadow-gray-200/50"
                            }
          `}
                        style={{
                            maxHeight,
                            overflowY: "auto",
                        }}
                    >
                        {filteredAgents.length === 0 && (
                            <div
                                className={`
              px-4 py-6 text-sm text-center
              ${darkMode === "dark" ? "text-[#e5e5e58f]" : "text-[#4a5568]"}
            `}
                            >
                                {searchTerm
                                    ? "No agents found matching your search"
                                    : "No agents available"}
                            </div>
                        )}

                        {/* Agent Options */}
                        {filteredAgents.length > 0 && (
                            <div className="p-2">
                                {filteredAgents.map((agent, index) => {
                                    const isFocused = index === focusedIndex;
                                    const isSelected =
                                        currentSelectedAgent?.mode ===
                                        agent.mode;

                                    return (
                                        <button
                                            key={agent.mode}
                                            type="button"
                                            onClick={() =>
                                                handleAgentSelect(agent)
                                            }
                                            className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-xl
                      text-sm transition-colors duration-150
                      ${isSelected
                                                    ? darkMode === "dark"
                                                        ? "bg-[#4d3dc3] text-white hover:bg-[#4d3dc3]"
                                                        : "bg-[#e7e5f2] text-[#4d3dc3] hover:bg-[#e7e5f2]"
                                                    : darkMode === "dark"
                                                        ? "text-[#e5e5e5] hover:bg-[#444444]"
                                                        : "text-[#4a5568] hover:bg-[#f9fafb]"
                                                }
                      ${isFocused && !isSelected
                                                    ? darkMode === "dark"
                                                        ? "bg-[#444444]"
                                                        : "bg-[#f9fafb]"
                                                    : ""
                                                }
                    `}
                                        >
                                            {(() => {
                                                const agentIcon = getAgentIcon(agent.mode);
                                                if (agentIcon) {
                                                    return (
                                                        <img
                                                            src={agentIcon}
                                                            alt={agent.name}
                                                            className="w-6 h-6 transition-colors duration-200"
                                                            style={{
                                                                borderRadius: "4px",
                                                                padding: "2px",
                                                                // 为 magnetic-one 图标应用黑色滤镜
                                                                filter: agent.mode === "magentic-one" ?
                                                                    "brightness(0) saturate(100%)" :
                                                                    "none"
                                                            }}
                                                        />
                                                    );
                                                } else {
                                                    // 使用默认的 Bot 图标
                                                    return isSelected ? (
                                                        <Bot
                                                            className="w-6 h-6 transition-colors duration-200 text-white"
                                                            style={{
                                                                borderRadius: "4px",
                                                                padding: "2px",
                                                            }}
                                                        />
                                                    ) : (
                                                        <Bot
                                                            className="w-6 h-6 transition-colors duration-200 text-[var(--color-magenta-800)]"
                                                            style={{
                                                                borderRadius: "4px",
                                                                padding: "2px",
                                                            }}
                                                        />
                                                    );
                                                }
                                            })()}
                                            <div className="flex-1 text-left">
                                                <div className="truncate">
                                                    {agent.name}
                                                </div>
                                                {agent.description && (
                                                    <div
                                                        className={`
                          text-xs truncate mt-1
                          ${darkMode === "dark"
                                                                ? "text-[#e5e5e58f]"
                                                                : "text-[#4a5568]"
                                                            }
                        `}
                                                    >
                                                        {agent.description}
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Custom Agent Form Modal */}
            {showCustomForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-2xl">
                        <div className="min-h-0">
                            <CustomAgentForm
                                models={models}
                                onSubmit={handleCustomFormSubmit}
                                onCancel={handleCustomFormCancel}
                            />
                        </div>
                    </div>
                </div>
            )}
            {/* Drsai Agent Form Modal */}
            {showDrsaiForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-2xl">
                        <div className="min-h-0">
                            <DrsaiAgentForm
                                models={models}
                                onSubmit={handleDrsaiFormSubmit}
                                onCancel={handleDrsaiFormCancel}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AgentSelectorAdvanced;
