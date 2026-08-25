/**
 * The whole desktop, in one layout: sidebar, conversation, files.
 *
 * Eleven features, three panes.  Nothing here fetches; `useDesktop` owns the
 * request/response state and `useSessionStream` owns the folded stream, so this
 * component's job is composition and the handful of decisions that need both --
 * chiefly when to refresh the file tree.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { FilePane } from "./components/FilePane";
import { Sidebar } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { useDesktop } from "./useDesktop";
import { useSessionStream } from "./useSessionStream";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export default function App(): React.JSX.Element {
  const [state, actions] = useDesktop();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const stream = useSessionStream(sessionId);
  const [filesToken, setFilesToken] = useState(0);
  const lastRunStatus = useRef<string | null>(null);

  // Selecting a workspace invalidates the open conversation: a session belongs
  // to exactly one workspace, and leaving it selected would stream a
  // conversation the sidebar no longer lists.
  useEffect(() => {
    setSessionId(null);
  }, [state.workspaceId]);

  // The agent writes files during a turn, so the tree is stale exactly once per
  // run -- when it settles. Refreshing on that edge costs one directory walk per
  // turn; a timer would cost one per interval to usually find nothing.
  useEffect(() => {
    const status = stream.activeRun?.status ?? stream.runs[stream.runs.length - 1]?.status ?? null;
    if (
      lastRunStatus.current &&
      lastRunStatus.current !== status &&
      status &&
      TERMINAL_RUN_STATUSES.has(status)
    ) {
      setFilesToken((value) => value + 1);
    }
    lastRunStatus.current = status;
  }, [stream.runs, stream.activeRun]);

  const streaming = useMemo(
    () => stream.entries.some((entry) => entry.streaming),
    [stream.entries],
  );

  const banner = describeBanner(state, stream);

  return (
    <div className="wb-app">
      <Sidebar
        workspaces={state.workspaces}
        workspaceId={state.workspaceId}
        sessions={state.sessions}
        sessionId={sessionId}
        showArchived={state.showArchived}
        auth={state.auth}
        onSelectWorkspace={actions.selectWorkspace}
        onOpenWorkspace={(path) => void actions.openWorkspace(path)}
        onSelectSession={setSessionId}
        onCreateSession={() =>
          void actions.createSession().then((session) => {
            if (session) setSessionId(session.sessionId);
          })
        }
        onRenameSession={(id, title) => void actions.renameSession(id, title)}
        onArchiveSession={(id, archived) => {
          void actions.archiveSession(id, archived);
          if (id === sessionId) setSessionId(null);
        }}
        onShowArchived={actions.setShowArchived}
        onSignIn={() => void actions.signIn()}
        onSignOut={() => void actions.signOut()}
      />

      <main className="wb-main">
        {banner ? (
          <div className="wb-banner" data-level={banner.level}>
            <span>{banner.message}</span>
            {banner.level === "error" ? (
              <button type="button" className="wb-button wb-button-small" onClick={() => void actions.retryRuntime()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <Transcript entries={stream.entries} streaming={streaming} />

        <Composer
          sessionId={sessionId}
          models={state.models}
          modelAlias={state.modelAlias}
          onModelChange={actions.setModelAlias}
          activeRunId={stream.activeRun?.runId ?? null}
          speechToTextReady={Boolean(state.runtime?.speechToTextReady)}
          disabled={!state.runtime?.reachable}
        />
      </main>

      <FilePane workspaceId={state.workspaceId} refreshToken={filesToken} />
    </div>
  );
}

/**
 * One banner, chosen by severity.
 *
 * Stacking every condition would put three bars above a conversation that is
 * working. The order below is the order in which a condition stops the user from
 * doing anything: an unreachable Runtime beats a dead stream, which beats a
 * reconnect the user does not need to act on.
 */
function describeBanner(
  state: ReturnType<typeof useDesktop>[0],
  stream: ReturnType<typeof useSessionStream>,
): { level: "info" | "warning" | "error"; message: string } | null {
  if (state.loading) return { level: "info", message: "Starting OpenDrSai…" };
  if (!state.runtime?.reachable) {
    return { level: "error", message: state.error ?? "The OpenDrSai Runtime is not responding." };
  }
  if (stream.fatal) {
    return { level: "error", message: stream.error ?? "This conversation cannot be streamed." };
  }
  if (stream.phase === "degraded") {
    return { level: "error", message: "The live connection stopped. Reopen this conversation." };
  }
  if (stream.phase === "retrying") {
    return { level: "warning", message: "Reconnecting to the conversation…" };
  }
  if (state.error) return { level: "warning", message: state.error };
  return null;
}
