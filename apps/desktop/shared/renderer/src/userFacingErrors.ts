import { normalizeRuntimeErrorEnvelope } from "../../api/errorEnvelope";
import type { RuntimeErrorCategory, RuntimeRecoveryAction } from "../../api/desktopApi";

export interface UserFacingError {
  title: string;
  action: string;
  retryable: boolean;
  diagnosticCode: string;
  actions: UserFacingRecoveryAction[];
}

export interface UserFacingRecoveryAction {
  id: "retry" | "login_codex" | "resync_workspace" | "repair_codex" | "new_task" | "select_model" | "remove_resource" | "reconnect" | "diagnostics" | "continue" | "redo" | "abandon" | "stop_running";
  label: string;
}

const ACTION_IDS: Record<RuntimeRecoveryAction, UserFacingRecoveryAction["id"]> = {
  retry: "retry", login: "login_codex", sync: "resync_workspace", repair: "repair_codex",
  new_task: "new_task", select_model: "select_model", remove_resource: "remove_resource",
  reconnect: "reconnect", diagnostics: "diagnostics",
  continue: "continue", redo: "redo", abandon: "abandon",
};

const TEXT: Record<RuntimeErrorCategory, { en: [string, string]; zh: [string, string] }> = {
  binding: { en: ["This task needs its original backend binding.", "Sync the workspace or explicitly start a new task."], zh: ["当前任务需要恢复原有后端绑定。", "请同步工作区，或明确新建任务。"] },
  auth: { en: ["OpenDrSai needs you to sign in.", "Sign in from Settings, then retry."], zh: ["OpenDrSai 需要登录。", "请在设置中登录，然后重试。"] },
  transport: { en: ["OpenDrSai cannot reach the backend.", "Reconnect and retry; received content has been preserved."], zh: ["OpenDrSai 暂时无法连接后端。", "请重新连接后重试；已收到的内容会保留。"] },
  contract: { en: ["This OpenDrSai component needs an update.", "Update or repair OpenDrSai before retrying."], zh: ["OpenDrSai 的组件版本需要更新。", "请更新或修复 OpenDrSai 后再试。"] },
  model: { en: ["The selected model is unavailable for this task.", "Use the bound model or start a new task with another model."], zh: ["当前任务无法使用所选模型。", "请使用绑定模型，或用其他模型新建任务。"] },
  approval: { en: ["The approval could not be completed.", "Review the current request and retry if it is still valid."], zh: ["审批未能完成。", "请检查当前请求，确认仍有效后重试。"] },
  resource: { en: ["One or more input resources are unavailable.", "Remove or reattach the affected resource, then retry."], zh: ["一个或多个输入资源不可用。", "请移除或重新附加相关资源，然后重试。"] },
  history: { en: ["Conversation history could not be synchronized.", "Reload or sync the workspace, then continue."], zh: ["会话历史未能同步。", "请重新加载或同步工作区后继续。"] },
  runtime: { en: ["The OpenDrSai Runtime is unavailable.", "Retry or repair the Runtime from Settings."], zh: ["OpenDrSai Runtime 不可用。", "请重试，或在设置中修复 Runtime。"] },
  backend: { en: ["OpenDrSai did not complete the operation.", "Retry if safe, or inspect redacted diagnostics."], zh: ["OpenDrSai 未能完成操作。", "确认安全后重试，或查看脱敏诊断。"] },
  unknown: { en: ["The operation did not complete.", "Inspect redacted diagnostics before retrying."], zh: ["操作未完成。", "请先查看脱敏诊断，再决定是否重试。"] },
};

const LABELS: Record<UserFacingRecoveryAction["id"], { en: string; zh: string }> = {
  retry: { en: "Retry", zh: "重试" }, login_codex: { en: "Sign in to OpenDrSai", zh: "登录 OpenDrSai" },
  resync_workspace: { en: "Sync workspace", zh: "同步工作区" }, repair_codex: { en: "Repair OpenDrSai", zh: "修复 OpenDrSai" },
  new_task: { en: "Start a new task", zh: "新建任务" }, select_model: { en: "Select model", zh: "选择模型" },
  remove_resource: { en: "Review resources", zh: "检查资源" }, reconnect: { en: "Reconnect", zh: "重新连接" },
  diagnostics: { en: "View diagnostics", zh: "查看诊断" },
  stop_running: { en: "Stop the current run", zh: "停止当前运行" },
  continue: { en: "Continue from saved work", zh: "基于已保留内容继续" },
  redo: { en: "Redo from the start", zh: "从头重做" },
  abandon: { en: "Leave as interrupted", zh: "放弃本次任务" },
};

export function describeUserFacingError(error: unknown, language: "zh" | "en"): UserFacingError {
  const envelope = normalizeRuntimeErrorEnvelope(error);
  const webSearch = describeWebSearchFailure(envelope.code, envelope.retryable, language);
  if (webSearch) return { ...webSearch, diagnosticCode: envelope.diagnostic_reference === "diag-unavailable" ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}` };
  if (envelope.code === "model_image_input_unsupported") {
    return {
      title: language === "zh" ? "当前模型不支持图片理解" : "The selected model cannot understand images",
      action: language === "zh"
        ? "图片附件和输入内容已保留。请选择支持图片输入的模型后重新发送。"
        : "Your image attachment and input were preserved. Select a model that supports image input, then send again.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "image_understanding_model_unavailable") {
    return {
      title: language === "zh" ? "未配置图像理解模型" : "Image-understanding model is not configured",
      action: language === "zh"
        ? "图片附件和输入内容已保留。请在 Agent 模型设置中绑定图像理解模型后再发送。"
        : "Your image attachment and input were preserved. Bind an image-understanding model in Agent model settings, then send again.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "image_generation_model_unavailable" || envelope.code === "image_model_unconfigured") {
    return {
      title: language === "zh" ? "未配置图像生成模型" : "Image-generation model is not configured",
      action: language === "zh"
        ? "输入内容已保留。请在 Agent 模型设置中绑定图像生成模型（默认 GPT Image 2.5 Sunburst，也可切换 GPT Image / Gemini 图像预览）后再发送。"
        : "Your input was preserved. Bind an image-generation model in Agent settings (default GPT Image 2.5 Sunburst; GPT Image / Gemini image preview also available), then send again.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (
    envelope.code === "image_model_unavailable"
    || envelope.code === "image_operation_unsupported"
    || envelope.code === "image_operation_protocol_unsupported"
    || envelope.code === "image_provider_rejected"
    || envelope.code === "image_provider_invalid_response"
    || envelope.code === "image_provider_timeout"
  ) {
    return {
      title: language === "zh" ? "图像生成失败" : "Image generation failed",
      action: language === "zh"
        ? "请在 Agent 模型设置中改选其他图像生成模型，确认已登录且模型未在维护，然后重试。不要连续盲目重试以免重复计费。"
        : "Switch to another image-generation model in Agent settings, confirm you are signed in and the model is not under maintenance, then retry. Avoid blind retries that may bill again.",
      retryable: envelope.retryable,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.length
        ? envelope.recovery_actions.map((action) => {
          const id = ACTION_IDS[action];
          return { id, label: LABELS[id][language] };
        })
        : [{ id: "select_model", label: LABELS.select_model[language] }],
    };
  }
  if (envelope.code === "image_prompt_invalid" || envelope.code === "image_size_unsupported") {
    return {
      title: language === "zh" ? "图像生成参数无效" : "Image generation parameters are invalid",
      action: language === "zh"
        ? "请调整提示词或尺寸后重试（尺寸需为支持的规格，如 1024x1024）。"
        : "Adjust the prompt or size and retry (use a supported size such as 1024x1024).",
      retryable: true,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: [{ id: "retry", label: LABELS.retry[language] }],
    };
  }
  if (envelope.code === "side_effect_outcome_unknown") {
    return {
      title: language === "zh" ? "图像请求结果未知" : "Image request outcome is unknown",
      action: language === "zh"
        ? "请求可能已到达图像服务。请勿立即重复发送；先检查工作区 artifacts 是否已有结果，或稍后重试。"
        : "The request may have reached the image provider. Do not resend immediately; check workspace artifacts first, or retry later.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: [{ id: "diagnostics", label: LABELS.diagnostics[language] }],
    };
  }
  if (envelope.code === "thread_skill_unavailable" || envelope.code === "thread_skill_invalid") {
    return {
      title: language === "zh" ? "所选技能无法用于本轮对话" : "Selected skill cannot be used for this turn",
      action: language === "zh"
        ? "请确认技能已安装并在「本地技能」中启用，且当前使用本地 OpenDrSai Agent，然后重新选择技能发送。"
        : "Confirm the skill is installed and enabled under Local skills, use the local OpenDrSai Agent, then reselect the skill and send again.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "image_understanding_failed") {
    return {
      title: language === "zh" ? "图像理解失败" : "Image understanding failed",
      action: language === "zh"
        ? "图片附件和输入内容已保留。请检查图像理解模型与凭证后重试，或更换可用的识图模型。"
        : "Your image attachment and input were preserved. Check the image-understanding model and credentials, then retry or select another vision model.",
      retryable: envelope.retryable,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "model_unauthorized") {
    const imageGen = /image.?generat|image_model|生图|图像生成/i.test(
      `${envelope.message || ""} ${envelope.diagnostic_reference || ""} ${envelope.code}`,
    );
    return {
      title: language === "zh"
        ? (imageGen ? "图像生成鉴权失败" : "图像理解模型鉴权失败")
        : (imageGen ? "Image-generation authorization failed" : "Image-understanding model authorization failed"),
      action: language === "zh"
        ? (imageGen
          ? "请重新登录 AI 平台账号，确认已开通当前图像生成模型，然后重试。不要连续盲目重试。"
          : "图片附件已保留。请重新登录 AI 平台账号，确认已开通该识图模型，然后重试。")
        : (imageGen
          ? "Sign in to the AI platform again, confirm the image-generation model is enabled, then retry. Avoid blind retries."
          : "Your image attachment was preserved. Sign in to the AI platform again, confirm the vision model is enabled, then retry."),
      retryable: envelope.retryable,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "upstream_unavailable" || envelope.code === "worker_unavailable") {
    return {
      title: language === "zh" ? "所选模型暂时不可用" : "The selected model is temporarily unavailable",
      action: language === "zh"
        ? "请到 AI 平台确认该模型是否在线，稍后重试，或在 Agent 模型设置中改选其他可用模型。"
        : "Check the AI platform for model availability, retry later, or select another available model in Agent model settings.",
      retryable: true,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "reasoning_effort_unsupported") {
    return {
      title: language === "zh" ? "当前模型不支持该推理强度" : "This model does not support the selected reasoning effort",
      action: language === "zh"
        ? "请把推理强度改为「无」或不支持推理的模型可用的档位，或改回 DeepSeek 等支持推理的主模型。"
        : "Clear reasoning effort, pick a supported level, or switch back to a reasoning-capable primary model such as DeepSeek.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "runtime_restart_interrupted") {
    return {
      title: language === "zh" ? "任务因 Runtime 重启而中断" : "The task was interrupted by a Runtime restart",
      action: language === "zh"
        ? "已收到的内容和文件均已保留。请选择基于现有成果继续、从头重做，或放弃本次任务。"
        : "Received content and files were preserved. Continue from saved work, redo from the start, or leave this task interrupted.",
      retryable: false,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "agent_error_yielded") {
    return {
      title: language === "zh" ? "智能体执行出错" : "Agent execution error",
      action: language === "zh"
        ? "模型调用或工具执行过程中发生错误，已收到的内容会保留。请重试，或查看诊断信息了解详情。"
        : "An error occurred during model invocation or tool execution. Received content is preserved. Retry, or view diagnostics for details.",
      retryable: envelope.retryable,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: envelope.recovery_actions.map((action) => {
        const id = ACTION_IDS[action];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "run_cancelled") {
    return {
      title: language === "zh" ? "任务已取消" : "Task cancelled",
      action: language === "zh"
        ? "任务已被取消，已收到的内容会保留。可以重新发送消息重试，或新建任务。"
        : "The task was cancelled. Received content is preserved. Retry by sending again, or start a new task.",
      retryable: true,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: ["retry", "new_task", "diagnostics"].map((action) => {
        const id = ACTION_IDS[action as RuntimeRecoveryAction];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  if (envelope.code === "session_busy") {
    return {
      title: language === "zh" ? "该会话已有任务正在运行" : "This session already has a running turn",
      action: language === "zh"
        ? "同一会话同时只允许一个任务。可以停止当前运行后重新发送，或等待它完成。"
        : "Only one turn may run per session at a time. Stop the current run and send again, or wait for it to finish.",
      retryable: true,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
      actions: [
        { id: "stop_running" as const, label: LABELS.stop_running[language] },
        { id: "retry" as const, label: LABELS.retry[language] },
        { id: "diagnostics" as const, label: LABELS.diagnostics[language] },
      ],
    };
  }
  if (
    envelope.code === "session_outbox_busy"
    || (typeof envelope.message === "string" && envelope.message.includes("awaiting Runtime acknowledgement"))
  ) {
    return {
      title: language === "zh" ? "上一轮任务仍在收尾" : "Previous turn is still finishing",
      action: language === "zh"
        ? "刚停止的任务还在后台结束中。请稍等片刻再发送，或新建任务。"
        : "The stopped turn is still finishing in the background. Wait a moment and send again, or start a new task.",
      retryable: true,
      diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
        ? (envelope.code === "unexpected_error" ? "session_outbox_busy" : envelope.code)
        : `${envelope.code === "unexpected_error" ? "session_outbox_busy" : envelope.code} · ${envelope.diagnostic_reference}`,
      actions: ["retry", "new_task", "diagnostics"].map((action) => {
        const id = ACTION_IDS[action as RuntimeRecoveryAction];
        return { id, label: LABELS[id][language] };
      }),
    };
  }
  const copy = TEXT[envelope.category][language];
  return {
    title: copy[0], action: copy[1], retryable: envelope.retryable,
    diagnosticCode: envelope.diagnostic_reference === "diag-unavailable"
      ? envelope.code : `${envelope.code} · ${envelope.diagnostic_reference}`,
    actions: envelope.recovery_actions.map((action) => {
      const id = ACTION_IDS[action];
      return { id, label: LABELS[id][language] };
    }),
  };
}

function describeWebSearchFailure(code: string, retryable: boolean, language: "zh" | "en"): Omit<UserFacingError, "diagnosticCode"> | null {
  const copy: Record<string, { zh: [string, string]; en: [string, string]; actions: UserFacingRecoveryAction["id"][] }> = {
    login_required: { zh: ["需要登录后才能使用托管网页搜索", "登录 HAI 后可以继续原任务，无需配置 Tavily Key。"], en: ["Sign in to use managed web search", "Sign in to HAI to continue the original task without configuring a Tavily key."], actions: ["login_codex"] },
    permission_denied: { zh: ["当前账户未开通托管网页搜索", "可联系管理员开通，或在感知器设置中选择自己的 Tavily Key。"], en: ["Managed web search is not enabled for this account", "Ask an administrator for access or select your own Tavily key in Perceptor settings."], actions: ["diagnostics"] },
    quota_exhausted: { zh: ["托管网页搜索额度已用尽", "额度恢复后重试，或明确切换到自己的 Tavily Key。"], en: ["Managed web-search quota is exhausted", "Retry after quota is restored or explicitly switch to your own Tavily key."], actions: ["diagnostics"] },
    rate_limited: { zh: ["网页搜索请求过于频繁", "原任务已保留，请稍后重试。"], en: ["Web-search requests are temporarily rate limited", "The original task is preserved. Retry later."], actions: ["retry", "diagnostics"] },
    worker_unavailable: { zh: ["网页搜索服务暂时不可用", "原问题和已完成内容已保留，请稍后重试。"], en: ["Web-search service is temporarily unavailable", "Your question and completed work are preserved. Retry later."], actions: ["retry", "diagnostics"] },
    provider_authentication_failed: { zh: ["平台托管搜索凭据异常", "这是平台配置问题，无需输入自己的 Tavily Key；请查看诊断并联系管理员。"], en: ["The platform-managed search credential failed", "This is a platform configuration issue. Do not enter your own Tavily key; view diagnostics and contact an administrator."], actions: ["diagnostics"] },
    provider_rate_limited: { zh: ["Tavily 上游暂时限流", "原任务已保留，请稍后重试。"], en: ["Tavily is temporarily rate limited", "The original task is preserved. Retry later."], actions: ["retry", "diagnostics"] },
    provider_quota_exhausted: { zh: ["平台的 Tavily 上游额度不足", "这是平台额度问题，无需输入自己的 Tavily Key；请查看诊断或联系管理员。"], en: ["The platform Tavily quota is exhausted", "This is a platform quota issue. Do not enter your own Tavily key; view diagnostics or contact an administrator."], actions: ["diagnostics"] },
    provider_unavailable: { zh: ["上游网页搜索暂时不可用", "无需重新配置登录；请稍后重试或查看脱敏诊断。"], en: ["The upstream web-search provider is unavailable", "You do not need to sign in again. Retry later or view redacted diagnostics."], actions: ["retry", "diagnostics"] },
    provider_timeout: { zh: ["网页搜索响应超时", "本次请求已停止，稍后重试不会复用失败结果。"], en: ["Web search timed out", "This request has stopped. A later retry will not reuse the failed result."], actions: ["retry", "diagnostics"] },
    provider_invalid_response: { zh: ["网页搜索返回了异常响应", "请稍后重试；诊断信息中仅保留脱敏请求标识。"], en: ["Web search returned an invalid response", "Retry later. Diagnostics retain only redacted request identifiers."], actions: ["retry", "diagnostics"] },
    unsafe_web_url: { zh: ["无法访问不安全的网页地址", "请改用公开的 HTTP 或 HTTPS 网页地址。"], en: ["The web address is not safe to access", "Use a public HTTP or HTTPS web address instead."], actions: ["diagnostics"] },
  };
  const selected = copy[code];
  if (!selected) return null;
  const [title, action] = selected[language];
  return { title, action, retryable, actions: selected.actions.map((id) => ({ id, label: LABELS[id][language] })) };
}
