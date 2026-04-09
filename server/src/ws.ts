// WebSocket upgrade handler for /ws/terminal.
//
// Clients provide ?id=...&token=... in the URL. We verify the Origin header
// matches the local Vite dev server before upgrading, then attach to the
// matching PTY via PtyManager.

import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ptyManager } from "./pty-manager.js";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws/terminal")) {
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, req);
    });
  });
}

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
  const { searchParams } = new URL(req.url ?? "", "http://localhost");
  const id = searchParams.get("id");
  const token = searchParams.get("token");

  if (!id || !token) {
    closeWithReason(ws, 1008, "missing id or token");
    return;
  }

  const attached = ptyManager.attach(id, token, {
    onData: (chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "output", data: chunk }));
      }
    },
    onExit: ({ exitCode, signal }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
        ws.close(1000, "terminal exited");
      }
    },
  });

  if (!attached) {
    closeWithReason(ws, 1008, "invalid terminal id or token");
    return;
  }

  // Replay any buffered output so reconnecting clients see recent history.
  if (attached.scrollback.length > 0) {
    ws.send(
      JSON.stringify({
        type: "scrollback",
        data: attached.scrollback.join(""),
      })
    );
  }

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      attached.write(msg.data);
    } else if (
      msg.type === "resize" &&
      typeof msg.cols === "number" &&
      typeof msg.rows === "number"
    ) {
      attached.resize(msg.cols, msg.rows);
    }
  });

  ws.on("close", () => {
    attached.detach();
  });

  ws.on("error", (err) => {
    console.error("[ws] connection error:", err);
    attached.detach();
  });
}

function closeWithReason(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // ignore
  }
}
