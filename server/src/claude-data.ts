// Reads and parses Claude Code's on-disk session storage.
//
// Claude Code stores each project's sessions at:
//   ~/.claude/projects/<slug>/<uuid>.jsonl
//
// where <slug> is the absolute path of the project directory with every "/"
// replaced by "-". Each .jsonl file is one session. Each line is a JSON event
// (user message, assistant message, tool call, tool result, system event, ...).
//
// This module is intentionally defensive: the JSONL schema has evolved over
// time and we never want a single malformed line to break the UI. Unknown
// fields are ignored; unparseable lines are skipped with a warning.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import {
  EMPTY_USAGE,
  type ProjectSummary,
  type SessionSummary,
  type TokenUsage,
  type TranscriptEvent,
  type TranscriptPage,
} from "./types.js";

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

/**
 * Slug → path is lossy: the encoding replaces "/" with "-", but directory
 * names can already contain dashes (e.g. "yash-desai"), so a naive reverse
 * would split "yash-desai" into "yash/desai". Instead, we open the first
 * JSONL file in the project and read its `cwd` field — every Claude Code
 * event records the absolute cwd, which is the ground truth.
 *
 * If no JSONL is readable we fall back to the naive decode as a last resort.
 */
export function naiveSlugToPath(slug: string): string {
  if (!slug.startsWith("-")) return slug;
  return "/" + slug.slice(1).replace(/-/g, "/");
}

export function projectNameFromPath(absPath: string): string {
  const parts = absPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? absPath;
}

/** Read the first `cwd` found in any JSONL inside a project directory. */
async function readCwdFromProject(projectDir: string): Promise<string | null> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const jsonlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => path.join(projectDir, e.name));
  for (const file of jsonlFiles) {
    try {
      const stream = fs.createReadStream(file, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('"cwd"')) continue;
        try {
          const obj = JSON.parse(line) as { cwd?: unknown };
          if (typeof obj.cwd === "string" && obj.cwd.startsWith("/")) {
            rl.close();
            stream.destroy();
            return obj.cwd;
          }
        } catch {
          // malformed line, keep looking
        }
      }
    } catch {
      // unreadable file, try the next
    }
  }
  return null;
}

/** True if a path is safely contained within PROJECTS_ROOT — guards against traversal. */
function isInsideProjectsRoot(target: string): boolean {
  const rel = path.relative(PROJECTS_ROOT, target);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** List every project directory under ~/.claude/projects. */
export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(PROJECTS_ROOT, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const projectDir = path.join(PROJECTS_ROOT, slug);
    if (!isInsideProjectsRoot(projectDir)) continue;

    const [{ sessionCount, lastActivity, totalTokens }, realCwd] =
      await Promise.all([
        summarizeProjectDir(projectDir),
        readCwdFromProject(projectDir),
      ]);
    const resolvedPath = realCwd ?? naiveSlugToPath(slug);
    projects.push({
      slug,
      path: resolvedPath,
      name: projectNameFromPath(resolvedPath),
      sessionCount,
      lastActivity,
      totalTokens,
    });
  }

  // Most-recently-active projects first.
  projects.sort((a, b) => {
    const at = a.lastActivity ? Date.parse(a.lastActivity) : 0;
    const bt = b.lastActivity ? Date.parse(b.lastActivity) : 0;
    return bt - at;
  });
  return projects;
}

/** Cheap directory summary: session count + newest mtime + rough token total. */
async function summarizeProjectDir(
  projectDir: string
): Promise<{ sessionCount: number; lastActivity: string | null; totalTokens: number }> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch {
    return { sessionCount: 0, lastActivity: null, totalTokens: 0 };
  }

  let sessionCount = 0;
  let newest = 0;
  let totalTokens = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    sessionCount++;
    const full = path.join(projectDir, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      // We skip parsing JSONL for project-level totals to keep listProjects
      // fast. Full token totals are computed lazily per-session. The
      // dashboard view can call listSessions() per project for an exact
      // number if needed.
    } catch {
      // ignore unreadable session files
    }
  }

  return {
    sessionCount,
    lastActivity: newest ? new Date(newest).toISOString() : null,
    totalTokens,
  };
}

/** List all sessions for a given project slug with full per-session metadata. */
export async function listSessions(slug: string): Promise<SessionSummary[]> {
  const projectDir = path.join(PROJECTS_ROOT, slug);
  if (!isInsideProjectsRoot(projectDir)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const sessions: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.slice(0, -".jsonl".length);
    const full = path.join(projectDir, entry.name);
    try {
      const summary = await summarizeSessionFile(full, slug, id);
      sessions.push(summary);
    } catch (err) {
      console.warn(`[claude-station] Failed to summarize ${full}:`, err);
    }
  }

  sessions.sort((a, b) => {
    const at = a.lastActivity ? Date.parse(a.lastActivity) : 0;
    const bt = b.lastActivity ? Date.parse(b.lastActivity) : 0;
    return bt - at;
  });
  return sessions;
}

/**
 * Stream a JSONL file once, pulling out:
 *   - first user text (becomes the session "title")
 *   - total message count
 *   - cumulative token usage across all assistant messages
 *   - first/last event timestamps
 *
 * We intentionally do NOT load the entire file into memory — some sessions
 * are multi-MB and the UI never needs the full blob just to render a list row.
 */
async function summarizeSessionFile(
  filePath: string,
  slug: string,
  id: string
): Promise<SessionSummary> {
  const stat = await fs.promises.stat(filePath);

  let title = "";
  let messageCount = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  const tokens: TokenUsage = { ...EMPTY_USAGE };

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // skip malformed line
    }
    if (typeof evt !== "object" || evt === null) continue;
    const obj = evt as Record<string, unknown>;

    // Track timestamps if present.
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    // User/assistant message detection (both legacy and current schemas).
    const kind = (obj.type as string | undefined) ?? "";
    if (kind === "user" || kind === "assistant") {
      messageCount++;
      if (!title && kind === "user") {
        title = extractFirstUserText(obj) ?? "";
      }
    }

    // Token usage lives inside assistant messages.
    const message = obj.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage) {
      tokens.input += toInt(usage.input_tokens);
      tokens.output += toInt(usage.output_tokens);
      tokens.cacheCreate += toInt(usage.cache_creation_input_tokens);
      tokens.cacheRead += toInt(usage.cache_read_input_tokens);
    }
  }

  tokens.total =
    tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead;

  return {
    id,
    projectSlug: slug,
    title: title.trim() || "(untitled session)",
    messageCount,
    tokens,
    firstActivity: firstTs ?? new Date(stat.birthtimeMs).toISOString(),
    lastActivity: lastTs ?? new Date(stat.mtimeMs).toISOString(),
    sizeBytes: stat.size,
  };
}

/**
 * Read a full session transcript and convert it into a normalized list of
 * rendered events the frontend can display directly.
 */
export async function readTranscript(
  slug: string,
  id: string
): Promise<TranscriptPage> {
  const projectDir = path.join(PROJECTS_ROOT, slug);
  if (!isInsideProjectsRoot(projectDir)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  // Guard against path traversal via the id.
  if (!/^[a-f0-9-]{8,}$/i.test(id)) {
    throw new Error(`Invalid session id: ${id}`);
  }
  const filePath = path.join(projectDir, `${id}.jsonl`);
  if (!isInsideProjectsRoot(filePath)) {
    throw new Error(`Invalid session path`);
  }

  const content = await fs.promises.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const events: TranscriptEvent[] = [];
  const tokens: TokenUsage = { ...EMPTY_USAGE };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;

    const kind = (obj.type as string | undefined) ?? "unknown";
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    const message = obj.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage) {
      tokens.input += toInt(usage.input_tokens);
      tokens.output += toInt(usage.output_tokens);
      tokens.cacheCreate += toInt(usage.cache_creation_input_tokens);
      tokens.cacheRead += toInt(usage.cache_read_input_tokens);
    }

    const event: TranscriptEvent = {
      index: i,
      type: kind,
      timestamp: ts,
      raw,
    };

    if (kind === "user") {
      event.role = "user";
      event.text = extractFirstUserText(obj) ?? "";
    } else if (kind === "assistant") {
      event.role = "assistant";
      event.text = extractAssistantText(obj) ?? "";
      const tool = extractAssistantToolUse(obj);
      if (tool) {
        event.toolName = tool.name;
        event.toolInput = tool.input;
      }
    } else if (kind === "system") {
      event.role = "system";
      event.text = typeof obj.content === "string" ? obj.content : undefined;
    }

    events.push(event);
  }

  tokens.total =
    tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead;

  return {
    sessionId: id,
    projectSlug: slug,
    events,
    totalEvents: events.length,
    tokens,
  };
}

// ------------ helpers ------------

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return 0;
}

/**
 * Pull the plaintext out of a "user" JSONL line. Claude Code has shipped a
 * few shapes over time, so we check each.
 */
function extractFirstUserText(obj: Record<string, unknown>): string | undefined {
  // Shape A: { type: "user", message: { content: "hello" } }
  // Shape B: { type: "user", message: { content: [{ type: "text", text: "..." }] } }
  // Shape C: { type: "user", content: "hello" }
  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content ?? obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find(
      (c): c is { type: string; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text"
    );
    if (textPart && typeof textPart.text === "string") return textPart.text;
  }
  return undefined;
}

function extractAssistantText(obj: Record<string, unknown>): string | undefined {
  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (c): c is { type: string; text: string } =>
          typeof c === "object" &&
          c !== null &&
          (c as { type?: unknown }).type === "text" &&
          typeof (c as { text?: unknown }).text === "string"
      )
      .map((c) => c.text);
    if (texts.length > 0) return texts.join("\n\n");
  }
  return undefined;
}

function extractAssistantToolUse(
  obj: Record<string, unknown>
): { name: string; input: unknown } | undefined {
  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  const toolUse = content.find(
    (c): c is { type: string; name: string; input: unknown } =>
      typeof c === "object" &&
      c !== null &&
      (c as { type?: unknown }).type === "tool_use"
  );
  if (!toolUse) return undefined;
  return { name: toolUse.name, input: toolUse.input };
}
