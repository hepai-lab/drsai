export type AgentMode =
    | "besiii"
    | "ddf"
    | "magentic-one"
    | "remote"
    | "custom";

export type AgentType =
    | "default"
    | "add";

/** Bilingual example: `{ en: "...", zh: "..." }` */
export interface LocalizedExample {
    en?: string;
    zh?: string;
}

/** Plain string or per-locale object in `examples` arrays */
export type AgentExample = string | LocalizedExample;

export interface Agent {
    agent_config?: Record<string, string>;
    defult_config_name?: string;
    id?: string;
    name: string;
    mode?: AgentMode;
    description?: string | LocalizedExample;
    icon?: React.ReactNode;
    tags?: string[];
    config?: any;
    logo?: string;
    owner?: string;
    url?: string;
    api_key?: string;
    baseUrl?: string;
    type?: AgentType;
    examples?: AgentExample[];
    announcements?: (string | LocalizedExample)[];
    is_public?: boolean;
}