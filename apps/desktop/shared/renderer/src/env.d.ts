/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENDRSAI_LAUNCH_MODE?: "development" | "production";
  readonly VITE_OPENDRSAI_OIDC_ONLY?: "0" | "1";
}

declare module "jszip" {
  interface JSZipObject {
    dir: boolean;
    async(type: "string"): Promise<string>;
    async(type: "arraybuffer"): Promise<ArrayBuffer>;
    async(type: string): Promise<unknown>;
  }

  class JSZip {
    constructor();
    files: Record<string, JSZipObject>;
    file(path: string): JSZipObject | null;
    file(path: string, data: string | ArrayBuffer | Uint8Array | Blob): this;
    generateAsync(options: { type: "blob"; compression?: string }): Promise<Blob>;
    generateAsync(options: { type: "arraybuffer"; compression?: string }): Promise<ArrayBuffer>;
    generateAsync(options: { type: "uint8array"; compression?: string }): Promise<Uint8Array>;
    generateAsync(options: { type: "string"; compression?: string }): Promise<string>;
    generateAsync(options?: { type?: string; compression?: string }): Promise<Blob | ArrayBuffer | Uint8Array | string>;
    forEach(callback: (relativePath: string, file: JSZipObject) => void): void;
    static loadAsync(data: ArrayBuffer | Blob | Uint8Array | string): Promise<JSZip>;
  }
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

declare module "pptx-preview" {
  interface PptxPreviewer {
    preview(data: ArrayBuffer | Uint8Array): Promise<unknown>;
    destroy?: () => void;
  }

  export function init(
    container: HTMLElement,
    options?: { width?: number; height?: number; mode?: "list" | "slide" },
  ): PptxPreviewer;
}

declare module "xlsx" {
  interface ExcelCell {
    v?: unknown;
    w?: string;
  }

  interface ExcelSheet {
    [address: string]: ExcelCell | string | undefined;
    "!ref"?: string;
  }

  interface ExcelWorkbook {
    SheetNames: string[];
    Sheets: Record<string, ExcelSheet | undefined>;
  }

  interface ExcelUtils {
    decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(address: { r: number; c: number }): string;
    format_cell(cell: ExcelCell | string): string;
  }

  export function read(
    data: ArrayBuffer | Uint8Array,
    options?: { type?: string; cellDates?: boolean },
  ): ExcelWorkbook;

  export const utils: ExcelUtils;
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

