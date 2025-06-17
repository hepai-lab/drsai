import { create } from "zustand";

export interface GeneralConfig {
  cooperative_planning: boolean;
  autonomous_execution: boolean;
  allowed_websites?: string[];
  max_actions_per_step: number;
  multiple_tools_per_call: boolean;
  max_turns: number;
  plan?: {
    task: string;
    steps: any[];
    plan_summary: string;
  };
  approval_policy: "always" | "never" | "auto-conservative" | "auto-permissive";
  allow_for_replans: boolean;
  do_bing_search: boolean;
  websurfer_loop: boolean;
  model_configs?: string;
  retrieve_relevant_plans: "never" | "hint" | "reuse"; // this is for using task centric memory to retrieve relevant plans
}

const defaultConfig: GeneralConfig = {
  cooperative_planning: true,
  autonomous_execution: false,
  allowed_websites: [],
  max_actions_per_step: 5,
  multiple_tools_per_call: false,
  max_turns: 20,
  approval_policy: "auto-conservative",
  allow_for_replans: true,
  do_bing_search: false,
  websurfer_loop: false,
//   model_configs: `model_config: &client
//   provider: OpenAIChatCompletionClient
//   config:
//     model: gpt-4.1-2025-04-14
//   max_retries: 5
// model_config_action_guard: &client_action_guard
//   provider: OpenAIChatCompletionClient
//   config:
//     model: gpt-4.1-nano-2025-04-14
//   max_retries: 5

// orchestrator_client: *client
// coder_client: *client
// web_surfer_client: *client
// file_surfer_client: *client
// action_guard_client: *client_action_guard`,
  model_configs: `model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: "deepseek-ai/deepseek-v3:671b"
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    api_key: "{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}"
    max_retries: 1
   

r1_config: &r1_client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: "deepseek-ai/deepseek-r1:671b"
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    api_key: "{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}"
    max_retries: 1

mode: drsai_besiii

orchestrator_client: *client
web_surfer_client: *client
file_surfer_client: *client
action_guard_client: *client
planner_client: *client
coder_client: *r1_client
tester_client: *r1_client
host_client: *r1_client
parser_client: *client
`,
  retrieve_relevant_plans: "never",
};

interface SettingsState {
  config: GeneralConfig;
  updateConfig: (update: Partial<GeneralConfig>) => void;
  resetToDefaults: () => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  config: defaultConfig,
  updateConfig: (update) =>
    set((state) => ({
      config: { ...state.config, ...update },
    })),
  resetToDefaults: () => set({ config: defaultConfig }),
}));

export function generateOpenAIModelConfig(model: string) {
  return `model_config: &client
  provider: OpenAIChatCompletionClient
  config:
    model: ${model}
  max_retries: 5

orchestrator_client: *client
coder_client: *client
web_surfer_client: *client
file_surfer_client: *client
action_guard_client: *client
`;
}
