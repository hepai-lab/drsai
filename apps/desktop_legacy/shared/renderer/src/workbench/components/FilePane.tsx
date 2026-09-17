/**
 * Workspace tree (2.3) and file preview (4.1).
 *
 * The tree refreshes when a run finishes, not on a timer: the agent writes files
 * as part of a turn, so the only moment the tree is reliably stale is the moment
 * a run reaches a terminal status.  Polling would spend a directory walk per
 * interval to notice nothing had changed.
 *
 * Preview has exactly two branches because the gateway gives it exactly two
 * shapes: UTF-8 text, or a `data:` URL for anything that did not decode.  There
 * is no content-type table here, and there should not be one -- the server
 * already made that decision with the bytes in hand.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { WorkspaceFileContent, WorkspaceFileNode } from "../../../../api/desktopGateway";
import { attempt, bridge, describeFailure } from "../bridge";

interface FilePaneProps {
  workspaceId: string | null;
  /** Bumped when a run settles, to trigger a refresh. */
  refreshToken: number;
}

export function FilePane({ workspaceId, refreshToken }: FilePaneProps): React.JSX.Element {
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([]);
  const [flat, setFlat] = useState(false);
  const [query, setQuery] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkspaceFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setNodes([]);
      return;
    }
    const { value, error: failure } = await attempt(
      bridge().workspaces.files({ workspaceId, depth: 2, query: query.trim() || undefined }),
    );
    if (failure) {
      setError(describeFailure(failure));
      return;
    }
    setError(null);
    setNodes(value.nodes);
    setFlat(value.flat);
    setTruncated(value.truncated);
  }, [workspaceId, query]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const open = async (path: string): Promise<void> => {
    if (!workspaceId) return;
    setSelected(path);
    const { value, error: failure } = await attempt(
      bridge().workspaces.readFile({ workspaceId, path }),
    );
    if (failure) {
      setError(describeFailure(failure));
      setPreview(null);
      return;
    }
    setError(null);
    setPreview(value);
  };

  return (
    <aside className="wb-files">
      <input
        className="wb-input"
        value={query}
        placeholder="Filter files"
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <div className="wb-notice" data-level="error">{error}</div> : null}
      <div className="wb-file-tree">
        {nodes.map((node) => (
          <FileRow key={node.path} node={node} depth={0} flat={flat} selected={selected} onOpen={open} />
        ))}
        {truncated ? <div className="wb-muted wb-empty">Listing truncated.</div> : null}
        {nodes.length ? null : <div className="wb-muted wb-empty">No files.</div>}
      </div>
      {preview ? <Preview file={preview} /> : null}
    </aside>
  );
}

function FileRow({
  node,
  depth,
  flat,
  selected,
  onOpen,
}: {
  node: WorkspaceFileNode;
  depth: number;
  flat: boolean;
  selected: string | null;
  onOpen(path: string): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  return (
    <>
      <div
        className="wb-file-row"
        style={{ paddingLeft: `${(flat ? 0 : depth) * 12 + 4}px` }}
        data-selected={node.path === selected || undefined}
        data-git={node.git_status}
      >
        <button
          type="button"
          className="wb-file-name"
          onClick={() => (node.directory ? setOpen((value) => !value) : onOpen(node.path))}
        >
          {node.directory ? (open ? "▾ " : "▸ ") : ""}
          {flat ? node.path : node.name}
        </button>
        {node.git_status ? <span className="wb-git-badge">{node.git_status[0].toUpperCase()}</span> : null}
      </div>
      {open && node.children
        ? node.children.map((child) => (
            <FileRow
              key={child.path}
              node={child}
              depth={depth + 1}
              flat={flat}
              selected={selected}
              onOpen={onOpen}
            />
          ))
        : null}
    </>
  );
}

function Preview({ file }: { file: WorkspaceFileContent }): React.JSX.Element {
  return (
    <div className="wb-preview">
      <header className="wb-preview-header">
        <code>{file.path}</code>
        <span className="wb-muted">
          {file.mime} · {formatSize(file.size)}
          {file.truncated ? " · truncated" : ""}
        </span>
      </header>
      {file.binary ? (
        file.mime.startsWith("image/") ? (
          <img className="wb-preview-image" src={file.data_url} alt={file.path} />
        ) : (
          <div className="wb-muted wb-empty">Binary file — no preview.</div>
        )
      ) : (
        <pre className="wb-preview-text">{file.content}</pre>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
