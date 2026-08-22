/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENDRSAI_LAUNCH_MODE?: "development" | "production";
}

declare module "jszip" {
  interface JSZipObject {
    async(type: "string"): Promise<string>;
    async(type: string): Promise<unknown>;
  }

  interface JSZipInstance {
    files: Record<string, JSZipObject>;
  }

  const JSZip: {
    loadAsync(data: ArrayBuffer | Blob | Uint8Array): Promise<JSZipInstance>;
  };
  export default JSZip;
}

declare module "docx-preview" {
  export function renderAsync(
    document: Blob | ArrayBuffer | Uint8Array,
    bodyContainer: HTMLElement,
    styleContainer?: HTMLElement,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

interface OpenDrSaiWebviewTag extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
  getZoomFactor(): number | Promise<number>;
  setZoomFactor(factor: number): void | Promise<void>;
  setZoomLevel(level: number): void | Promise<void>;
  findInPage(text: string): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  openDevTools(): void;
  clearHistory(): void;
  capturePage(): Promise<{ toDataURL(): string }>;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: import("react").DetailedHTMLProps<
      import("react").HTMLAttributes<OpenDrSaiWebviewTag> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        webpreferences?: string;
      },
      OpenDrSaiWebviewTag
    >;
  }
}

