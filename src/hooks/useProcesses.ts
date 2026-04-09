import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ClaudeProcess {
  pid: number;
  command: string;
  cwd: string | null;
  projectSlug: string | null;
  projectPath: string | null;
  projectName: string | null;
  sessionId: string | null;
  sessionIsLive: boolean;
  startedAt: string | null;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export function useProcesses() {
  return useQuery({
    queryKey: ["processes"],
    queryFn: () =>
      apiJson<{ processes: ClaudeProcess[] }>("/api/processes").then(
        (r) => r.processes
      ),
    refetchInterval: 4_000,
    staleTime: 2_000,
  });
}

export function useKillProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pid: number): Promise<void> => {
      await apiJson(`/api/processes/${pid}/kill`, {
        method: "POST",
        body: JSON.stringify({ signal: "SIGTERM" }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processes"] });
    },
  });
}
