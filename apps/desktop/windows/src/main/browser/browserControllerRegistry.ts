import type { BrowserController } from "./browserController";

type BrowserEngine = BrowserController["engine"];

const controllers = new Map<BrowserEngine, BrowserController>();

export function registerBrowserController(controller: BrowserController): void {
  controllers.set(controller.engine, controller);
}

export function getBrowserController(engine: BrowserEngine): BrowserController {
  const controller = controllers.get(engine);
  if (!controller) {
    throw new Error(`Browser controller is not registered: ${engine}`);
  }
  return controller;
}

export function listBrowserControllerEngines(): BrowserEngine[] {
  return [...controllers.keys()];
}
