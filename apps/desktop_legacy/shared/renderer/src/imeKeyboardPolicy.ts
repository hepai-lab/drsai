export interface TextKeyboardEventLike {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function isTextCompositionEvent(event: Pick<TextKeyboardEventLike, "isComposing" | "keyCode">): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

export function shouldSubmitTextInput(event: TextKeyboardEventLike): boolean {
  return event.key === "Enter" && event.shiftKey !== true && !isTextCompositionEvent(event);
}
