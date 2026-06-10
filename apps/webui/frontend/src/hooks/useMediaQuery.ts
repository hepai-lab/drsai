import { useEffect, useState } from "react";

/** Matches Tailwind `lg` — tablet portrait and phones use compact layout. */
export const COMPACT_LAYOUT_QUERY = "(max-width: 1023px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);

    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}
