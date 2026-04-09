import { useQuery } from "@tanstack/react-query";
import type {
  ProjectSummary,
  SessionSummary,
  TranscriptPage,
} from "@/types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      fetchJson<{ projects: ProjectSummary[] }>("/api/projects").then(
        (r) => r.projects
      ),
    staleTime: 10_000,
  });
}

export function useSessions(slug: string | null) {
  return useQuery({
    queryKey: ["sessions", slug],
    enabled: !!slug,
    queryFn: () =>
      fetchJson<{ sessions: SessionSummary[] }>(
        `/api/projects/${encodeURIComponent(slug!)}/sessions`
      ).then((r) => r.sessions),
    staleTime: 2_000,
    // Poll so the live badge updates in near-real-time while the page is open.
    refetchInterval: 5_000,
  });
}

export function useTranscript(slug: string | null, id: string | null) {
  return useQuery({
    queryKey: ["transcript", slug, id],
    enabled: !!slug && !!id,
    queryFn: () =>
      fetchJson<TranscriptPage>(
        `/api/projects/${encodeURIComponent(slug!)}/sessions/${encodeURIComponent(id!)}`
      ),
    staleTime: 5_000,
  });
}
