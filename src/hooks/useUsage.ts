import { useQuery } from "@tanstack/react-query";

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export interface ProjectTokenTotals {
  slug: string;
  name: string;
  tokens: TokenUsage;
  sessionCount: number;
}

export interface DailyBucket {
  date: string;
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useUsage(days: number = 14) {
  return useQuery({
    queryKey: ["usage", days],
    queryFn: () => fetchJson<UsageSummary>(`/api/usage?days=${days}`),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
