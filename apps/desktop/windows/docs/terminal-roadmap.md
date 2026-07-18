# Right Sidebar Terminal Roadmap

This document defines the staged plan for the right sidebar terminal in the
OpenDrSai Windows desktop app.

## Version 1: Embedded Terminal

Goal: make the terminal usable as a first-class right sidebar panel.

Core capabilities:

- Show a `Terminal` tab in the existing right sidebar, next to Files, Overview,
  History, and Templates.
- Start a real Windows PowerShell session through a PTY.
- Render terminal input, output, cursor, scrollback, and ANSI sequences through
  xterm.
- Start in the active workspace directory when available.
- Resize the terminal when the app window or right sidebar width changes.
- Support clearing and restarting the terminal from the title bar.
- Support right-click paste when no text is selected.
- Support selecting text and copying it with `Ctrl+C`.
- Support right-click copy when text is selected.
- Keep `Ctrl+C` as a shell interrupt when no text is selected.
- Show a lightweight `Copied` notice in the terminal title bar after successful
  copy.
- Clear the terminal selection after copy.
- Clean up PTY processes when the desktop app exits.
- Show actionable startup errors when the terminal main-process IPC is not
  available or the shell cannot start.

Acceptance:

- A user can open the right sidebar Terminal tab, run PowerShell commands, copy
  output, paste commands, resize the panel, and restart the terminal.
- The app does not leave orphaned terminal processes after quit.

## Version 2: Workspace Terminal

Goal: make the terminal project-aware rather than just embedded.

Core capabilities:

- Bind terminal sessions to workspaces.
- Preserve terminal sessions when switching right sidebar tabs.
- Switch or recreate terminal sessions when switching workspaces.
- Support multiple terminal sessions per workspace.
- Provide terminal tabs, for example `Terminal 1`, `Terminal 2`, and `+`.
- Allow renaming terminal sessions.
- Display session metadata such as current shell, PID, cwd, and running state.
- Add a terminal context menu with Copy, Paste, Clear, Restart, and Kill.
- Support additional shortcuts:
  - `Ctrl+Shift+C` for copy.
  - `Ctrl+Shift+V` for paste.
  - `Ctrl+L` for clear.
- Support opening the current workspace folder in the terminal.
- Improve startup and runtime error states for missing PTY dependencies,
  unavailable PowerShell, missing cwd, and crashed sessions.
- Add basic terminal output search.

Acceptance:

- A user can keep long-running terminal sessions alive while navigating the app.
- A user can manage multiple workspace-specific terminal sessions without losing
  context.

## Version 3: Agent Terminal

Goal: make the terminal part of the agent workflow.

Core capabilities:

- Let the agent propose shell commands for the active workspace.
- Require user confirmation before the agent runs a command in the terminal.
- Classify command risk:
  - Read-only commands can be approved quickly.
  - File writes, installs, network calls, and process management require clear
    confirmation.
  - Destructive commands require stronger confirmation or are blocked.
- Show command previews before execution.
- Execute approved commands in a visible terminal session.
- Link terminal commands and output back to the related chat or agent run.
- Allow sending selected terminal output to the agent for debugging or summary.
- Summarize command results as chat cards.
- Track long-running task state: running, succeeded, failed, stopped.
- Allow stopping agent-started terminal tasks.
- Persist recent command history per workspace.
- Support additional shells such as PowerShell 7, Windows PowerShell, CMD, Git
  Bash, and WSL when available.

Acceptance:

- A user can move from chat to command preview to terminal execution to result
  analysis without manually copying logs between surfaces.
- The agent never runs high-risk commands invisibly or without explicit user
  approval.

## Current Implementation Status

The current implementation covers the planned Version 1, Version 2, and Version
3 scope. Version 3 includes command preview, risk classification, explicit
confirmation, visible terminal execution, stoppable runs, result tracking,
workspace-persisted command/run history, selected terminal output sent into
Agent Run, command blocks extracted from agent output into the terminal preview
flow, terminal command results attached to Chat as result cards, and selectable
shell profiles.
