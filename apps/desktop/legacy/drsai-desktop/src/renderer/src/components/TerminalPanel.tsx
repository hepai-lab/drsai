import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  onClose: () => void;
}

export default function TerminalPanel({
  onClose,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startNonceRef = useRef(0);
  const [title, setTitle] = useState("PowerShell");
  const [status, setStatus] = useState("Starting...");
  const [startNonce, setStartNonce] = useState(0);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const sessionId = sessionIdRef.current;
    if (!terminal || !fitAddon) return;

    fitAddon.fit();
    if (sessionId) {
      window.drsaiAPI.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--font-mono), Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#0f1115",
        foreground: "#d7dde8",
        cursor: "#f8fafc",
        selectionBackground: "#31415f",
        black: "#111827",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#f59e0b",
        blue: "#60a5fa",
        magenta: "#d946ef",
        cyan: "#06b6d4",
        white: "#e5e7eb",
        brightBlack: "#4b5563",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#fbbf24",
        brightBlue: "#93c5fd",
        brightMagenta: "#e879f9",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        window.drsaiAPI.writeTerminal(sessionId, data);
      }
    });

    const cleanupData = window.drsaiAPI.onTerminalData(({ id, data }) => {
      if (id === sessionIdRef.current) {
        terminal.write(data);
      }
    });

    const cleanupExit = window.drsaiAPI.onTerminalExit(({ id, exitCode }) => {
      if (id === sessionIdRef.current) {
        sessionIdRef.current = null;
        setStatus(`Exited (${exitCode})`);
        terminal.writeln("");
        terminal.writeln(`Process exited with code ${exitCode}.`);
      }
    });

    let disposed = false;

    async function start(): Promise<void> {
      setStatus("Starting...");
      terminal.clear();
      fitAddon.fit();
      try {
        const session = await window.drsaiAPI.createTerminal({
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          await window.drsaiAPI.killTerminal(session.id);
          return;
        }
        sessionIdRef.current = session.id;
        setTitle(
          session.shell.includes("pwsh") ? "PowerShell 7" : "PowerShell",
        );
        setStatus(`PID ${session.pid}`);
        terminal.focus();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus("Failed");
        terminal.writeln(`Failed to start terminal: ${message}`);
      }
    }

    start();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      cleanupData();
      cleanupExit();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        window.drsaiAPI.killTerminal(sessionId);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitAndResize, startNonce]);

  const restart = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      await window.drsaiAPI.killTerminal(sessionId);
      sessionIdRef.current = null;
    }
    startNonceRef.current += 1;
    setStartNonce(startNonceRef.current);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <header className="terminal-panel-header">
        <div className="terminal-panel-title">
          <span>{title}</span>
          <small>{status}</small>
        </div>
        <div className="terminal-panel-actions">
          <button type="button" onClick={restart} title="Restart terminal">
            <RotateCcw size={15} />
          </button>
          <button type="button" onClick={clear} title="Clear terminal">
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={onClose} title="Close terminal">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="terminal-panel-body" ref={containerRef} />
    </section>
  );
}
