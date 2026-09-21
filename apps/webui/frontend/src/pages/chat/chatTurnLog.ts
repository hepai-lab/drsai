/**
 * Second-turn loading diagnosis.
 * Prefix: [CHAT_TURN]
 *
 * Always on unless localStorage.drsai:chatTurnLog === "0".
 * Dump recent events: window.__DRSAI_CHAT_TURN_LOGS
 */
export type ChatTurnLogPayload = Record<string, unknown>;

const LOG_KEY = "drsai:chatTurnLog";
const MAX_BUFFER = 200;

type ChatTurnLogEntry = {
  t: string;
  ms: number;
  phase: string;
  payload: ChatTurnLogPayload;
};

declare global {
  interface Window {
    __DRSAI_CHAT_TURN_LOGS?: ChatTurnLogEntry[];
  }
}

const t0 =
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function isChatTurnLogEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage?.getItem(LOG_KEY) !== "0";
  } catch {
    return true;
  }
}

function wsReadyStateLabel(state: number | undefined | null): string {
  switch (state) {
    case 0:
      return "CONNECTING";
    case 1:
      return "OPEN";
    case 2:
      return "CLOSING";
    case 3:
      return "CLOSED";
    default:
      return String(state);
  }
}

export function chatTurnLog(
  phase: string,
  payload: ChatTurnLogPayload = {}
): void {
  if (!isChatTurnLogEnabled()) return;
  const entry: ChatTurnLogEntry = {
    t: new Date().toISOString(),
    ms: Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        t0
    ),
    phase,
    payload,
  };
  if (typeof window !== "undefined") {
    const buf = window.__DRSAI_CHAT_TURN_LOGS || [];
    buf.push(entry);
    if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
    window.__DRSAI_CHAT_TURN_LOGS = buf;
  }
  // eslint-disable-next-line no-console
  console.info(`[CHAT_TURN] ${phase}`, entry);
}

export function socketStatePayload(socket: WebSocket | null | undefined) {
  return {
    hasSocket: Boolean(socket),
    readyState: socket ? wsReadyStateLabel(socket.readyState) : "none",
    url: socket?.url,
  };
}
