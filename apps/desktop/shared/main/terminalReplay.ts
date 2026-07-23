export interface TerminalReplayCursor {
  generation: number;
  sequence: number;
}

export interface TerminalReplayEvent<T = unknown> {
  generation: number;
  sequence: number;
  value: T;
}

export interface TerminalReplayPlan<T = unknown> {
  cursor: TerminalReplayCursor;
  accepted: Array<TerminalReplayEvent<T>>;
  snapshotAccepted: boolean;
  snapshotRequired: boolean;
}

export function reconcileTerminalReplay<T>(
  current: TerminalReplayCursor,
  snapshot: TerminalReplayCursor | null,
  events: Array<TerminalReplayEvent<T>>,
): TerminalReplayPlan<T> {
  let cursor = { ...current };
  let snapshotAccepted = false;
  let snapshotRequired = false;
  if (snapshot && snapshot.generation >= cursor.generation) {
    cursor = { ...snapshot };
    snapshotAccepted = true;
  }
  const accepted: Array<TerminalReplayEvent<T>> = [];
  for (const event of events) {
    if (event.generation < cursor.generation) continue;
    if (event.generation > cursor.generation) {
      snapshotRequired = true;
      continue;
    }
    if (event.sequence <= cursor.sequence) continue;
    if (event.sequence !== cursor.sequence + 1) {
      snapshotRequired = true;
      continue;
    }
    accepted.push(event);
    cursor = { generation: event.generation, sequence: event.sequence };
  }
  return { cursor, accepted, snapshotAccepted, snapshotRequired };
}
