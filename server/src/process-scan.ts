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
    pidCommands.map(async ({ pid, command }) => ({
      pid,
      command,
      cwd: await resolveCwd(pid),
    }))
  );

  // Build cwd → {slug, path, name} map from the canonical project list.
  const projects = await listProjects();
  const cwdToProject = new Map(
    projects.map((p) => [p.path, { slug: p.slug, path: p.path, name: p.name }])
  );

  const results: ClaudeProcess[] = [];
  for (const { pid, command, cwd } of withCwd) {
    const project = cwd ? cwdToProject.get(cwd) ?? null : null;
    let sessionId: string | null = null;
    let sessionIsLive = false;

    if (project) {
      const guessed = await guessCurrentSession(project.slug);
      sessionId = guessed?.id ?? null;
      sessionIsLive = guessed?.isLive ?? false;
    }

    results.push({
      pid,
      command,
      cwd,
      projectSlug: project?.slug ?? null,
      projectPath: project?.path ?? null,
      projectName: project?.name ?? null,
      sessionId,
      sessionIsLive,
      startedAt: null, // Could be populated with `ps -o lstart=` but not needed for v1.
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
 * Return pid + full command for every process whose command line starts
 * with `claude` as a word (i.e. literally `claude`, `claude --resume ...`,
 * etc.). Excludes anything with a slash in front (like `/Applications/Claude.app/...`)
 * because the Anthropic desktop app renames its helpers with `claude` in
 * the path and we don't want to manage those.
 */
async function listCandidatePids(): Promise<{ pid: number; command: string }[]> {
  // ps on macOS and Linux both support `-ax -o pid=,command=` with no headers.
  // We intentionally use `=` to strip column headers so the output is easier
  // to parse.
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], {
    maxBuffer: 4 * 1024 * 1024,
  });

  const out: { pid: number; command: string }[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimStart();
    if (!line) continue;
    const firstSpace = line.indexOf(" ");
    if (firstSpace === -1) continue;
    const pidStr = line.slice(0, firstSpace);
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid)) continue;
    const command = line.slice(firstSpace + 1).trimEnd();
    if (!isClaudeCommand(command)) continue;
    // Skip ourselves — node-pty children launched by this server are tracked
    // via the ptyManager instead.
    if (pid === process.pid) continue;
    out.push({ pid, command });
  }
  return out;
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

/**
 * Find the session JSONL with the newest mtime inside a project dir. This is
 * a heuristic: when a claude process is in project X, the file it's actively
 * appending to is almost always the most recently modified one in that
 * directory.
 */
async function guessCurrentSession(
  slug: string
): Promise<{ id: string; isLive: boolean } | null> {
  const projectDir = path.join(PROJECTS_ROOT, slug);
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let newest: { id: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const full = path.join(projectDir, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = {
          id: entry.name.slice(0, -".jsonl".length),
          mtimeMs: stat.mtimeMs,
        };
      }
    } catch {
      // ignore
    }
  }
  if (!newest) return null;
  return {
    id: newest.id,
    isLive: Date.now() - newest.mtimeMs < 60_000,
  };
}
