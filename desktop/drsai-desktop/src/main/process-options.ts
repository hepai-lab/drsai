export const HIDDEN_SUBPROCESS_OPTIONS = { windowsHide: true } as const;

export function hiddenSubprocessOptions<T extends object>(
  options: T,
): T & typeof HIDDEN_SUBPROCESS_OPTIONS {
  return { ...options, ...HIDDEN_SUBPROCESS_OPTIONS };
}
