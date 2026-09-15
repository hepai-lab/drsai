import type { DesktopDuplexVoiceSessionStartRequest } from "../../../api/desktopApi";

const HOT_FIELDS = new Set<keyof DesktopDuplexVoiceSessionStartRequest>(["instructions"]);
const IGNORED_FIELDS = new Set<keyof DesktopDuplexVoiceSessionStartRequest>(["updateId"]);

export function classifyDuplexSessionUpdate(current: DesktopDuplexVoiceSessionStartRequest, next: DesktopDuplexVoiceSessionStartRequest): { hot: string[]; restart: string[] } {
  const hot: string[] = []; const restart: string[] = [];
  for (const key of Object.keys(next) as Array<keyof DesktopDuplexVoiceSessionStartRequest>) {
    if (IGNORED_FIELDS.has(key) || Object.is(current[key], next[key])) continue;
    (HOT_FIELDS.has(key) ? hot : restart).push(key);
  }
  return { hot: hot.sort(), restart: restart.sort() };
}
