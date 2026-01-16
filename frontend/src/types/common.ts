export type AgentMode =
    | "besiii"
    | "ddf"
    | "magentic-one"
    | "remote"
    | "custom";

export type AgentType =
    | "default"
    | "add";

export interface Agent {
    id?: string;
    name: string;
    mode?: AgentMode;
    description?: string;
    icon?: React.ReactNode;
    tags?: string[];
    config?: any;
    logo?: string;
    owner?: string;
    url?: string;
    apiKey?: string;
    baseUrl?: string;
    type?: AgentType;
    examples?: string[];
}