import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

interface TerminalPanelProps {
  cwd?: string;
  language: AppLanguage;
}

export function TerminalPanel({
  cwd,
  language: _language,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const restartNonceRef = useRef(0);
  const [restartNonce, setRestartNonce] = useState(0);
  const [status, setStatus] = useState("Starting...");
  const [title, setTitle] = useState("PowerShell");
  const [copyNotice, setCopyNotice] = useState("");

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const sessionId = sessionIdRef.current;
    if (!terminal || !fitAddon) return;
    fitAddon.fit();
    if (sessionId) {
      void desktopApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#0f1115",
        foreground: "#d7dde8",
        cursor: "#ffffff",
        selectionBackground: "#31415f",
      },
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "c" &&
        terminal.hasSelection()
      ) {
        void copySelection();
        return false;
      }
      return true;
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(container);

    async function pasteClipboard(): Promise<void> {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          await desktopApi.writeTerminal(sessionId, text);
          terminal.focus();
        }
      } catch {
        terminal.writeln("");
        terminal.writeln("Clipboard paste is not available. Use Ctrl+V instead.");
      }
    }

    async function copySelection(): Promise<void> {
      const selectedText = terminal.getSelection();
      if (!selectedText) return;
      try {
        await navigator.clipboard.writeText(selectedText);
        terminal.clearSelection();
        setCopyNotice("Copied");
        window.setTimeout(() => setCopyNotice(""), 900);
        terminal.focus();
      } catch {
        terminal.writeln("");
        terminal.writeln("Clipboard copy is not available.");
      }
    }

    function handleContextMenu(event: MouseEvent): void {
      event.preventDefault();
      if (terminal.hasSelection()) {
        void copySelection();
      } else {
        void pasteClipboard();
      }
    }

    container.addEventListener("contextmenu", handleContextMenu);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void desktopApi.writeTerminal(sessionId, data);
      }
    });

    const cleanupData = desktopApi.onTerminalData(({ id, data }) => {
      if (id === sessionIdRef.current) terminal.write(data);
    });
    const cleanupExit = desktopApi.onTerminalExit(({ id, exitCode }) => {
      if (id !== sessionIdRef.current) return;
      sessionIdRef.current = null;
      setStatus(`Exited (${exitCode})`);
      terminal.writeln("");
      terminal.writeln(`Process exited with code ${exitCode}.`);
    });

    let disposed = false;

    async function start(): Promise<void> {
      setStatus("Starting...");
      terminal.clear();
      fitAddon.fit();
      try {
        const session = await desktopApi.createTerminal({
          cols: terminal.cols,
          rows: terminal.rows,
          cwd,
        });
        if (disposed) {
          await desktopApi.killTerminal(session.id);
          return;
        }
        sessionIdRef.current = session.id;
        setTitle(
          session.shell.toLowerCase().includes("pwsh")
            ? "PowerShell 7"
            : "PowerShell",
        );
        setStatus(`PID ${session.pid}`);
        terminal.focus();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus("Failed");
        if (
          message.includes(
            "No handler registered for 'desktop:terminal-create'",
          )
        ) {
          terminal.writeln(
            "Failed to start terminal: the desktop main process has not loaded terminal IPC yet. Quit and restart OpenDrSai.",
          );
        } else {
          terminal.writeln(`Failed to start terminal: ${message}`);
        }
      }
    }

    void start();

    return () => {
      disposed = true;
      container.removeEventListener("contextmenu", handleContextMenu);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      cleanupData();
      cleanupExit();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void desktopApi.killTerminal(sessionId);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, fitAndResize, restartNonce]);

  const restart = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      await desktopApi.killTerminal(sessionId);
      sessionIdRef.current = null;
    }
    restartNonceRef.current += 1;
    setRestartNonce(restartNonceRef.current);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  return (
    <div className="terminal-side-panel">
      <div className="terminal-side-header">
        <div>
          <strong>{title}</strong>
          <span>{status}</span>
        </div>
        <div className="terminal-side-actions">
          {copyNotice && <span className="terminal-copy-notice">{copyNotice}</span>}
          <button type="button" onClick={restart} title="Restart terminal">
            <RotateCcw size={15} />
          </button>
          <button type="button" onClick={clear} title="Clear terminal">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="terminal-side-cwd" title={cwd}>
        {cwd || "Default user directory"}
      </div>
      <div className="terminal-side-body" ref={containerRef} />
    </div>
  );
}
