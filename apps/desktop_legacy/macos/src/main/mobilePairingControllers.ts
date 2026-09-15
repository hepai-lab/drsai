import type { WebContents } from "electron";
import { MobilePairingController } from "../../../shared/main/mobilePairingController";
import { LocalRuntimeClient } from "../../../shared/main/runtimeClient";

export class MacosMobilePairingControllerRegistry {
  readonly #controllers = new Map<string, MobilePairingController>();
  readonly #ownerCleanup = new Set<number>();

  for(sender: WebContents): MobilePairingController {
    const key = `${sender.id}:local`;
    const existing = this.#controllers.get(key);
    if (existing) return existing;
    const controller = new MobilePairingController(() => LocalRuntimeClient.connect());
    this.#controllers.set(key, controller);
    this.#installOwnerCleanup(sender);
    return controller;
  }

  async close(): Promise<void> {
    const controllers = [...this.#controllers.values()];
    this.#controllers.clear();
    this.#ownerCleanup.clear();
    await Promise.allSettled(controllers.map((controller) => controller.close()));
  }

  #installOwnerCleanup(sender: WebContents): void {
    if (this.#ownerCleanup.has(sender.id)) return;
    this.#ownerCleanup.add(sender.id);
    sender.once("destroyed", () => {
      this.#ownerCleanup.delete(sender.id);
      const owned = [...this.#controllers.entries()].filter(([key]) => key.startsWith(`${sender.id}:`));
      for (const [key] of owned) this.#controllers.delete(key);
      void Promise.allSettled(owned.map(([, controller]) => controller.close()));
    });
  }
}
