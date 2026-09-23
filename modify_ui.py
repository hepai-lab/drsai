from pathlib import Path
p=Path('apps/desktop/shared/renderer/src/components/SettingsPanel.tsx'); s=p.read_text(encoding='utf-8')
s=s.replace('按下方三步填写服务商提供的信息。兼容 OpenAI 的服务通常无需修改高级设置。','直接填写模型信息，然后测试并保存。').replace('Follow the three steps with values from your provider. OpenAI-compatible services usually need no advanced changes.','Enter model details, then test and save.')
for prefix in ['1 · ','2 · ','3 · ']: s=s.replace(prefix,'')
a=s.index('                <div className="model-provider-models-header">'); b=s.index('                {selectedProviderConfig?.user_models_error',a); s=s[:a]+s[b:]
a=s.index('                <div className="model-provider-basic model-provider-grid">',s.index('<datalist id="discovered-model-options"')); b=s.index('                <details className="model-provider-advanced"',a)
s=s[:a]+'''                <div className="model-provider-actions">
                  {providerModelsDraft.length > 0 && <label>{zh ? "编辑模型" : "Edit model"}<select data-testid="model-provider-model-selection" value={providerModelEditor?.originalId ?? ""} onChange={(event) => switchDirectModel(event.target.value)}><option value="">{zh ? "新模型" : "New model"}</option>{providerModelsDraft.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>}
                  {providerModelsDraft.length > 0 && <button type="button" onClick={() => switchDirectModel("")}>{zh ? "新建模型" : "New model"}</button>}
                </div>
                DIRECT_EDITOR
'''+s[b:]
a=s.index('              {providerModelEditor && (() =>'); b=s.index('              {myDrSaiConfig?.modelConnection?.model_provider',a)
editor=s[a:b]; s=s[:a]+s[b:]
editor=editor.replace('const capabilityOptions: MyDrSaiModelCapability[] = ["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"];','const imageModel = providerModelEditor.capabilities.includes("image_generation");\n                const capabilityOptions: MyDrSaiModelCapability[] = imageModel ? ["image_edit"] : ["tool_calling", "reasoning"];')
a=editor.index('                return <div className="model-provider-delete-overlay"'); b=editor.index('                    {productModel',a)
editor=editor[:a]+'''                return <div className="model-provider-direct-editor">
                  <section aria-label={zh ? "模型参数" : "Model parameters"} data-testid="model-provider-model-editor">
'''+editor[b:]
editor=editor.replace('<input autoFocus value={providerModelEditor.modelId}', '<input data-testid="model-provider-model-id" aria-required="true" value={providerModelEditor.modelId}')
needle='                      <label><span>{zh ? "别名"'
a=editor.index(needle)
editor=editor[:a]+'''                      <label><span>{zh ? "模型类型" : "Model type"}</span><select data-testid="model-provider-model-type" disabled={productModel} value={imageModel ? "image" : "chat"} onChange={(event) => setDirectModelType(event.target.value === "image")}><option value="chat">{zh ? "对话模型" : "Chat model"}</option><option value="image">{zh ? "图像生成" : "Image generation"}</option></select></label>
'''+editor[a:]
editor=editor.replace('上下文长度（token）','最大输入预算（token，必填）').replace('Context window (tokens)','Max input budget (tokens, required)').replace('最大输出（token）','最大输出（token，必填）').replace('Max output (tokens)','Max output (tokens, required)')
editor=editor.replace('<input inputMode="numeric"','<input aria-required="true" inputMode="numeric"').replace('placeholder={zh ? "留空使用内置默认值" : "Empty uses the built-in default"}','placeholder={zh ? "必填正整数" : "Required positive integer"}')
editor=editor.replace('1 到 100000000 之间的整数；留空表示沿用模型注册表中的默认值。','预留完整输出预算后的输入额度。保存为共享上下文 = 输入预算 + 最大输出；不是后端独立输入硬上限。').replace('An integer from 1 to 100000000; empty keeps the default from the model registry.','Input budget after reserving full output. Shared context = input budget + max output; not an independent backend input cap.')
editor=editor.replace('不能大于上下文长度；留空同样沿用内置默认值。','输入与输出合计不得超过 100000000。图像模型也须声明 token 预算；这不是图像尺寸。').replace('Cannot exceed the context window; empty also keeps the built-in default.','Combined budgets must not exceed 100000000. Image token budgets are not image dimensions.')
editor=editor.replace('<span>{capability}</span>','<span>{capability === "tool_calling" ? (zh ? "工具调用（Agent 筛选）" : "Tool calling (Agent eligibility)") : capability}</span>')
# protocol radio sets primary for single model, multi-model keeps explicit hosts
editor=editor.replace('onChange={() => setProviderModelEditor((current) => current ? { ...current, apiProtocol: protocol.id } : current)}','onChange={() => { if (providerModelsDraft.length <= 1) setWireApiDraft(protocol.id); setProviderModelEditor((current) => current ? { ...current, apiProtocol: protocol.id } : current); }}')
a=editor.index('                    <footer'); b=editor.index('\n                  </section>',a); editor=editor[:a]+'''                    {imageModel && <p className="model-provider-hint" role="status">{zh ? "图像在线测试可能收费。当前草稿测试接口只发起文本调用，不支持图像生成，不能据此验证图像。可仅保存（未验证），然后在高级管理中显式测试图像能力。" : "Online image tests may incur charges. Draft tests send text requests only and cannot verify image generation. Save without verification, then explicitly probe image capabilities in advanced management."}</p>}
'''+editor[b:]
s=s.replace('                DIRECT_EDITOR',editor)
s=s.replace('<div className="model-provider-actions"><button type="button" onClick={resetProviderModels}>{zh ? "重置模型草稿" : "Reset model draft"}</button></div>','<div className="model-provider-actions"><button type="button" disabled={!providerDiscoveryCredentialReady || modelConfigBusy} onClick={() => void discoverModels()}>{zh ? "获取模型列表（合并保留现有模型）" : "Fetch models (merge, keep existing)"}</button></div>')
s=s.replace('onClick={() => openProviderModelEditor(model)}','onClick={() => switchDirectModel(model)}')
a=s.index('              <p className="model-provider-hint" data-testid="model-provider-save-guidance">'); b=s.index('              {modelConfigMessage &&',a)
s=s[:a]+'''              <p className="model-provider-hint" data-testid="model-provider-save-guidance">{zh ? "测试并保存会进行可能收费的真实对话调用，成功后才保存当前表单与其他模型草稿；不切换主模型。此调用不验证工具或多模态能力。" : "Test and save makes a potentially billable chat call, then saves this form and other model drafts only on success. It does not switch the primary model or verify tools/multimodal capabilities."}</p>
              {providerSetupIssue && <p className="model-provider-hint" id="model-provider-setup-issue" role="status">{providerSetupIssue}</p>}
              <div className="model-provider-actions">
                <button type="button" className="model-provider-button-primary" data-testid="model-provider-test-save" disabled={modelConfigBusy || Boolean(providerSetupIssue) || !providerModelEditor?.enabled || !providerModelEditor.capabilities.includes("chat") || providerModelEditor.capabilities.includes("image_generation")} onClick={() => setModelTestConfirmationOpen(true)}>{zh ? "测试并保存" : "Test and save"}</button>
                <button type="button" className="model-provider-button-quiet" data-testid="model-provider-save" disabled={modelConfigBusy || Boolean(providerSetupIssue) || !modelProviderDirty} onClick={() => void saveModelProvider(false)}>{zh ? "仅保存（未验证）" : "Save only (unverified)"}</button>
              </div>
'''+s[b:]
s=s.replace('onClick={() => void testModelConnection("model")}','onClick={() => void saveModelProvider(true)}')
a=s.index('                  <p id="model-provider-test-description">'); b=s.index('                  <div className="model-provider-delete-actions">',a)
s=s[:a]+'''                  <p id="model-provider-test-description">{zh ? "将发送可能收费的最小对话请求。只有调用成功才保存当前表单；失败不保存。其他模型、工具与多模态能力未经此次验证，不切换主模型。" : "Sends a potentially billable minimal chat request. Saves this form only after success; failure does not save. Other models, tools and multimodal abilities are not verified, and the primary model is unchanged."}</p>
'''+s[b:]
s=s.replace('`调用模型“${modelDraft.trim()}”？`','`测试并保存“${providerModelEditor?.modelId.trim()}”？`').replace('`Call model “${modelDraft.trim()}”?`','`Test and save “${providerModelEditor?.modelId.trim()}”?`')
s=s.replace('确认并测试','确认测试并保存').replace('Confirm and test','Confirm test and save')
p.write_text(s,encoding='utf-8')
