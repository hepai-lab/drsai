export type RemotePtySocket = Pick<WebSocket, "send" | "close" | "addEventListener" | "removeEventListener">;

export const REMOTE_PTY_KILL_ACK_TIMEOUT_MS = 2_000;

/** Send an explicit kill and keep the socket alive until the Runtime acknowledges it. */
export function requestRemotePtyKill(
  socket: RemotePtySocket,
  id: string,
  timeoutMs = REMOTE_PTY_KILL_ACK_TIMEOUT_MS,
): void {
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeEventListener("message", onMessage);
    socket.close();
  };
  const onMessage = (event: MessageEvent): void => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; id?: string };
      if (message.type === "killed" && message.id === id) finish();
    } catch { /* Ignore unrelated non-JSON terminal output. */ }
  };
  timer = setTimeout(finish, timeoutMs);
  socket.addEventListener("message", onMessage);
  try { socket.send(JSON.stringify({ type: "kill", id })); }
  catch { finish(); }
}
