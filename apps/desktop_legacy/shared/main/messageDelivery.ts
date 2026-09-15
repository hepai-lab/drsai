export type MessageDeliveryState =
  | "optimistic" | "sending" | "accepted" | "running"
  | "terminal" | "uncertain" | "failed";

const transitions: Record<MessageDeliveryState, ReadonlySet<MessageDeliveryState>> = {
  optimistic: new Set(["sending", "failed"]),
  sending: new Set(["accepted", "uncertain", "failed"]),
  uncertain: new Set(["accepted", "running", "terminal", "failed"]),
  accepted: new Set(["running", "terminal", "failed"]),
  running: new Set(["terminal", "failed"]),
  terminal: new Set(),
  failed: new Set(["sending"]),
};

export function advanceMessageDelivery(
  current: MessageDeliveryState,
  next: MessageDeliveryState,
): MessageDeliveryState {
  if (current === next) return current;
  if (!transitions[current].has(next)) throw new Error("message_delivery_transition_invalid");
  return next;
}

export function isUncertainRunCreateFailure(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 500) return true;
  }
  if (error instanceof TypeError) return true;
  return error instanceof Error
    && /fetch failed|network|socket|connection|ECONN|UND_ERR|terminated|other side closed|timeout/i.test(error.message);
}

/**
 * Resolve an uncertain create by read-only lookup.  The caller owns the one
 * and only POST; this helper deliberately has no create callback, which makes
 * an accidental blind resend impossible.
 */
export async function recoverRunCreation<T>(
  lookup: () => Promise<T | null>,
  options: {
    delaysMs?: readonly number[];
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<T | null> {
  const delays = options.delaysMs ?? [0, 100, 250, 500, 1_000];
  const wait = options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  for (const delay of delays) {
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 30_000) {
      throw new Error("message_delivery_recovery_delay_invalid");
    }
    if (delay) await wait(delay);
    try {
      const result = await lookup();
      if (result !== null) return result;
    } catch (error) {
      if (!isUncertainRunCreateFailure(error)) throw error;
    }
  }
  return null;
}
