// Stub: askpass module removed from DrSai Desktop
export interface AskpassHandle {
  pathPrepend: string;
  env: Record<string, string>;
  cleanup: () => void;
}

export async function setupAskpass(_window?: unknown): Promise<AskpassHandle | null> {
  return {
    pathPrepend: "",
    env: {},
    cleanup: () => {},
  };
}
