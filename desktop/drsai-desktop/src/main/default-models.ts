const DEFAULT_MODELS: Array<{
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}> = [
  {
    name: "HEPAI Claude Sonnet 4.6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    baseUrl: "https://aiapi.ihep.ac.cn/apiv2/anthropic",
  },
  {
    name: "HEPAI MiniMax M2.7 Highspeed",
    provider: "anthropic",
    model: "minimax-m2.7-highspeed",
    baseUrl: "https://aiapi.ihep.ac.cn/apiv2/anthropic",
  },
  {
    name: "HEPAI DeepSeek V4 Flash",
    provider: "openai",
    model: "hepai/deepseek-v4-flash",
    baseUrl: "https://aiapi.ihep.ac.cn/apiv2",
  },
];

export default DEFAULT_MODELS;
