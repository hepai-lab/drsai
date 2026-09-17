import type {
  BrowserActionOptions,
  BrowserActionResult,
  BrowserPageState,
  BrowserScreenshot,
  BrowserSnapshot,
  BrowserWaitTarget,
} from "../../../../../shared/api/browser/types";
import type { BrowserController } from "../browserController";
import { checkBrowserUrlSync } from "../urlPolicy";

export class ElectronWebviewController implements BrowserController {
  readonly engine = "electron-webview" as const;

  async open(url: string): Promise<BrowserPageState> {
    const check = checkBrowserUrlSync(url);
    if (!check.allowed || !check.normalizedUrl) {
      throw new Error(check.reason);
    }
    return this.pageState(check.normalizedUrl, check.normalizedUrl, true);
  }

  async back(): Promise<BrowserPageState> {
    return this.pageState("", "", false);
  }

  async forward(): Promise<BrowserPageState> {
    return this.pageState("", "", false);
  }

  async reload(): Promise<BrowserPageState> {
    return this.pageState("", "", true);
  }

  async stop(): Promise<BrowserPageState> {
    return this.pageState("", "", false);
  }

  async snapshot(): Promise<BrowserSnapshot> {
    throw new Error("Electron webview snapshots are collected in the renderer adapter.");
  }

  async screenshot(): Promise<BrowserScreenshot> {
    throw new Error("Electron webview screenshots are collected in the renderer adapter.");
  }

  async readText(): Promise<string> {
    throw new Error("Electron webview text is collected in the renderer adapter.");
  }

  async click(selector: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.acceptAction("click", selector, options);
  }

  async type(selector: string, _text: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.acceptAction("type", selector, options);
  }

  async select(selector: string, _value: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.acceptAction("select", selector, options);
  }

  async keyPress(key: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.acceptAction("key_press", key, options);
  }

  async waitFor(target: BrowserWaitTarget): Promise<BrowserActionResult> {
    return {
      ok: true,
      action: "wait_for",
      message: `Wait accepted for ${target.kind}.`,
    };
  }

  async assertText(text: string, selector?: string): Promise<BrowserActionResult> {
    return {
      ok: true,
      action: "assert_text",
      message: selector ? `Assertion accepted for ${selector}: ${text}` : `Assertion accepted: ${text}`,
    };
  }

  private pageState(url: string, title: string, loading: boolean): BrowserPageState {
    return {
      url,
      title,
      loading,
      canGoBack: false,
      canGoForward: false,
      engine: this.engine,
    };
  }

  private acceptAction(
    action: BrowserActionResult["action"],
    target: string,
    options?: BrowserActionOptions,
  ): BrowserActionResult {
    return {
      ok: true,
      action,
      actionId: options?.actionId,
      message: `Electron webview ${action} accepted for ${target}.`,
    };
  }
}
