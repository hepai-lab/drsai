import type { DesktopApi } from "@shared/desktopApi";

export function hasDesktopApi(): boolean {
  return Boolean(window.openDrSai);
}

export const desktopApi: DesktopApi = new Proxy({} as DesktopApi, {
  get(_target, property) {
    const api = window.openDrSai;
    if (!api) {
      throw new Error("OpenDrSai desktop bridge is unavailable.");
    }
    const value = api[property as keyof DesktopApi];
    return typeof value === "function" ? value.bind(api) : value;
  },
});
