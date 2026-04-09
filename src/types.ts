// Shared types between the frontend and backend API responses.
// The backend emits these shapes verbatim — keep them aligned with
// server/src/types.ts.

export interface ProjectSummary {
  slug: string; // e.g. "-Users-ytkd-Desktop-code-yash-desai"
  path: string; // decoded: "/Users/ytkd/Desktop/code/yash-desai"
  name: string; // last path segment: "yash-desai"
  sessionCount: number;
  lastActivity: string | null; // ISO timestamp
  totalTokens: number;
}

export interface SessionSummary {
  id: string; // UUID
  projectSlug: string;
  title: string; // derived from first user message
  messageCount: number;
  tokens: TokenUsage;
  firstActivity: string | null;
  lastActivity: string | null;
  sizeBytes: number;
  /** Session's JSONL was modified within the last ~60s → claude is probably still writing. */
  isLive: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export interface TranscriptEvent {
  index: number;
  type: string; // "user" | "assistant" | "tool_use" | "tool_result" | "system" | ...
  role?: "user" | "assistant" | "system";
  text?: string; // rendered plaintext/markdown content
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  timestamp?: string;
  raw: unknown; // original parsed JSONL line for debugging / escape hatch
}

export interface TranscriptPage {
  sessionId: string;
  projectSlug: string;
  events: TranscriptEvent[];
  totalEvents: number;
  tokens: TokenUsage;
}
