from pathlib import Path
p=Path('D:/work/projects/drsai/apps/desktop/shared/renderer/src/components/SettingsPanel.tsx')
s=p.read_text(encoding='utf-8')
s='import { directTokenBudget, replaceDirectModel } from "./providerDirectSetup";\n'+s
s=s.replace('const capabilities = [...new Set([\n      ...(configured.capabilities ?? ["chat"]),\n      ...knownTextModelCapabilities(modelId),\n    ])];','const capabilities = configured.capabilities ?? defaultTextModelCapabilities(modelId);')
s=s.replace('[...new Set([...defaultTextModelCapabilities(modelId), ...operations])]','operations.some((operation) => operation === "image_generation" || operation === "image_edit") ? operations.filter((operation) => operation === "image_generation" || operation === "image_edit") : [...new Set([...defaultTextModelCapabilities(modelId), ...operations])]')
s=s.replace('const [providerModelEditorError,','const [providerModelEditorBaseline, setProviderModelEditorBaseline] = useState("");\n  const providerModelEditorDirty = providerModelEditor !== null && JSON.stringify(providerModelEditor) !== providerModelEditorBaseline;\n  const [providerModelEditorError,')
a=s.index('  function commitProviderModel():'); b=s.index('  function removeProviderModel',a); s=s[:a]+s[b:]
s=s.replace('    setProviderModelEditor({\n      originalId: model,','    const editor: ProviderModelEditorDraft = {\n      originalId: model,')
s=s.replace('tokenLimit: config.token_limit !== undefined ? String(config.token_limit) : "",','tokenLimit: config.token_limit !== undefined && config.max_tokens !== undefined ? String(config.token_limit - config.max_tokens) : "",')
s=s.replace('      origin: config.origin ?? null,\n    });','      origin: config.origin ?? null,\n    };\n    setProviderModelEditor(editor);\n    setProviderModelEditorBaseline(JSON.stringify(editor));')
s=s.replace('tokenLimit: copiedConfig.token_limit !== undefined ? String(copiedConfig.token_limit) : "",','tokenLimit: copiedConfig.token_limit !== undefined && copiedConfig.max_tokens !== undefined ? String(copiedConfig.token_limit - copiedConfig.max_tokens) : "",')
a=s.index('  function saveProviderModelEditor():'); b=s.index('  function toggleProviderModelEditorModality',a)
s=s[:a]+'''  // Build a synchronous snapshot. State setters must never be a save boundary.
  function currentModelSnapshot(): { id: string; models: Record<string, MyDrSaiProviderModelConfig> } {
    const editor = providerModelEditor;
    if (!editor) throw new Error(zh ? "请填写模型 ID。" : "Enter a model ID.");
    const original = providerModelConfigsDraft[editor.originalId];
    if (editor.origin === "product" && original) return { id: editor.originalId, models: { ...modelConfigsForSave(), [editor.originalId]: providerModelConfigForWrite({ ...original, enabled: editor.enabled }) } };
    const budget = directTokenBudget(editor.tokenLimit, editor.maxTokens);
    if (!editor.inputModalities.length || !editor.outputModalities.length) throw new Error(zh ? "请选择输入和输出模态。" : "Select input and output modalities.");
    const image = editor.capabilities.includes("image_generation");
    if (image && (editor.capabilities.some((capability) => ["chat", "tool_calling", "reasoning"].includes(capability)) || !editor.outputModalities.includes("image"))) throw new Error(zh ? "图像生成须输出 image，且不能混用对话能力。" : "Image generation must output images and cannot declare chat capabilities.");
    if (!image && editor.capabilities.includes("chat") && editor.outputModalities.includes("image")) throw new Error(zh ? "输出图像请切换为图像生成类型。" : "Select image generation to output images.");
    const protocolHasHost = editor.apiProtocol === wireApiDraft || (editor.apiProtocol === "anthropic" && anthropicBaseUrlDraft.trim()) || (editor.apiProtocol === "gemini" && geminiBaseUrlDraft.trim());
    if (!protocolHasHost) throw new Error(zh ? "请在高级连接设置中填写所选协议的主机，或更改主连接协议。" : "Set the selected protocol host in advanced connection settings, or change the primary connection protocol.");
    const { alias: _alias, reasoning_efforts: _efforts, ...metadata } = original ?? {};
    const config = providerModelConfigForWrite({ ...metadata,
      ...(editor.alias.trim() ? { alias: editor.alias.trim() } : {}),
      input_modalities: editor.inputModalities, output_modalities: editor.outputModalities,
      api_protocol: editor.apiProtocol, enabled: editor.enabled, capabilities: editor.capabilities, ...budget,
      ...(editor.reasoningEfforts.length && editor.capabilities.includes("reasoning") ? { reasoning_efforts: editor.reasoningEfforts } : {}),
    });
    const id = editor.modelId.trim();
    return { id, models: replaceDirectModel(modelConfigsForSave(), editor.originalId, id, config) };
  }

  function saveProviderModelEditor(): boolean {
    try {
      const snapshot = currentModelSnapshot();
      setProviderModelsDraft(Object.keys(snapshot.models));
      // Preserve read-only origin in local state; it is stripped only at the API boundary.
      setProviderModelConfigsDraft(Object.fromEntries(Object.entries(snapshot.models).map(([id, config]) => [id, { ...config, ...(providerModelConfigsDraft[id]?.origin ? { origin: providerModelConfigsDraft[id].origin } : {}) }])));
      setProviderModelAliasesDraft(Object.fromEntries(Object.entries(snapshot.models).flatMap(([id, config]) => config.alias ? [[id, config.alias]] : [])));
      setProviderModelOperationsDraft(Object.fromEntries(Object.entries(snapshot.models).map(([id, config]) => [id, config.capabilities.filter((capability) => capability === "image_generation" || capability === "image_edit")])));
      setProviderModelEditorError(null);
      return true;
    } catch (error) {
      setProviderModelEditorError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function switchDirectModel(model: string): void {
    if (providerModelEditorDirty && !saveProviderModelEditor()) return;
    setModelDraft(model);
    openProviderModelEditor(model);
  }

  function setDirectModelType(image: boolean): void {
    setProviderModelEditor((current) => current ? { ...current,
      capabilities: image ? ["image_generation"] : ["chat"],
      inputModalities: ["text"], outputModalities: image ? ["image"] : ["text"], reasoningEfforts: [],
    } : current);
  }

'''+s[b:]
s=s.replace('  function duplicateProviderModel(model: string): void {','  function duplicateProviderModel(model: string): void {\n    if (providerModelEditorDirty && !saveProviderModelEditor()) return;')
s=s.replace('    setProviderModelsDraft(nextModels);','    setProviderModelsDraft((current) => [...current, copyId]);')
s=s.replace('    setActiveModelProviderTab("__new-custom-provider__");','    setProviderModelEditor(null);\n    setActiveModelProviderTab("__new-custom-provider__");')
needle='  useEffect(() => {\n    void desktopApi.listMyDrSaiModelProviderPresets()'
s=s.replace(needle,'  useEffect(() => {\n    if (activePane === "model-providers" && !providerModelEditor) openProviderModelEditor(modelDraft);\n  }, [activePane, providerDraft, modelDraft, providerModelEditor]);\n\n'+needle)
s=s.replace('const modelProviderDirty = !selectedProviderConfig','const modelProviderDirty = providerModelEditorDirty || !selectedProviderConfig')
s=s.replace('providerModelOperationsDraft, newProviderModelDraft]);','providerModelOperationsDraft, newProviderModelDraft, providerModelEditor]);')
a=s.index('        setProviderModelsDraft(result.models);'); b=s.index('\n      }',a)
s=s[:a]+'''        setProviderModelsDraft((current) => [...new Set([...current, ...result.models])]);
        setProviderModelConfigsDraft((current) => ({ ...Object.fromEntries(result.models.map((model) => [model, providerModelConfigFor(model, { wire_api: wireApiDraft })])), ...current }));'''+s[b:]
s=s.replace('if (!providerDraft.trim()) return', 'if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerDraft.trim())) return')
a=s.index('    if (requireModels && newProviderModelDraft'); b=s.index('    return null;',a)
s=s[:a]+'''    if (requireModels) {
      try { currentModelSnapshot(); } catch (error) { return error instanceof Error ? error.message : String(error); }
    }
'''+s[b:]
s=s.replace('async function saveModelProvider(): Promise<void> {','async function saveModelProvider(testFirst = false): Promise<void> {\n    if (modelConfigBusy) return;')
s=s.replace('      const usesHepAiAccount = provider === "hepai";\n      const connection', '''      const usesHepAiAccount = provider === "hepai";
      const snapshot = currentModelSnapshot();
      const selected = snapshot.models[snapshot.id];
      if (testFirst) {
        if (!selected.enabled) throw new Error(zh ? "请先启用此模型。" : "Enable this model first.");
        if (!selected.capabilities.includes("chat") || selected.capabilities.includes("image_generation")) throw new Error(zh ? "草稿测试仅支持对话，不支持图像生成。可仅保存（未验证），再在高级管理中进行可能收费的图像能力测试。" : "Draft testing supports chat only. Save without verification, then use the potentially billable image capability probe in advanced management.");
        const protocol = selected.api_protocol;
        const host = protocol === wireApiDraft ? baseUrlDraft.trim() : protocol === "anthropic" ? anthropicBaseUrlDraft.trim() : protocol === "gemini" ? geminiBaseUrlDraft.trim() : "";
        const url = new URL(host);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol API URL");
        const result = await desktopApi.testMyDrSaiModelDraft({
          model: selected.upstream_id || snapshot.id, model_provider: provider, base_url: host,
          ...(!usesHepAiAccount && apiKeyDraft.trim() ? { api_key: apiKeyDraft.trim() } : {}),
          wire_api: protocol, requires_api_key: !usesHepAiAccount && keySourceDraft !== "none",
        }, "model");
        if (!result.ok) { setModelConfigMessage(`${zh ? "模型调用测试失败，未保存" : "Model call failed; not saved"}: ${result.error || "unknown"}`); return; }
        if (result.output) setModelTestOutput(result.output);
      }
      const connection''')
s=s.replace('models: modelConfigsForSave(),','models: snapshot.models,')
s=s.replace('      if (modelDraft && providerModelsDraft.includes(modelDraft)) setModelDraft(modelDraft);','      setModelDraft(snapshot.id);\n      setProviderModelEditor(null);')
a=s.index('      setModelConfigMessage(apiKeyDraft.trim()'); b=s.index('\n    } catch (error)',a)
s=s[:a]+'''      setModelTestConfirmationOpen(false);
      setModelConfigMessage(testFirst
        ? (zh ? "当前模型调用测试通过并已保存；其他模型及工具/多模态能力未经本次测试验证，未切换主模型。" : "Selected model call passed and saved. Other models and tool/multimodal capabilities were not tested; primary model unchanged.")
        : (zh ? "已保存；尚未验证模型调用，未切换主模型。" : "Saved without model-call verification; primary model unchanged."));'''+s[b:]
# generic save failures still explicitly acknowledge no save
start=s.index('  async function saveModelProvider'); end=s.index('  async function reloadModelConnectionAfterConflict',start)
chunk=s[start:end].replace('setModelConfigMessage(message);','setModelConfigMessage(`${zh ? "保存未完成：" : "Save not completed: "}${message}`);')
s=s[:start]+chunk+s[end:]
p.write_text(s,encoding='utf-8')
