import { useCallback, useEffect, useState } from "react";

interface UseFastModeResult {
  fastMode: boolean;
  toggle: () => Promise<void>;
  /** Set fast mode without round-tripping through config (still persists). */
  set: (next: boolean) => Promise<void>;
}

function isFastTier(val: unknown): boolean {
  return val === "fast" || val === "priority";
}

export function useFastMode(profile?: string): UseFastModeResult {
  const [fastMode, setFastMode] = useState(false);

  useEffect(() => {
    window.hermesAPI.getConfig("agent.service_tier", profile).then((val) => {
      setFastMode(isFastTier(val));
    });
  }, [profile]);

  const set = useCallback(
    async (next: boolean): Promise<void> => {
      setFastMode(next);
      await window.hermesAPI.setConfig(
        "agent.service_tier",
        next ? "fast" : "normal",
        profile,
      );
    },
    [profile],
  );

  const toggle = useCallback(async (): Promise<void> => {
    await set(!fastMode);
  }, [fastMode, set]);

  return { fastMode, toggle, set };
}
