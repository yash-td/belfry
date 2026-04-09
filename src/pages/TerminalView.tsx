import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ArrowLeft, X, Loader2 } from "lucide-react";
import {
  getTerminalToken,
  useKillTerminal,
  useTerminals,
} from "@/hooks/useTerminals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type OutputMessage =
  | { type: "output"; data: string }
  | { type: "scrollback"; data: string }
  | { type: "exit"; exitCode: number; signal?: number };

export function TerminalView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: terminals } = useTerminals();
  const killTerminal = useKillTerminal();
  const terminal = terminals?.find((t) => t.id === id);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "closed" | "error"
  >("connecting");
  const [exitInfo, setExitInfo] = useState<{
    exitCode: number;
    signal?: number;
  } | null>(null);

  // Boot the xterm instance and wire it up to the WebSocket.
  // We key this effect on `id` so navigating between terminals fully rebuilds
  // the instance — xterm doesn't love being reparented.
  useEffect(() => {
    if (!id || !containerRef.current) return;
    const token = getTerminalToken(id);
    if (!token) {
      setStatus("error");
      return;
    }

    const term = new XTerm({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#3f3f46",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
      },
      scrollback: 10_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitAddonRef.current = fit;

    const wsUrl =
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}` +
      `/ws/terminal?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      // Push the initial size immediately so the shell's prompt renders at
      // the right width.
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        })
      );
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: OutputMessage;
      try {
        msg = JSON.parse(ev.data) as OutputMessage;
      } catch {
        return;
      }
      if (msg.type === "output" || msg.type === "scrollback") {
        term.write(msg.data);
      } else if (msg.type === "exit") {
        setExitInfo({ exitCode: msg.exitCode, signal: msg.signal });
        term.writeln("");
        term.writeln(
          `\x1b[2m[process exited with code ${msg.exitCode}${msg.signal ? ` signal ${msg.signal}` : ""}]\x1b[0m`
        );
      }
    };

    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");

    // Pipe keystrokes back to the PTY.
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Refit on container resize, and push the new size to the backend.
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            })
          );
        }
      } catch {
        // xterm can throw mid-teardown; ignore.
      }
    });
    resizeObserver.observe(containerRef.current);

    term.focus();

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      try {
        ws.close();
      } catch {
        // ignore
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [id]);

  async function handleClose(): Promise<void> {
    if (!id) return;
    try {
      await killTerminal.mutateAsync(id);
    } catch (err) {
      console.warn("Failed to kill terminal:", err);
    }
    navigate("/");
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <button onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
          </button>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm truncate">
              {terminal
                ? `${terminal.command} ${terminal.args.join(" ")}`.trim()
                : id}
            </span>
            <StatusBadge status={status} exited={!!exitInfo} />
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {terminal?.cwd}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleClose}>
          <X className="size-4" />
          Close
        </Button>
      </header>
      <div className="flex-1 bg-[#09090b] p-2 overflow-hidden">
        {status === "connecting" && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-4">
            <Loader2 className="size-4 animate-spin" /> Connecting to PTY…
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  exited,
}: {
  status: "connecting" | "connected" | "closed" | "error";
  exited: boolean;
}) {
  if (exited) return <Badge variant="outline">exited</Badge>;
  if (status === "connected") return <Badge variant="live">connected</Badge>;
  if (status === "connecting")
    return <Badge variant="secondary">connecting…</Badge>;
  if (status === "closed") return <Badge variant="outline">closed</Badge>;
  return <Badge variant="destructive">error</Badge>;
}
