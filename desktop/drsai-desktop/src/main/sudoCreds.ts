// Stub: sudoCreds module removed from DrSai Desktop
export interface SudoPrecacheResult {
  cancelled: boolean;
  ok: boolean;
  stop: () => void;
}

export async function precacheSudoCredentials(_window?: unknown): Promise<SudoPrecacheResult> {
  return { cancelled: false, ok: true, stop: () => {} };
}
