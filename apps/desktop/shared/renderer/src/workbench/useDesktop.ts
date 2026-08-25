/**
 * The non-streaming half of the renderer's state: runtime, identity, workspaces,
 * sessions and the model catalog.
 *
 * Everything here is request/response.  The streaming half lives in
 * `useSessionStream`, and the split is not cosmetic: this state is refetched, that
 * state is folded, and mixing the two produces a component that re-runs a network
 * request every time a token arrives.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  AuthSummary,
  ModelCatalogEntry,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary,
} from "../../../api/desktopBridge";
import { attempt, bridge, describeFailure } from "./bridge";

export interface DesktopState {
  runtime: RuntimeSummary | null;
  auth: AuthSummary | null;
  workspaces: WorkspaceSummary[];
  workspaceId: string | null;
  sessions: SessionSummary[];
  showArchived: boolean;
  models: ModelCatalogEntry[];
  modelAlias: string | null;
  loading: boolean;
  error: string | null;
}

export interface DesktopActions {
  selectWorkspace(workspaceId: string): void;
  openWorkspace(path: string): Promise<void>;
  refreshSessions(): Promise<void>;
  createSession(): Promise<SessionSummary | null>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  setShowArchived(value: boolean): void;
  setModelAlias(alias: string): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  retryRuntime(): Promise<void>;
}

/** How often to re-probe while the Runtime is still coming up. */
const RUNTIME_POLL_MS = 2_000;

export function useDesktop(): [DesktopState, DesktopActions] {
  const [runtime, setRuntime] = useState<RuntimeSummary | null>(null);
  const [auth, setAuth] = useState<AuthSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [modelAlias, setModelAlias] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuntime = useCallback(async () => {
    const { value, error: failure } = await attempt(bridge().runtime.identity());
    if (failure) {
      setError(describeFailure(failure));
      return null;
    }
    setRuntime(value);
    return value;
  }, []);

  // Poll only while unreachable. A Runtime that is up needs no heartbeat from
  // here -- the event stream is the liveness signal once a session is open.
  useEffect(() => {
    if (runtime?.reachable) return undefined;
    const timer = setInterval(() => void loadRuntime(), RUNTIME_POLL_MS);
    return () => clearInterval(timer);
  }, [runtime?.reachable, loadRuntime]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const identity = await loadRuntime();
      if (cancelled) return;
      const [session, workspaceList, catalog] = await Promise.all([
        attempt(bridge().auth.session()),
        attempt(bridge().workspaces.list()),
        attempt(bridge().models.catalog()),
      ]);
      if (cancelled) return;
      if (session.value) setAuth(session.value);
      if (workspaceList.value) {
        setWorkspaces(workspaceList.value);
        // Prefer the most recently opened workspace: it is the one the user was
        // last working in, which is a better guess than the first row.
        const preferred = [...workspaceList.value].sort((left, right) =>
          (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""),
        )[0];
        setWorkspaceId((current) => current ?? preferred?.workspaceId ?? null);
      }
      if (catalog.value) {
        setModels(catalog.value.models);
        setModelAlias((current) => current ?? catalog.value.defaultAlias ?? catalog.value.models[0]?.alias ?? null);
      }
      if (identity && !identity.reachable) {
        setError("The OpenDrSai Runtime is still starting.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRuntime]);

  const refreshSessions = useCallback(async () => {
    if (!workspaceId) {
      setSessions([]);
      return;
    }
    const { value, error: failure } = await attempt(
      bridge().sessions.list({ workspaceId, archived: showArchived, limit: 100 }),
    );
    if (failure) {
      setError(describeFailure(failure));
      return;
    }
    setSessions(value);
  }, [workspaceId, showArchived]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const actions: DesktopActions = {
    selectWorkspace: (id) => setWorkspaceId(id),
    openWorkspace: async (path) => {
      const { value, error: failure } = await attempt(bridge().workspaces.open({ path }));
      if (failure) {
        setError(describeFailure(failure));
        return;
      }
      setWorkspaces((current) => {
        const rest = current.filter((entry) => entry.workspaceId !== value.workspaceId);
        return [value, ...rest];
      });
      setWorkspaceId(value.workspaceId);
    },
    refreshSessions,
    createSession: async () => {
      if (!workspaceId) return null;
      const { value, error: failure } = await attempt(
        bridge().sessions.create({ workspaceId, title: "New session" }),
      );
      if (failure) {
        setError(describeFailure(failure));
        return null;
      }
      setSessions((current) => [value, ...current]);
      return value;
    },
    renameSession: async (sessionId, title) => {
      const { value, error: failure } = await attempt(bridge().sessions.rename({ sessionId, title }));
      if (failure) {
        setError(describeFailure(failure));
        return;
      }
      setSessions((current) =>
        current.map((entry) => (entry.sessionId === sessionId ? value : entry)),
      );
    },
    archiveSession: async (sessionId, archived) => {
      const { error: failure } = await attempt(bridge().sessions.archive({ sessionId, archived }));
      if (failure) {
        setError(describeFailure(failure));
        return;
      }
      // The row leaves the current list either way: this list is filtered by the
      // archived flag, so a session that just changed it no longer belongs here.
      setSessions((current) => current.filter((entry) => entry.sessionId !== sessionId));
    },
    setShowArchived,
    setModelAlias: (alias) => setModelAlias(alias),
    signIn: async () => {
      const { value, error: failure } = await attempt(bridge().auth.login());
      if (failure) {
        setError(describeFailure(failure));
        return;
      }
      setAuth(value);
      // Signing in changes what the Runtime will do for us -- speech-to-text
      // becomes available, and model calls start using the user's account.
      await loadRuntime();
    },
    signOut: async () => {
      const { value } = await attempt(bridge().auth.logout());
      if (value) setAuth(value);
      await loadRuntime();
    },
    retryRuntime: async () => {
      setError(null);
      await loadRuntime();
    },
  };

  return [
    { runtime, auth, workspaces, workspaceId, sessions, showArchived, models, modelAlias, loading, error },
    actions,
  ];
}
