/// <reference types="vite/client" />

interface OpenDrSaiWebviewTag extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getURL(): string;
  getTitle(): string;
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

