import type { DesktopApi } from "./desktopApi";

declare global {
  interface Window {
    openDrSai: DesktopApi;
  }
}

export {};

