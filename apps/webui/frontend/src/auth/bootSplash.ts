export const BOOT_SPLASH_ID = "drsai-boot-splash";

/** Remove the HTML-only splash once React can paint its own loading or app shell. */
export function hideBootSplash(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (!el) return;
  el.remove();
}
