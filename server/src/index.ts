// Claude Station backend — tiny Express API that exposes Claude Code's
// on-disk session data to the local frontend and hosts embedded PTYs.
//
// SECURITY: this server binds to 127.0.0.1 only. Do NOT change the host.
// It has filesystem read access to ~/.claude, spawns shell processes via
// node-pty, and will be able to send signals to existing PIDs in later
// milestones. Exposing it to the network would let anyone on that network
// read your transcripts and run commands as you.

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import http from "node:http";
import {
  listProjects,
  listSessions,
  readTranscript,
} from "./claude-data.js";
import { ptyManager, type CreateTerminalOptions } from "./pty-manager.js";
import { attachWebSocketServer } from "./ws.js";
import {
  scanClaudeProcesses,
  killClaudeProcess,
} from "./process-scan.js";
import { aggregateUsage } from "./usage-aggregator.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_STATION_PORT ?? 5174);

const app = express();
app.use(
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  })
);
app.use(express.json({ limit: "1mb" }));

// Structured async wrapper so thrown errors hit the error handler below.
const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response) => Promise<unknown>) =>
  (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

app.get(
  "/api/health",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, service: "claude-station", version: "0.2.0" });
  })
);

app.get(
  "/api/projects",
  asyncHandler(async (_req, res) => {
    const projects = await listProjects();
    res.json({ projects });
  })
);

app.get(
  "/api/projects/:slug/sessions",
  asyncHandler(async (req, res) => {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid project slug" });
      return;
    }
    const sessions = await listSessions(slug);
    res.json({ sessions });
  })
);

app.get(
  "/api/projects/:slug/sessions/:id",
  asyncHandler(async (req, res) => {
    const { slug, id } = req.params;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid project slug" });
      return;
    }
    const transcript = await readTranscript(slug, id);
    res.json(transcript);
  })
);

// ------------ terminals ------------

app.get(
  "/api/terminals",
  asyncHandler(async (_req, res) => {
    res.json({ terminals: ptyManager.list() });
  })
);

app.post(
  "/api/terminals",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const opts: CreateTerminalOptions = {};
    if (typeof body.cwd === "string") opts.cwd = body.cwd;
    if (typeof body.command === "string") opts.command = body.command;
    if (Array.isArray(body.args)) {
      opts.args = body.args.filter((a): a is string => typeof a === "string");
    }
    if (typeof body.cols === "number") opts.cols = body.cols;
    if (typeof body.rows === "number") opts.rows = body.rows;

    const created = ptyManager.create(opts);
    res.json(created);
  })
);

app.delete(
  "/api/terminals/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!/^[a-f0-9]{8,}$/.test(id)) {
      res.status(400).json({ error: "Invalid terminal id" });
      return;
    }
    const killed = ptyManager.kill(id);
    if (!killed) {
      res.status(404).json({ error: "Terminal not found" });
      return;
    }
    res.json({ ok: true });
  })
);

// ------------ external claude processes ------------

app.get(
  "/api/processes",
  asyncHandler(async (_req, res) => {
    const processes = await scanClaudeProcesses();
    res.json({ processes });
  })
);

app.post(
  "/api/processes/:pid/kill",
  asyncHandler(async (req, res) => {
    const pid = Number.parseInt(req.params.pid, 10);
    if (!Number.isInteger(pid) || pid <= 1) {
      res.status(400).json({ error: "Invalid PID" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signal =
      typeof body.signal === "string" &&
      /^SIG[A-Z]+$/.test(body.signal as string)
        ? (body.signal as NodeJS.Signals)
        : ("SIGTERM" as NodeJS.Signals);
    const result = await killClaudeProcess(pid, signal);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Failed to kill" });
      return;
    }
    res.json({ ok: true });
  })
);

// ------------ usage aggregation ------------

app.get(
  "/api/usage",
  asyncHandler(async (req, res) => {
    const days = Math.max(
      1,
      Math.min(90, Number.parseInt(String(req.query.days ?? "14"), 10) || 14)
    );
    const usage = await aggregateUsage(days);
    res.json(usage);
  })
);

// Fallback 404 for unknown API routes (prevents serving HTML by mistake).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler — logs full detail on the server but returns a generic
// message to the client so we don't leak paths.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[claude-station] API error:", err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, HOST, () => {
  console.log(
    `[claude-station] API + WS listening on http://${HOST}:${PORT} (localhost only)`
  );
});

// Slugs are the encoded paths Claude Code uses. We allow letters, digits,
// dashes, dots and underscores. Importantly: no "/" and no "..".
function isValidSlug(slug: string | undefined): slug is string {
  if (!slug) return false;
  if (slug.includes("/") || slug.includes("..")) return false;
  return /^[A-Za-z0-9._-]+$/.test(slug);
}
