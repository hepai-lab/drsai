import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";

interface ToolEntry {
  index: number;
  type: string;
  config: Record<string, unknown>;
  name?: string | null;
  enabled?: boolean;
}

interface ToolsProps {
  profile?: string;
}

type ToolType = "mcp-std" | "mcp-sse" | "local";

interface ToolDraft {
  type: ToolType;
  name: string;
  enabled: boolean;
  // mcp-std
  command: string;
  args: string;
  // mcp-sse
  url: string;
  headers: string;
  // local
  description: string;
}

const EMPTY_DRAFT: ToolDraft = {
  type: "mcp-std",
  name: "",
  enabled: true,
  command: "",
  args: "",
  url: "",
  headers: "",
  description: "",
};

function entryToDraft(entry: ToolEntry): ToolDraft {
  const cfg = entry.config || {};
  const t = entry.type as ToolType;
  return {
    type: t === "mcp-std" || t === "mcp-sse" ? t : "local",
    name: entry.name || (cfg.name as string) || "",
    enabled: entry.enabled !== false,
    command: (cfg.command as string) || "",
    args: Array.isArray(cfg.args) ? (cfg.args as string[]).join(" ") : "",
    url: (cfg.url as string) || "",
    headers: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    description:
      t === "mcp-std" || t === "mcp-sse"
        ? ""
        : typeof cfg === "string"
          ? cfg
          : JSON.stringify(cfg, null, 2),
  };
}

function draftToEntry(draft: ToolDraft): {
  type: string;
  config: Record<string, unknown>;
  name?: string;
  enabled: boolean;
} {
  const base = {
    name: draft.name || undefined,
    enabled: draft.enabled,
  };
  if (draft.type === "mcp-std") {
    return {
      ...base,
      type: "mcp-std",
      config: {
        command: draft.command.trim(),
        args: draft.args.trim() ? draft.args.trim().split(/\s+/) : [],
      },
    };
  }
  if (draft.type === "mcp-sse") {
    let headers: Record<string, string> | undefined;
    if (draft.headers.trim()) {
      try {
        headers = JSON.parse(draft.headers);
      } catch {
        headers = undefined;
      }
    }
    return {
      ...base,
      type: "mcp-sse",
      config: {
        url: draft.url.trim(),
        ...(headers ? { headers } : {}),
      },
    };
  }
  // local — free-form description string in config.description
  return {
    ...base,
    type: "local",
    config: { description: draft.description.trim() },
  };
}

function describeEntry(entry: ToolEntry): string {
  const cfg = entry.config || {};
  if (entry.type === "mcp-std") {
    const args = Array.isArray(cfg.args) ? (cfg.args as string[]).join(" ") : "";
    return `${(cfg.command as string) || ""} ${args}`.trim();
  }
  if (entry.type === "mcp-sse") {
    return (cfg.url as string) || "";
  }
  const d = (cfg.description as string) || "";
  return d.length > 120 ? d.slice(0, 120) + "…" : d;
}

function Tools(_props: ToolsProps): React.JSX.Element {
  const { t } = useI18n();
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ToolDraft | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.drsaiAPI.listTools();
      setTools(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate(): void {
    setEditingIndex(null);
    setEditing({ ...EMPTY_DRAFT });
  }

  function openEdit(entry: ToolEntry): void {
    setEditingIndex(entry.index);
    setEditing(entryToDraft(entry));
  }

  async function handleSave(): Promise<void> {
    if (!editing) return;
    const payload = draftToEntry(editing);
    try {
      if (editingIndex === null) {
        await window.drsaiAPI.createTool(payload);
      } else {
        await window.drsaiAPI.updateTool(editingIndex, payload);
      }
      setEditing(null);
      setEditingIndex(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(entry: ToolEntry): Promise<void> {
    if (!confirm(`Remove tool "${entry.name || entry.type}"?`)) return;
    try {
      await window.drsaiAPI.deleteTool(entry.index);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleEnabled(entry: ToolEntry): Promise<void> {
    try {
      await window.drsaiAPI.updateTool(entry.index, {
        type: entry.type,
        config: entry.config,
        name: entry.name ?? undefined,
        enabled: entry.enabled === false,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="tools-container">
        <div className="tools-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="tools-container">
      <div className="tools-header">
        <h2 className="tools-title">{t("tools.title")}</h2>
        <p className="tools-subtitle">
          MCP servers and local-tool descriptions stored in <code>TOOLS_CONFIG.json</code>.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button className="btn-primary" onClick={openCreate}>
          + Add tool
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "var(--error)",
            marginBottom: 12,
            padding: 8,
            border: "1px solid var(--error)",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {tools.length === 0 && !editing && (
        <div className="tools-empty" style={{ opacity: 0.7, padding: 24 }}>
          No tools configured. Click <strong>Add tool</strong> to register an MCP server
          (stdio or SSE) or describe a local tool.
        </div>
      )}

      <div className="tools-grid">
        {tools.map((entry) => (
          <div
            key={entry.index}
            className={`tools-card ${entry.enabled === false ? "tools-card-disabled" : "tools-card-enabled"}`}
          >
            <div className="tools-card-top">
              <div className="tools-card-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="20" height="8" rx="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" />
                  <circle cx="6" cy="6" r="1" />
                  <circle cx="6" cy="18" r="1" />
                </svg>
              </div>
              <label
                className="tools-toggle"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={entry.enabled !== false}
                  onChange={() => handleToggleEnabled(entry)}
                />
                <span className="tools-toggle-track" />
              </label>
            </div>
            <div className="tools-card-label">
              {entry.name || `${entry.type}-${entry.index}`}
            </div>
            <div className="tools-card-description">
              <code style={{ fontSize: 11 }}>{entry.type}</code>
              <div style={{ marginTop: 4 }}>{describeEntry(entry)}</div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button
                style={{ flex: 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(entry);
                }}
              >
                Edit
              </button>
              <button
                style={{ flex: 1, color: "var(--error)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(entry);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div
          className="tools-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              background: "var(--bg-elevated, #1e1e1e)",
              padding: 24,
              borderRadius: 8,
              width: "min(640px, 90vw)",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              {editingIndex === null ? "Add tool" : `Edit tool #${editingIndex}`}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                <div style={{ marginBottom: 4 }}>Type</div>
                <select
                  value={editing.type}
                  onChange={(e) =>
                    setEditing({ ...editing, type: e.target.value as ToolType })
                  }
                  style={{ width: "100%" }}
                >
                  <option value="mcp-std">MCP — stdio</option>
                  <option value="mcp-sse">MCP — SSE</option>
                  <option value="local">Local tool description</option>
                </select>
              </label>

              <label>
                <div style={{ marginBottom: 4 }}>Name (optional)</div>
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  style={{ width: "100%" }}
                  placeholder="my-mcp-server"
                />
              </label>

              {editing.type === "mcp-std" && (
                <>
                  <label>
                    <div style={{ marginBottom: 4 }}>Command</div>
                    <input
                      value={editing.command}
                      onChange={(e) =>
                        setEditing({ ...editing, command: e.target.value })
                      }
                      style={{ width: "100%" }}
                      placeholder="npx"
                    />
                  </label>
                  <label>
                    <div style={{ marginBottom: 4 }}>
                      Args (space-separated)
                    </div>
                    <input
                      value={editing.args}
                      onChange={(e) =>
                        setEditing({ ...editing, args: e.target.value })
                      }
                      style={{ width: "100%" }}
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    />
                  </label>
                </>
              )}

              {editing.type === "mcp-sse" && (
                <>
                  <label>
                    <div style={{ marginBottom: 4 }}>URL</div>
                    <input
                      value={editing.url}
                      onChange={(e) =>
                        setEditing({ ...editing, url: e.target.value })
                      }
                      style={{ width: "100%" }}
                      placeholder="https://example.com/mcp/sse"
                    />
                  </label>
                  <label>
                    <div style={{ marginBottom: 4 }}>Headers (JSON, optional)</div>
                    <textarea
                      value={editing.headers}
                      onChange={(e) =>
                        setEditing({ ...editing, headers: e.target.value })
                      }
                      style={{ width: "100%", minHeight: 80, fontFamily: "monospace" }}
                      placeholder='{"Authorization": "Bearer ..."}'
                    />
                  </label>
                </>
              )}

              {editing.type === "local" && (
                <label>
                  <div style={{ marginBottom: 4 }}>Description (shown to the agent)</div>
                  <textarea
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                    style={{ width: "100%", minHeight: 100, fontFamily: "monospace" }}
                    placeholder="A local CLI tool available as `my-cmd`. Usage: my-cmd [options]"
                  />
                </label>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) =>
                    setEditing({ ...editing, enabled: e.target.checked })
                  }
                />
                <span>Enabled</span>
              </label>
            </div>

            <div
              style={{
                marginTop: 20,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Tools;
