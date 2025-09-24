export interface Agent {
    id?: string;
    name: string;
    mode?:
    | "besiii"
    | "ddf"
    | "magentic-one"
    | "remote";
    description?: string;
    icon?: React.ReactNode;
    tags?: string[];
    config?: any;
    logo?: string;
    owner?: string;
    url?: string;
    apiKey?: string;
    baseUrl?: string;
    type:"default"|"add"
}