// Backend-internal types. These mirror src/types.ts (frontend) for the API
// response shapes, but also include server-only helper types.

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export interface ProjectSummary {
  slug: string;
  path: string;
  name: string;
  sessionCount: number;
  lastActivity: string | null;
  totalTokens: number;
}

export interface SessionSummary {
  id: string;
  projectSlug: string;
  title: string;
  messageCount: number;
  tokens: TokenUsage;
  firstActivity: string | null;
  lastActivity: string | null;
  sizeBytes: number;
  /**
   * True if this session's JSONL file has been written to within the last
   * LIVE_THRESHOLD_MS milliseconds. This is a simple mtime-based heuristic —
   * it doesn't require poking at OS process tables, and it catches "claude
   * is actively doing something" regardless of which terminal spawned it.
   */
  isLive: boolean;
}

/** A session is considered "live" if its JSONL was modified this recently. */
export const LIVE_THRESHOLD_MS = 60_000;

export interface TranscriptEvent {
  index: number;
  type: string;
  role?: "user" | "assistant" | "system";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  timestamp?: string;
  raw: unknown;
}

export interface TranscriptPage {
  sessionId: string;
  projectSlug: string;
  events: TranscriptEvent[];
  totalEvents: number;
  tokens: TokenUsage;
}

export const EMPTY_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
  total: 0,
};
