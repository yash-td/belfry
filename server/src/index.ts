// Claude Station backend — tiny Express API that exposes Claude Code's
// on-disk session data to the local frontend.
//
// SECURITY: this server binds to 127.0.0.1 only. Do NOT change the host.
// It has filesystem read access to ~/.claude and in later milestones will
// also spawn processes (kill, resume). Exposing it to the network would
// let anyone on that network read your transcripts and run commands as you.

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import {
  listProjects,
  listSessions,
  readTranscript,
} from "./claude-data.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_STATION_PORT ?? 5174);

const app = express();
app.use(cors({ origin: "http://127.0.0.1:5173" }));
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
    res.json({ ok: true, service: "claude-station", version: "0.1.0" });
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

// Fallback 404 for unknown API routes (prevents serving HTML by mistake).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler — logs full detail on the server but returns a generic
// message to the client so we don't leak paths.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[claude-station] API error:", err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(
    `[claude-station] API listening on http://${HOST}:${PORT} (localhost only)`
  );
});

// Slugs are the encoded paths Claude Code uses. We allow letters, digits,
// dashes, dots and underscores. Importantly: no "/" and no "..".
function isValidSlug(slug: string | undefined): slug is string {
  if (!slug) return false;
  if (slug.includes("/") || slug.includes("..")) return false;
  return /^[A-Za-z0-9._-]+$/.test(slug);
}
