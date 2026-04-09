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
import { listSessions } from "./claude-data.js";
import type { SessionSummary, TokenUsage } from "./types.js";
import { EMPTY_USAGE } from "./types.js";

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

interface CachedSummary {
  mtimeMs: number;
  summary: SessionSummary;
}

const summaryCache = new Map<string, CachedSummary>();

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
 * Aggregate usage across every project. Sessions are attributed to their
 * `lastActivity` date for the daily breakdown — this is an approximation
 * (multi-day sessions get assigned to their final day) but is free since
 * we already have the totals per session, and it's good enough for a
 * "tokens per day" trend view.
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

    let summaries: SessionSummary[];
    try {
      summaries = await listSessionsCached(slug);
    } catch {
      continue;
    }

    const projectTotal: TokenUsage = { ...EMPTY_USAGE };
    for (const s of summaries) {
      addUsage(total, s.tokens);
      addUsage(projectTotal, s.tokens);
      totalSessions++;
      totalMessages += s.messageCount;
      if (s.isLive) liveSessions++;

      // Daily bucket from lastActivity timestamp.
      if (s.lastActivity) {
        const key = formatDate(startOfDay(new Date(s.lastActivity)));
        const bucket = byDayMap.get(key);
        if (bucket) {
          addUsage(bucket.tokens, s.tokens);
          bucket.sessionCount++;
        }
      }
    }

    if (summaries.length > 0) {
      byProject.push({
        slug,
        name: deriveProjectName(slug, summaries[0]?.id),
        tokens: projectTotal,
        sessionCount: summaries.length,
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
 * A cached-by-mtime wrapper around listSessions(slug). The underlying
 * listSessions still walks the directory, but we short-circuit the
 * per-file JSONL parse when a file hasn't changed since we last saw it.
 *
 * NOTE: listSessions in claude-data.ts already streams files efficiently.
 * We wrap it here because aggregateUsage runs across ALL projects — on a
 * repeat call, the vast majority of files are unchanged, and skipping
 * re-parses is the whole point of this cache.
 */
async function listSessionsCached(slug: string): Promise<SessionSummary[]> {
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

  const unchangedIds = new Set<string>();
  const cachedSummaries: SessionSummary[] = [];
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
      // The file hasn't changed, but `isLive` is time-sensitive — recompute
      // it from the same mtime we already have.
      const refreshed: SessionSummary = {
        ...cached.summary,
        isLive: Date.now() - mtimeMs < 60_000,
      };
      cachedSummaries.push(refreshed);
      unchangedIds.add(entry.name);
    } else {
      anyChanged = true;
    }
  }

  if (!anyChanged && cachedSummaries.length === jsonlFiles.length) {
    return cachedSummaries;
  }

  // Something changed (or is new). Rerun the full listSessions for this
  // project, then update the cache.
  const fresh = await listSessions(slug);
  for (const s of fresh) {
    const full = path.join(projectDir, `${s.id}.jsonl`);
    try {
      const mtimeMs = (await fs.promises.stat(full)).mtimeMs;
      summaryCache.set(full, { mtimeMs, summary: s });
    } catch {
      // ignore
    }
  }
  return fresh;
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
