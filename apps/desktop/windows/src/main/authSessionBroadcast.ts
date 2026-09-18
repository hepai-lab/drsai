interface AuthSessionRenderer {
  isDestroyed(): boolean;
  send(channel: string): void;
}

interface AuthSessionWindow {
  isDestroyed(): boolean;
  webContents: AuthSessionRenderer;
}

/** Notify other renderer windows after a session change without echoing to the IPC caller. */
export function broadcastAuthSessionRestored(
  windows: readonly AuthSessionWindow[],
  initiatingRenderer?: AuthSessionRenderer,
): void {
  for (const window of windows) {
    if (
      window.isDestroyed()
      || window.webContents.isDestroyed()
      || window.webContents === initiatingRenderer
    ) {
      continue;
    }
    window.webContents.send("desktop:auth-session-restored");
  }
}
