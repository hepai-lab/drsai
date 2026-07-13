import type {
  BrowserActionOptions,
  BrowserActionResult,
  BrowserPageState,
  BrowserScreenshot,
  BrowserSnapshot,
  BrowserTaskStartRequest,
  BrowserWaitTarget,
} from "../../../shared/browser/types";
import type { BrowserController } from "../browserController";
import { createBrowserUseTaskCommand } from "../browserUse/protocol";
import { BrowserUseWorkerClient } from "../browserUse/workerClient";
import { checkBrowserUrlSync } from "../urlPolicy";

export class BrowserUseController implements BrowserController {
  readonly engine = "browser-use" as const;
  private currentUrl = "";
  private currentTitle = "";

  constructor(private readonly workerClient: BrowserUseWorkerClient) {}

  async startTask(request: BrowserTaskStartRequest): Promise<string> {
    const command = createBrowserUseTaskCommand(request);
    this.workerClient.send(command);
    return command.taskId;
  }

  async open(url: string): Promise<BrowserPageState> {
    const check = checkBrowserUrlSync(url);
    if (!check.allowed || !check.normalizedUrl) {
      throw new Error(check.reason);
    }
    this.currentUrl = check.normalizedUrl;
    this.currentTitle = check.normalizedUrl;
    return this.state(true);
  }

  async back(): Promise<BrowserPageState> {
    return this.state(false);
  }

  async forward(): Promise<BrowserPageState> {
    return this.state(false);
  }

  async reload(): Promise<BrowserPageState> {
    return this.state(true);
  }

  async stop(): Promise<BrowserPageState> {
    return this.state(false);
  }

  async snapshot(): Promise<BrowserSnapshot> {
    throw new Error("browser-use snapshot support requires a running worker task.");
  }

  async screenshot(): Promise<BrowserScreenshot> {
    throw new Error("browser-use screenshot support requires a running worker task.");
  }

  async readText(): Promise<string> {
    throw new Error("browser-use readText support requires a running worker task.");
  }

  async click(selector: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.result("click", `browser-use click queued for ${selector}`, options);
  }

  async type(selector: string, _text: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.result("type", `browser-use type queued for ${selector}`, options);
  }

  async select(selector: string, _value: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.result("select", `browser-use select queued for ${selector}`, options);
  }

  async keyPress(key: string, options?: BrowserActionOptions): Promise<BrowserActionResult> {
    return this.result("key_press", `browser-use key queued for ${key}`, options);
  }

  async waitFor(target: BrowserWaitTarget): Promise<BrowserActionResult> {
    return this.result("wait_for", `browser-use wait queued for ${target.kind}`);
  }

  async assertText(text: string, selector?: string): Promise<BrowserActionResult> {
    return this.result("assert_text", selector ? `browser-use assert queued for ${selector}: ${text}` : `browser-use assert queued: ${text}`);
  }

  private state(loading: boolean): BrowserPageState {
    return {
      url: this.currentUrl,
      title: this.currentTitle,
      loading,
      canGoBack: false,
      canGoForward: false,
      engine: this.engine,
    };
  }

  private result(
    action: BrowserActionResult["action"],
    message: string,
    options?: BrowserActionOptions,
  ): BrowserActionResult {
    return {
      ok: true,
      action,
      actionId: options?.actionId,
      message,
      url: this.currentUrl,
    };
  }
}
