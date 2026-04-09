// External Claude Code process scanner.
//
// Scans `ps` for every `claude` process owned by the user, resolves each
// process's cwd via `lsof`, and maps the cwd to a Claude Code project slug
// + best-guess current session UUID (whichever JSONL in that project has
// the newest mtime).
//
// Results are cached for PROCESS_SCAN_TTL_MS so the HomeView and sidebar
// polls don't hammer `ps` + `lsof` every second.
//
// macOS and Linux are supported today. On Windows this module returns an
// empty list — Windows detection would need `wmic` or PowerShell and is
// left as PR-welcome.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listProjects } from "./claude-data.js";

const execFileAsync = promisify(execFile);

const PROCESS_SCAN_TTL_MS = 4_000;
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

export interface ClaudeProcess {
  pid: number;
  command: string; // full command line as reported by ps
  cwd: string | null;
  projectSlug: string | null;
  projectPath: string | null;
  projectName: string | null;
  /** Our best guess at the session UUID this process is writing to. */
  sessionId: string | null;
  /** True if the guessed session's JSONL has been written in the last 60s. */
  sessionIsLive: boolean;
  startedAt: string | null; // ISO if we could parse it, else null
}

interface CacheEntry {
  at: number;
  data: ClaudeProcess[];
}

let cache: CacheEntry | null = null;

export async function scanClaudeProcesses(): Promise<ClaudeProcess[]> {
  const now = Date.now();
  if (cache && now - cache.at < PROCESS_SCAN_TTL_MS) return cache.data;

  if (process.platform === "win32") {
    cache = { at: now, data: [] };
    return [];
  }

  const pidCommands = await listCandidatePids();
  if (pidCommands.length === 0) {
    cache = { at: now, data: [] };
    return [];
  }

  // Resolve cwd for every matching pid in parallel.
  const withCwd = await Promise.all(
    pidCommands.map(async ({ pid, command, startMs }) => ({
      pid,
      command,
      startMs,
      cwd: await resolveCwd(pid),
    }))
  );

  // Build cwd → {slug, path, name} map from the canonical project list.
  const projects = await listProjects();
  const cwdToProject = new Map(
    projects.map((p) => [p.path, { slug: p.slug, path: p.path, name: p.name }])
  );

  // Group PIDs by project slug so we can disambiguate same-cwd duplicates
  // against the set of candidate sessions in that project.
  const byProject = new Map<
    string,
    {
      project: { slug: string; path: string; name: string };
      pids: { pid: number; command: string; cwd: string; startMs: number | null }[];
    }
  >();
  const unmatched: typeof withCwd = [];
  for (const p of withCwd) {
    const project = p.cwd ? cwdToProject.get(p.cwd) ?? null : null;
    if (!project) {
      unmatched.push(p);
      continue;
    }
    const entry = byProject.get(project.slug) ?? { project, pids: [] };
    entry.pids.push({
      pid: p.pid,
      command: p.command,
      cwd: p.cwd!,
      startMs: p.startMs,
    });
    byProject.set(project.slug, entry);
  }

  const results: ClaudeProcess[] = [];

  for (const { project, pids } of byProject.values()) {
    const sessions = await listProjectSessionFiles(project.slug);
    const assignments = assignPidsToSessions(pids, sessions);
    for (const a of assignments) {
      results.push({
        pid: a.pid,
        command: a.command,
        cwd: a.cwd,
        projectSlug: project.slug,
        projectPath: project.path,
        projectName: project.name,
        sessionId: a.sessionId,
        sessionIsLive: a.sessionIsLive,
        startedAt: a.startMs ? new Date(a.startMs).toISOString() : null,
      });
    }
  }

  // Unmatched processes (cwd not recognized as a claude project).
  for (const p of unmatched) {
    results.push({
      pid: p.pid,
      command: p.command,
      cwd: p.cwd,
      projectSlug: null,
      projectPath: null,
      projectName: null,
      sessionId: null,
      sessionIsLive: false,
      startedAt: p.startMs ? new Date(p.startMs).toISOString() : null,
    });
  }

  // Most recently active first (live sessions float to the top).
  results.sort((a, b) => {
    if (a.sessionIsLive !== b.sessionIsLive) return a.sessionIsLive ? -1 : 1;
    return 0;
  });

  cache = { at: now, data: results };
  return results;
}

interface SessionFile {
  id: string;
  birthtimeMs: number;
  mtimeMs: number;
}

async function listProjectSessionFiles(slug: string): Promise<SessionFile[]> {
  const projectDir = path.join(PROJECTS_ROOT, slug);
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const full = path.join(projectDir, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      out.push({
        id: entry.name.slice(0, -".jsonl".length),
        birthtimeMs: stat.birthtimeMs,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // ignore
    }
  }
  return out;
}

/**
 * Greedy assignment of PIDs to JSONL session files within a single project.
 *
 * Heuristic:
 *   - Each `claude` process creates a fresh JSONL near its own start time,
 *     unless it was invoked with `--resume`.
 *   - A JSONL is only being "written to" by a PID if its mtime is > the
 *     PID's start time.
 *
 * Algorithm:
 *   1. Sort PIDs by startMs DESC (youngest first — they get first pick of
 *      the most-recently-touched sessions).
 *   2. For each PID, score every unclaimed session:
 *        - Only consider sessions with mtime > pid.startMs (modified during
 *          the PID's lifetime).
 *        - Prefer sessions whose birthtime is close to pid.startMs (meaning
 *          this PID probably created them).
 *        - Among otherwise-equal candidates, prefer newest-mtime.
 *   3. Assign the best-scoring session to the PID and remove it from the
 *      pool so the next PID can't pick the same one.
 *   4. If a PID has no valid candidate, fall back to newest-mtime globally
 *      (reused between PIDs if necessary — better than null).
 */
function assignPidsToSessions(
  pids: { pid: number; command: string; cwd: string; startMs: number | null }[],
  sessions: SessionFile[]
): {
  pid: number;
  command: string;
  cwd: string;
  startMs: number | null;
  sessionId: string | null;
  sessionIsLive: boolean;
}[] {
  const sorted = [...pids].sort(
    (a, b) => (b.startMs ?? 0) - (a.startMs ?? 0)
  );
  const pool = [...sessions];
  const globalNewest = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const now = Date.now();

  const assignments: {
    pid: number;
    command: string;
    cwd: string;
    startMs: number | null;
    sessionId: string | null;
    sessionIsLive: boolean;
  }[] = [];

  for (const pid of sorted) {
    let pick: SessionFile | null = null;

    if (pid.startMs !== null) {
      const eligible = pool.filter((s) => s.mtimeMs > pid.startMs!);
      if (eligible.length > 0) {
        // Score: lower = better. |birthtime - startMs| ± tiebreaker by -mtime
        eligible.sort((a, b) => {
          const aAlign = Math.abs(a.birthtimeMs - pid.startMs!);
          const bAlign = Math.abs(b.birthtimeMs - pid.startMs!);
          if (aAlign !== bAlign) return aAlign - bAlign;
          return b.mtimeMs - a.mtimeMs;
        });
        pick = eligible[0] ?? null;
      }
    }

    if (!pick) {
      // Fallback: newest-mtime in the remaining pool, else the global newest.
      const fallback = pool
        .slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      pick = fallback ?? globalNewest ?? null;
    }

    if (pick) {
      const idx = pool.indexOf(pick);
      if (idx >= 0) pool.splice(idx, 1);
    }

    assignments.push({
      pid: pid.pid,
      command: pid.command,
      cwd: pid.cwd,
      startMs: pid.startMs,
      sessionId: pick?.id ?? null,
      sessionIsLive: pick ? now - pick.mtimeMs < 60_000 : false,
    });
  }

  return assignments;
}

/** Send SIGTERM (default) or another signal to a PID. */
export async function killClaudeProcess(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM"
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { ok: false, error: "Invalid PID" };
  }
  // Safety net: only ever target processes that the scanner believes are
  // `claude`. This prevents the kill endpoint from being turned into a
  // general-purpose "kill any PID" weapon if something goes wrong upstream.
  const processes = await scanClaudeProcesses();
  if (!processes.some((p) => p.pid === pid)) {
    return { ok: false, error: "PID is not a tracked claude process" };
  }
  try {
    process.kill(pid, signal);
    // Invalidate cache so the next poll reflects the kill.
    cache = null;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ------------ helpers ------------

/**
 * Return pid + full command + approximate start time for every process
 * whose command line starts with `claude` as a word.
 *
 * We use `etime` (elapsed time since start) instead of `lstart` because
 * etime is space-free and easy to parse: `[[DD-]HH:]MM:SS`.
 */
async function listCandidatePids(): Promise<
  { pid: number; command: string; startMs: number | null }[]
> {
  const { stdout } = await execFileAsync(
    "ps",
    ["-ax", "-o", "pid=,etime=,command="],
    { maxBuffer: 4 * 1024 * 1024 }
  );

  const now = Date.now();
  const out: { pid: number; command: string; startMs: number | null }[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimStart();
    if (!line) continue;

    // pid
    const firstSpace = line.indexOf(" ");
    if (firstSpace === -1) continue;
    const pid = Number.parseInt(line.slice(0, firstSpace), 10);
    if (!Number.isFinite(pid)) continue;

    // etime
    const rest = line.slice(firstSpace + 1).trimStart();
    const etimeEnd = rest.indexOf(" ");
    if (etimeEnd === -1) continue;
    const etimeStr = rest.slice(0, etimeEnd);
    const elapsedSec = parseEtime(etimeStr);
    const startMs = elapsedSec !== null ? now - elapsedSec * 1000 : null;

    // command (everything after etime)
    const command = rest.slice(etimeEnd + 1).trimEnd();
    if (!isClaudeCommand(command)) continue;
    if (pid === process.pid) continue;

    out.push({ pid, command, startMs });
  }
  return out;
}

/**
 * Parse `ps -o etime=` format: `SS`, `MM:SS`, `HH:MM:SS`, or `DD-HH:MM:SS`.
 * Returns elapsed seconds, or null if unparseable.
 */
function parseEtime(etime: string): number | null {
  let days = 0;
  let rest = etime;
  const dashIdx = rest.indexOf("-");
  if (dashIdx >= 0) {
    days = Number.parseInt(rest.slice(0, dashIdx), 10);
    rest = rest.slice(dashIdx + 1);
    if (!Number.isFinite(days)) return null;
  }
  const parts = rest.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 1) {
    s = parts[0]!;
  } else if (parts.length === 2) {
    m = parts[0]!;
    s = parts[1]!;
  } else if (parts.length === 3) {
    h = parts[0]!;
    m = parts[1]!;
    s = parts[2]!;
  } else {
    return null;
  }
  return days * 86400 + h * 3600 + m * 60 + s;
}

/**
 * True if a command line looks like a `claude` CLI invocation. We accept:
 *   - "claude"             (bare, most common — claude sets process.title)
 *   - "claude --resume X"
 *   - "/usr/local/bin/claude"
 *   - "claude-code" (future alias)
 * and reject:
 *   - Anything containing ".app/" (Claude Desktop bundles)
 *   - "claude-helper", "Claude Helper"
 */
function isClaudeCommand(command: string): boolean {
  if (!command) return false;
  if (command.includes(".app/")) return false;
  if (/claude[- ]helper/i.test(command)) return false;

  // Normalize: strip any leading path from the first token.
  const firstToken = command.split(/\s+/, 1)[0] ?? "";
  const bin = firstToken.includes("/") ? path.basename(firstToken) : firstToken;
  return bin === "claude" || bin === "claude-code";
}

/**
 * Get a process's current working directory via `lsof -Fn -a -p <pid> -d cwd`.
 * Returns null if lsof fails (process may have exited, or we lack perms).
 */
async function resolveCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-Fn", "-a", "-p", String(pid), "-d", "cwd"],
      { maxBuffer: 256 * 1024 }
    );
    for (const line of stdout.split("\n")) {
      if (line.startsWith("n")) {
        const cwd = line.slice(1).trim();
        return cwd.length > 0 ? cwd : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Legacy per-PID single-session guesser was replaced by the per-project
// `assignPidsToSessions` algorithm above, which disambiguates multiple
// PIDs sharing a cwd against multiple candidate JSONL files.
