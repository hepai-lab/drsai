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
  id: "retry" | "login_codex" | "resync_workspace" | "repair_codex" | "new_task" | "select_model" | "remove_resource" | "reconnect" | "diagnostics" | "continue" | "redo" | "abandon";
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
  continue: { en: "Continue from saved work", zh: "基于已保留内容继续" },
  redo: { en: "Redo from the start", zh: "从头重做" },
  abandon: { en: "Leave as interrupted", zh: "放弃本次任务" },
};

export function describeUserFacingError(error: unknown, language: "zh" | "en"): UserFacingError {
  const envelope = normalizeRuntimeErrorEnvelope(error);
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
  if (envelope.code === "image_generation_model_unavailable") {
    return {
      title: language === "zh" ? "未配置图像生成模型" : "Image-generation model is not configured",
      action: language === "zh"
        ? "输入内容已保留。请在 Agent 模型设置中绑定图像生成模型后再发送。"
        : "Your input was preserved. Bind an image-generation model in Agent model settings, then send again.",
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
    return {
      title: language === "zh" ? "图像理解模型鉴权失败" : "Image-understanding model authorization failed",
      action: language === "zh"
        ? "图片附件已保留。请重新登录 AI 平台账号，确认已开通该识图模型，然后重试。"
        : "Your image attachment was preserved. Sign in to the AI platform again, confirm the vision model is enabled, then retry.",
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
