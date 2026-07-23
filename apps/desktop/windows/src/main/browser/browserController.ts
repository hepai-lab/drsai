import type {
  BrowserActionOptions,
  BrowserActionResult,
  BrowserPageState,
  BrowserScreenshot,
  BrowserSnapshot,
  BrowserWaitTarget,
} from "../../../../shared/api/browser/types";

export interface BrowserController {
  readonly engine: "electron-webview" | "browser-use";

  open(url: string): Promise<BrowserPageState>;
  back(): Promise<BrowserPageState>;
  forward(): Promise<BrowserPageState>;
  reload(): Promise<BrowserPageState>;
  stop(): Promise<BrowserPageState>;

  snapshot(): Promise<BrowserSnapshot>;
  screenshot(): Promise<BrowserScreenshot>;
  readText(): Promise<string>;

  click(selector: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  type(selector: string, text: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  select(selector: string, value: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  keyPress(key: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  waitFor(target: BrowserWaitTarget): Promise<BrowserActionResult>;
  assertText(text: string, selector?: string): Promise<BrowserActionResult>;
}
