import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type {
  MyDrSaiModelDoctorResult,
  MyDrSaiProviderDeletePreflight,
  MyDrSaiProviderPreset,
  MyDrSaiProviderModelConfig,
  RuntimeModelOperation,
} from "@shared/desktopApi";

export type SettingsPaneId = "general" | "voice" | "agent-defaults" | "model-providers" | "perceptors" | "executors" | "memories" | "agent-task" | "approvals" | "analytics" | "integrations" | "codex" | "remote-workspace" | "channels" | "archived-sessions" | "other";
type WireApi = "openai" | "anthropic" | "gemini";
type KeySource = "secure" | "env" | "none";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface ModelSettingsDraftController {
  activePane: SettingsPaneId;
  setActivePane: Setter<SettingsPaneId>;
  modelDraft: string;
  setModelDraft: Setter<string>;
  providerDraft: string;
  setProviderDraft: Setter<string>;
  baseUrlDraft: string;
  setBaseUrlDraft: Setter<string>;
  anthropicBaseUrlDraft: string;
  setAnthropicBaseUrlDraft: Setter<string>;
  geminiBaseUrlDraft: string;
  setGeminiBaseUrlDraft: Setter<string>;
  apiKeyDraft: string;
  setApiKeyDraft: Setter<string>;
  apiKeyEnvDraft: string;
  setApiKeyEnvDraft: Setter<string>;
  wireApiDraft: WireApi;
  setWireApiDraft: Setter<WireApi>;
  keySourceDraft: KeySource;
  setKeySourceDraft: Setter<KeySource>;
  modelConfigBusy: boolean;
  setModelConfigBusy: Setter<boolean>;
  modelConfigMessage: string | null;
  setModelConfigMessage: Setter<string | null>;
  modelTestOutput: string | null;
  setModelTestOutput: Setter<string | null>;
  modelConfigConflict: boolean;
  setModelConfigConflict: Setter<boolean>;
  providerPendingDeletion: string | null;
  setProviderPendingDeletion: Setter<string | null>;
  providerDeletePreflight: MyDrSaiProviderDeletePreflight | null;
  setProviderDeletePreflight: Setter<MyDrSaiProviderDeletePreflight | null>;
  modelTestConfirmationOpen: boolean;
  setModelTestConfirmationOpen: Setter<boolean>;
  modelDoctorResult: MyDrSaiModelDoctorResult | null;
  setModelDoctorResult: Setter<MyDrSaiModelDoctorResult | null>;
  modelProviderPresets: MyDrSaiProviderPreset[];
  setModelProviderPresets: Setter<MyDrSaiProviderPreset[]>;
  activeModelProviderTab: string;
  setActiveModelProviderTab: Setter<string>;
  recentOverflowModelProviderTab: string | null;
  setRecentOverflowModelProviderTab: Setter<string | null>;
  discoveredModels: string[];
  setDiscoveredModels: Setter<string[]>;
  providerModelsDraft: string[];
  setProviderModelsDraft: Setter<string[]>;
  providerModelAliasesDraft: Record<string, string>;
  setProviderModelAliasesDraft: Setter<Record<string, string>>;
  providerModelOperationsDraft: Record<string, RuntimeModelOperation[]>;
  setProviderModelOperationsDraft: Setter<Record<string, RuntimeModelOperation[]>>;
  providerModelConfigsDraft: Record<string, MyDrSaiProviderModelConfig>;
  setProviderModelConfigsDraft: Setter<Record<string, MyDrSaiProviderModelConfig>>;
  newProviderModelDraft: string | null;
  setNewProviderModelDraft: Setter<string | null>;
}

interface ModelSettingsContainerProps {
  initialProvider?: string;
  requestedPane?: SettingsPaneId | null;
  children: (controller: ModelSettingsDraftController) => ReactNode;
}

/** Model/provider edits live here so navigation and task orchestration never
 * observe half-written credentials, endpoints, aliases, or capability drafts. */
export function ModelSettingsContainer({ children, initialProvider, requestedPane }: ModelSettingsContainerProps): React.JSX.Element {
  const provider = initialProvider || "hepai";
  const [activePane, setActivePane] = useState<SettingsPaneId>("general");
  const [modelDraft, setModelDraft] = useState("");
  const [providerDraft, setProviderDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [anthropicBaseUrlDraft, setAnthropicBaseUrlDraft] = useState("");
  const [geminiBaseUrlDraft, setGeminiBaseUrlDraft] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyEnvDraft, setApiKeyEnvDraft] = useState("");
  const [wireApiDraft, setWireApiDraft] = useState<WireApi>("openai");
  const [keySourceDraft, setKeySourceDraft] = useState<KeySource>("secure");
  const [modelConfigBusy, setModelConfigBusy] = useState(false);
  const [modelConfigMessage, setModelConfigMessage] = useState<string | null>(null);
  const [modelTestOutput, setModelTestOutput] = useState<string | null>(null);
  const [modelConfigConflict, setModelConfigConflict] = useState(false);
  const [providerPendingDeletion, setProviderPendingDeletion] = useState<string | null>(null);
  const [providerDeletePreflight, setProviderDeletePreflight] = useState<MyDrSaiProviderDeletePreflight | null>(null);
  const [modelTestConfirmationOpen, setModelTestConfirmationOpen] = useState(false);
  const [modelDoctorResult, setModelDoctorResult] = useState<MyDrSaiModelDoctorResult | null>(null);
  const [modelProviderPresets, setModelProviderPresets] = useState<MyDrSaiProviderPreset[]>([]);
  const [activeModelProviderTab, setActiveModelProviderTab] = useState(provider);
  const [recentOverflowModelProviderTab, setRecentOverflowModelProviderTab] = useState<string | null>(
    ["hepai", "deepseek", "openai", "anthropic"].includes(provider) ? null : provider,
  );
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [providerModelsDraft, setProviderModelsDraft] = useState<string[]>([]);
  const [providerModelAliasesDraft, setProviderModelAliasesDraft] = useState<Record<string, string>>({});
  const [providerModelOperationsDraft, setProviderModelOperationsDraft] = useState<Record<string, RuntimeModelOperation[]>>({});
  const [providerModelConfigsDraft, setProviderModelConfigsDraft] = useState<Record<string, MyDrSaiProviderModelConfig>>({});
  const [newProviderModelDraft, setNewProviderModelDraft] = useState<string | null>(null);

  useEffect(() => { if (requestedPane) setActivePane(requestedPane); }, [requestedPane]);

  return <>{children({
    activePane, setActivePane,
    modelDraft, setModelDraft, providerDraft, setProviderDraft, baseUrlDraft, setBaseUrlDraft,
    anthropicBaseUrlDraft, setAnthropicBaseUrlDraft, geminiBaseUrlDraft, setGeminiBaseUrlDraft,
    apiKeyDraft, setApiKeyDraft, apiKeyEnvDraft, setApiKeyEnvDraft,
    wireApiDraft, setWireApiDraft, keySourceDraft, setKeySourceDraft,
    modelConfigBusy, setModelConfigBusy, modelConfigMessage, setModelConfigMessage,
    modelTestOutput, setModelTestOutput, modelConfigConflict, setModelConfigConflict,
    providerPendingDeletion, setProviderPendingDeletion, providerDeletePreflight, setProviderDeletePreflight,
    modelTestConfirmationOpen, setModelTestConfirmationOpen,
    modelDoctorResult, setModelDoctorResult, modelProviderPresets, setModelProviderPresets,
    activeModelProviderTab, setActiveModelProviderTab, recentOverflowModelProviderTab, setRecentOverflowModelProviderTab,
    discoveredModels, setDiscoveredModels, providerModelsDraft, setProviderModelsDraft,
    providerModelAliasesDraft, setProviderModelAliasesDraft,
    providerModelOperationsDraft, setProviderModelOperationsDraft,
    providerModelConfigsDraft, setProviderModelConfigsDraft,
    newProviderModelDraft, setNewProviderModelDraft,
  })}</>;
}
