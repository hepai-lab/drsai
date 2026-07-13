import type { DesktopApi } from "../shared/desktopApi";

declare global {
  interface Window {
    openDrSai: DesktopApi;
  }
}

export {};

