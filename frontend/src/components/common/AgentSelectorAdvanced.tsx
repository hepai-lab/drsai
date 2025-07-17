import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Bot, Search, X } from "lucide-react";
import { appContext } from "../../hooks/provider";
import CustomAgentForm, { CustomAgentData } from "./agent-form/CustomAgentForm";
import { agentAPI } from "../views/api";

export interface Agent {
    mode: string;
    name: string;
    type: "custom" | "drsai-besiii" | "drsai-agent" | "magentic-one" | "remote";
    description?: string;
    icon?: React.ReactNode;
    tags?: string[];
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

const AgentSelectorAdvanced: React.FC<AgentSelectorAdvancedProps> = ({
    agents,
    models,
    selectedAgent,
    onAgentSelect,
    placeholder = "Select Your Agent",
    disabled = false,
    className = "",
    searchable = true,
    maxHeight = "300px",
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [showCustomForm, setShowCustomForm] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const { darkMode } = React.useContext(appContext);
    const { user } = React.useContext(appContext);

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

    const handleAgentSelect = (agent: Agent) => {
        // 如果选择的是Custom Agent，显示配置表单
        if (agent.name === "Custom Agent") {
            setShowCustomForm(true);
            onAgentSelect(agent);
            setIsOpen(false);
            setSearchTerm("");
            setFocusedIndex(-1);
        } else {
            onAgentSelect(agent);
            setIsOpen(false);
            setSearchTerm("");
            setFocusedIndex(-1);
        }
    };

    const handleCustomFormSubmit = async (data: CustomAgentData) => {
        // 创建新的自定义智能体
        const newCustomAgent: Agent = {
            mode: `custom-${Date.now()}`,
            name: data.name || "Custom Agent",
            type: "custom",
            description: `LLM: ${data.llmModel}, Tools: ${data.toolConfigs.length} config(s)`,
        };


        const res = await agentAPI.saveAgentConfig(user?.email || "", newCustomAgent);
        onAgentSelect(newCustomAgent);
        setShowCustomForm(false);
    };

    const handleCustomFormCancel = () => {
        setShowCustomForm(false);
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

    const clearSearch = () => {
        setSearchTerm("");
        setFocusedIndex(-1);
        searchInputRef.current?.focus();
    };

    // Robot icon component
    const RobotIcon = () => (
        <Bot
            className="w-4 h-4"
            style={{ color: "var(--color-magenta-800)" }}
        />
    );

    return (
        <>
            <div ref={dropdownRef} className={`relative ${className}`}>
                {/* Dropdown Button */}
                <button
                    type="button"
                    onClick={toggleDropdown}
                    disabled={disabled}
                    className={`
          w-full flex items-center justify-between px-4 py-3 rounded-lg
          transition-all duration-200 ease-in-out
          ${darkMode === "dark"
                            ? "bg-[#3a3a3a] text-[#e5e5e5] border border-[#e5e5e530] hover:border-[#e5e5e560]"
                            : "bg-white text-[#4a5568] border border-[#e2e8f0] hover:border-[#4d3dc3]"
                        }
          ${disabled
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer hover:shadow-md"
                        }
        `}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                >
                    <div className="flex items-center gap-3">
                        {selectedAgent && <RobotIcon />}
                        <span className="text-sm font-medium">
                            {selectedAgent ? selectedAgent.name : placeholder}
                        </span>
                    </div>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div
                        className={`
            absolute top-full left-0 right-0 mt-1 z-50 rounded-lg shadow-lg
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
                        {/* Search Input */}
                        {searchable && (
                            <div className="p-3 border-b border-secondary">
                                <div
                                    className={`
                relative flex items-center
                ${darkMode === "dark"
                                            ? "bg-[#444444] border-[#e5e5e530]"
                                            : "bg-[#f9fafb] border-[#e2e8f0]"
                                        }
                border rounded-md px-3 py-2
              `}
                                >
                                    <Search className="w-4 h-4 text-secondary mr-2" />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) =>
                                            setSearchTerm(e.target.value)
                                        }
                                        placeholder="Search agents..."
                                        className={`
                    flex-1 bg-transparent outline-none text-sm
                    ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#4a5568]"}
                    placeholder:text-secondary
                  `}
                                    />
                                    {searchTerm && (
                                        <button
                                            onClick={clearSearch}
                                            className="ml-2 p-1 hover:bg-secondary rounded"
                                        >
                                            <X className="w-3 h-3 text-secondary" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* No results message */}
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
                                        selectedAgent?.mode === agent.mode;

                                    return (
                                        <button
                                            key={agent.mode}
                                            type="button"
                                            onClick={() =>
                                                handleAgentSelect(agent)
                                            }
                                            className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-md
                      text-sm transition-colors duration-150
                      ${darkMode === "dark"
                                                    ? "text-[#e5e5e5] hover:bg-[#444444]"
                                                    : "text-[#4a5568] hover:bg-[#f9fafb]"
                                                }
                      ${isSelected
                                                    ? darkMode === "dark"
                                                        ? "bg-[#4d3dc3] text-white"
                                                        : "bg-[#e7e5f2] text-[#4d3dc3]"
                                                    : ""
                                                }
                      ${isFocused && !isSelected
                                                    ? darkMode === "dark"
                                                        ? "bg-[#444444]"
                                                        : "bg-[#f9fafb]"
                                                    : ""
                                                }
                    `}
                                        >
                                            <RobotIcon />
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
        </>
    );
};

export default AgentSelectorAdvanced;
