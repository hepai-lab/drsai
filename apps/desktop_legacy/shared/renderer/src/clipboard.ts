import { desktopApi, hasDesktopApi } from "./desktopApi";

/** Copy without leaking browser permission failures as unhandled rejections. */
export async function copyTextSafely(text: string): Promise<boolean> {
  if (hasDesktopApi()) {
    try {
      if (await desktopApi.copyTextToClipboard(text)) return true;
    } catch {
      // Fall through for browser-only development and an unavailable bridge.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async Clipboard API may be denied when the window is unfocused.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
