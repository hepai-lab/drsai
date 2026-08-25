/**
 * Workspace switcher (2.5), history list (2.2), new conversation (2.1) and the
 * profile panel (2.4).
 *
 * The archived toggle is two lists rather than one with a filter, because the
 * gateway's `archived` query parameter filters and has no "both" value -- see
 * `SessionListQuery` in `wire.ts`.  A tab is the honest UI for that.
 */

import React, { useState } from "react";
import type { AuthSummary, SessionSummary, WorkspaceSummary } from "../../../../api/desktopBridge";

interface SidebarProps {
  workspaces: WorkspaceSummary[];
  workspaceId: string | null;
  sessions: SessionSummary[];
  sessionId: string | null;
  showArchived: boolean;
  auth: AuthSummary | null;
  onSelectWorkspace(workspaceId: string): void;
  onOpenWorkspace(path: string): void;
  onSelectSession(sessionId: string): void;
  onCreateSession(): void;
  onRenameSession(sessionId: string, title: string): void;
  onArchiveSession(sessionId: string, archived: boolean): void;
  onShowArchived(value: boolean): void;
  onSignIn(): void;
  onSignOut(): void;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [path, setPath] = useState("");

  const commitRename = (sessionId: string): void => {
    const title = draft.trim();
    setRenaming(null);
    if (title) props.onRenameSession(sessionId, title);
  };

  return (
    <aside className="wb-sidebar">
      <section className="wb-sidebar-section">
        <label className="wb-label" htmlFor="wb-workspace">
          Workspace
        </label>
        <select
          id="wb-workspace"
          className="wb-select"
          value={props.workspaceId ?? ""}
          onChange={(event) => props.onSelectWorkspace(event.target.value)}
        >
          {props.workspaces.length ? null : <option value="">No workspace open</option>}
          {props.workspaces.map((workspace) => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.displayName}
            </option>
          ))}
        </select>
        <form
          className="wb-open-workspace"
          onSubmit={(event) => {
            event.preventDefault();
            const value = path.trim();
            if (!value) return;
            props.onOpenWorkspace(value);
            setPath("");
          }}
        >
          {/* A path field rather than a directory picker: the picker is an
              Electron dialog, and adding it would put a twentieth method on a
              bridge whose whole point is that it has nineteen. */}
          <input
            className="wb-input"
            value={path}
            placeholder="Open a folder by path"
            onChange={(event) => setPath(event.target.value)}
          />
        </form>
      </section>

      <section className="wb-sidebar-section wb-sidebar-grow">
        <div className="wb-sidebar-header">
          <span className="wb-label">Conversations</span>
          <button type="button" className="wb-button wb-button-small" onClick={props.onCreateSession}>
            New
          </button>
        </div>
        <div className="wb-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!props.showArchived}
            className="wb-tab"
            onClick={() => props.onShowArchived(false)}
          >
            Active
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.showArchived}
            className="wb-tab"
            onClick={() => props.onShowArchived(true)}
          >
            Archived
          </button>
        </div>
        <ul className="wb-session-list">
          {props.sessions.map((session) => (
            <li
              key={session.sessionId}
              className="wb-session"
              data-selected={session.sessionId === props.sessionId || undefined}
            >
              {renaming === session.sessionId ? (
                <input
                  className="wb-input"
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(session.sessionId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(session.sessionId);
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="wb-session-title"
                  onClick={() => props.onSelectSession(session.sessionId)}
                  onDoubleClick={() => {
                    setRenaming(session.sessionId);
                    setDraft(session.title);
                  }}
                >
                  {session.title || "Untitled"}
                </button>
              )}
              <button
                type="button"
                className="wb-button wb-button-ghost"
                title={session.archived ? "Restore" : "Archive"}
                onClick={() => props.onArchiveSession(session.sessionId, !session.archived)}
              >
                {session.archived ? "Restore" : "Archive"}
              </button>
            </li>
          ))}
          {props.sessions.length ? null : (
            <li className="wb-muted wb-empty">
              {props.showArchived ? "Nothing archived." : "No conversations yet."}
            </li>
          )}
        </ul>
      </section>

      <section className="wb-sidebar-section wb-profile">
        {props.auth?.signedIn ? (
          <>
            <div className="wb-profile-name">{props.auth.displayName ?? props.auth.userId}</div>
            <div className="wb-muted">{props.auth.email}</div>
            <button type="button" className="wb-button wb-button-small" onClick={props.onSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            {/* Signed out is a working state, not a blocked one: sessions, files
                and history all work. Only model calls need an identity. */}
            <div className="wb-muted">Signed out — model replies need an account.</div>
            <button type="button" className="wb-button wb-button-small" onClick={props.onSignIn}>
              Sign in
            </button>
          </>
        )}
      </section>
    </aside>
  );
}
