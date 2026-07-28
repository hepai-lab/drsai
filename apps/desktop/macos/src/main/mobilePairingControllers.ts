import type { WebContents } from "electron";
import type { DesktopMobilePairingTarget } from "../../../shared/api/desktopApi";
import { MobilePairingController } from "../../../shared/main/mobilePairingController";
import { LocalRuntimeClient, connectRuntimeClientForWorkspace } from "../../../shared/main/runtimeClient";

export class MacosMobilePairingControllerRegistry {
  readonly #controllers = new Map<string, MobilePairingController>();
  readonly #ownerCleanup = new Set<number>();

  for(sender: WebContents, rawTarget?: DesktopMobilePairingTarget): MobilePairingController {
    const target = normalizeMobilePairingTarget(rawTarget);
    const key = target ? `${sender.id}:${target.workspaceId}:${target.workspacePath}` : `${sender.id}:local`;
    const existing = this.#controllers.get(key);
    if (existing) return existing;
    const controller = new MobilePairingController(() => target
      ? connectRuntimeClientForWorkspace(target.workspacePath, target.workspaceId).then(({ client }) => client)
      : LocalRuntimeClient.connect());
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

export function normalizeMobilePairingTarget(value: DesktopMobilePairingTarget | undefined): DesktopMobilePairingTarget | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Mobile pairing target is invalid.");
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const workspacePath = typeof value.workspacePath === "string" ? value.workspacePath.trim() : "";
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(workspaceId) || !workspacePath || workspacePath.length > 4096 || /[\r\n\0]/.test(workspacePath)) {
    throw new Error("Mobile pairing target is invalid.");
  }
  return { workspaceId, workspacePath };
}
