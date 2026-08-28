export type WeChatComposerTrigger = "button" | "keyboard";
export type WeChatComposerDecision =
  | "ordinary_submit"
  | "blocked"
  | "request_confirmation"
  | "send_external";

export function decideWeChatComposerSubmit(input: {
  channelSource?: "wechat";
  trigger: WeChatComposerTrigger;
  available: boolean;
  confirmed: boolean;
  sending: boolean;
  hasText: boolean;
}): WeChatComposerDecision {
  if (input.channelSource !== "wechat") return "ordinary_submit";
  if (input.trigger === "keyboard") return "blocked";
  if (!input.available || input.sending || !input.hasText) return "blocked";
  return input.confirmed ? "send_external" : "request_confirmation";
}

