/// <reference types="vite/client" />

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

