interface ImeKeyEvent {
  keyCode?: number;
  nativeEvent: {
    isComposing?: boolean;
  };
}

export function isImeComposing(event: ImeKeyEvent): boolean {
  return Boolean(event.nativeEvent.isComposing || event.keyCode === 229);
}
