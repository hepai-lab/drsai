export interface DuplexStartupTransactionOptions<Result> {
  prepareCapture: () => Promise<boolean>;
  startProvider: () => Promise<Result>;
  activateCapture: (result: Result) => boolean | Promise<boolean>;
  releaseCapture: () => Promise<void>;
  cancelProvider: (result: Result) => Promise<unknown>;
}

/** Runs startup in billing-safe order and rolls completed stages back in reverse. */
export async function runDuplexStartupTransaction<Result>(options: DuplexStartupTransactionOptions<Result>): Promise<Result> {
  let prepareAttempted = false; let providerResult: Result | undefined; let providerStarted = false;
  try {
    prepareAttempted = true;
    if (!await options.prepareCapture()) throw new Error("Microphone permission or audio capture initialization failed.");
    providerResult = await options.startProvider(); providerStarted = true;
    if (!await options.activateCapture(providerResult)) throw new Error("Microphone capture could not be activated after the Realtime Session started.");
    return providerResult;
  } catch (error) {
    if (providerStarted) await options.cancelProvider(providerResult as Result).catch(() => undefined);
    if (prepareAttempted) await options.releaseCapture().catch(() => undefined);
    throw error;
  }
}
