/**
 * DrSai Desktop — Slash commands
 *
 * Commands that start with / are intercepted by the chat input.
 * "local" commands are handled by the frontend; others are sent to the backend.
 */
export interface SlashCommand {
  name: string;
  description: string;
  category: "session" | "display" | "config" | "info";
  /** If true, the command is handled locally instead of sent to the backend */
  local?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Session ──────────────────────────────────────────────────────────────
  {
    name: "/new",
    description: "Create a new session",
    category: "session",
    local: true,
  },
  {
    name: "/list",
    description: "List all saved sessions",
    category: "session",
  },
  {
    name: "/switch",
    description: "Switch to another session",
    category: "session",
  },
  {
    name: "/rename",
    description: "Rename the current session",
    category: "session",
  },
  {
    name: "/clear",
    description: "Clear screen and start fresh",
    category: "session",
    local: true,
  },
  {
    name: "/retry",
    description: "Retry the last message",
    category: "session",
    local: true,
  },
  {
    name: "/resume",
    description: "Resume a previous session",
    category: "session",
  },
  {
    name: "/search",
    description: "Search your past sessions",
    category: "session",
  },
  {
    name: "/copy",
    description: "Copy last assistant reply to clipboard",
    category: "session",
    local: true,
  },

  // ── Display ──────────────────────────────────────────────────────────────
  {
    name: "/reasoning",
    description: "Toggle or tune reasoning display (show|hide|off|low|medium|high)",
    category: "display",
  },
  {
    name: "/fast",
    description: "Switch to the fastest model alias",
    category: "display",
  },
  {
    name: "/usage",
    description: "Show token usage and cost",
    category: "display",
  },

  // ── Configuration ────────────────────────────────────────────────────────
  {
    name: "/model",
    description: "Show or switch model: /model [name|info]",
    category: "config",
  },
  {
    name: "/config",
    description: "Show current configuration",
    category: "config",
  },
  {
    name: "/status",
    description: "Show agent and session status",
    category: "config",
  },
  {
    name: "/tools",
    description: "List available tools",
    category: "config",
  },
  {
    name: "/skills",
    description: "List installed skills",
    category: "config",
    local: true,
  },
  {
    name: "/setup",
    description: "Open setup to change API configuration",
    category: "config",
    local: true,
  },
  {
    name: "/memory",
    description: "Show agent memory entries",
    category: "config",
    local: true,
  },
  {
    name: "/persona",
    description: "Show current persona configuration",
    category: "config",
    local: true,
  },
  {
    name: "/version",
    description: "Show DrSai and desktop app versions",
    category: "config",
    local: true,
  },

  // ── Info ─────────────────────────────────────────────────────────────────
  {
    name: "/help",
    description: "Show available commands and help",
    category: "info",
    local: true,
  },
];
