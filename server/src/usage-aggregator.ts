// Aggregates token usage across every session in every project, with a
// per-file mtime cache so the dashboard can poll cheaply.
//
// The cache is keyed on (filePath, mtimeMs). Each cache entry stores the
// fully-computed SessionSummary for one JSONL file. When a file hasn't
// changed since the last scan, we skip parsing entirely. When it has, we
// re-summarize. Invalidation is automatic.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { summarizeProject } from "./claude-data.js";
import type { SessionSummary, TokenUsage } from "./types.js";
import { EMPTY_USAGE } from "./types.js";

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

interface CachedSessionData {
  mtimeMs: number;
  summary: SessionSummary;
  dailyTokens: Map<string, TokenUsage>;
}

/** Per-JSONL-file cache keyed by absolute path. Invalidated when mtime changes. */
const summaryCache = new Map<string, CachedSessionData>();

export interface ProjectTokenTotals {
  slug: string;
  name: string;
  tokens: TokenUsage;
  sessionCount: number;
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  tokens: TokenUsage;
  sessionCount: number;
}

export interface UsageSummary {
  totalTokens: TokenUsage;
  totalSessions: number;
  totalMessages: number;
  liveSessions: number;
  byProject: ProjectTokenTotals[];
  byDay: DailyBucket[];
}

/**
 * Aggregate usage across every project. The daily breakdown is EXACT —
 * every assistant message's usage block is bucketed by its own event
 * timestamp, not by the session's last-activity day. We cache per-file
 * results by mtime so repeat calls only re-parse files that have changed.
 */
export async function aggregateUsage(days: number = 14): Promise<UsageSummary> {
  const projectEntries = await fs.promises
    .readdir(PROJECTS_ROOT, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);

  const total: TokenUsage = { ...EMPTY_USAGE };
  let totalSessions = 0;
  let totalMessages = 0;
  let liveSessions = 0;
  const byProject: ProjectTokenTotals[] = [];
  const byDayMap = new Map<string, DailyBucket>();

  // Seed the daily buckets for the last `days` days so the chart shows a
  // continuous x-axis even on days with no activity.
  const today = startOfDay(new Date());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDate(d);
    byDayMap.set(key, {
      date: key,
      tokens: { ...EMPTY_USAGE },
      sessionCount: 0,
    });
  }

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;

    let sessions: CachedSessionData[];
    try {
      sessions = await loadProjectCached(slug);
    } catch {
      continue;
    }

    const projectTotal: TokenUsage = { ...EMPTY_USAGE };
    for (const s of sessions) {
      addUsage(total, s.summary.tokens);
      addUsage(projectTotal, s.summary.tokens);
      totalSessions++;
      totalMessages += s.summary.messageCount;
      if (s.summary.isLive) liveSessions++;

      // Exact per-event daily bucketing.
      for (const [day, dayTokens] of s.dailyTokens) {
        const bucket = byDayMap.get(day);
        if (!bucket) continue; // outside the requested window
        addUsage(bucket.tokens, dayTokens);
        bucket.sessionCount++;
      }
    }

    if (sessions.length > 0) {
      byProject.push({
        slug,
        name: deriveProjectName(slug),
        tokens: projectTotal,
        sessionCount: sessions.length,
      });
    }
  }

  byProject.sort((a, b) => b.tokens.total - a.tokens.total);

  const byDay = Array.from(byDayMap.values());

  return {
    totalTokens: total,
    totalSessions,
    totalMessages,
    liveSessions,
    byProject,
    byDay,
  };
}

/**
 * Cache-by-mtime wrapper around summarizeProject(slug). Returns full
 * { summary, dailyTokens } per session. Files whose mtime matches the
 * cache entry are not re-parsed.
 */
async function loadProjectCached(slug: string): Promise<CachedSessionData[]> {
  const projectDir = path.join(PROJECTS_ROOT, slug);
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".jsonl")
  );
  if (jsonlFiles.length === 0) return [];

  const cachedHits: CachedSessionData[] = [];
  let anyChanged = false;

  for (const entry of jsonlFiles) {
    const full = path.join(projectDir, entry.name);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.promises.stat(full)).mtimeMs;
    } catch {
      continue;
    }
    const cached = summaryCache.get(full);
    if (cached && cached.mtimeMs === mtimeMs) {
      // Refresh the time-sensitive isLive flag without re-parsing.
      cachedHits.push({
        mtimeMs,
        summary: {
          ...cached.summary,
          isLive: Date.now() - mtimeMs < 60_000,
        },
        dailyTokens: cached.dailyTokens,
      });
    } else {
      anyChanged = true;
    }
  }

  if (!anyChanged && cachedHits.length === jsonlFiles.length) {
    return cachedHits;
  }

  // At least one file changed — re-summarize the whole project.
  const fresh = await summarizeProject(slug);
  const results: CachedSessionData[] = [];
  for (const r of fresh) {
    const full = path.join(projectDir, `${r.summary.id}.jsonl`);
    try {
      const mtimeMs = (await fs.promises.stat(full)).mtimeMs;
      const entry: CachedSessionData = {
        mtimeMs,
        summary: r.summary,
        dailyTokens: r.dailyTokens,
      };
      summaryCache.set(full, entry);
      results.push(entry);
    } catch {
      // ignore
    }
  }
  return results;
}

function addUsage(into: TokenUsage, add: TokenUsage): void {
  into.input += add.input;
  into.output += add.output;
  into.cacheCreate += add.cacheCreate;
  into.cacheRead += add.cacheRead;
  into.total += add.total;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The user-visible project name comes from listProjects (which reads the
 * authoritative cwd from the first JSONL). For the aggregator we'd rather
 * not re-do that lookup, so we fall back to the last dash-separated
 * segment of the slug as a rough label. Callers that care about the
 * correct name can still use /api/projects.
 */
function deriveProjectName(slug: string, _firstSessionId?: string): string {
  const parts = slug.split("-").filter(Boolean);
  return parts[parts.length - 1] ?? slug;
}
