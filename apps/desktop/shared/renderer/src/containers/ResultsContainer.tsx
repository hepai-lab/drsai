import { useCallback, useState, type ReactNode } from "react";

export interface ResultsContainerController {
  scopeRequestKey: number;
  requestWorkspaceScope: () => void;
}

/** Owns result-library refresh requests separately from navigation state. */
export function useResultsContainerController(): ResultsContainerController {
  const [scopeRequestKey, setScopeRequestKey] = useState(0);
  const requestWorkspaceScope = useCallback(() => setScopeRequestKey((current) => current + 1), []);
  return { scopeRequestKey, requestWorkspaceScope };
}

export function ResultsContainer({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
