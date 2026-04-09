import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface TerminalMeta {
  id: string;
  cwd: string;
  command: string;
  args: string[];
  createdAt: string;
  cols: number;
  rows: number;
  pid: number;
  exited: boolean;
  exitCode?: number;
  exitSignal?: number;
}

export interface CreatedTerminal {
  id: string;
  token: string;
  meta: TerminalMeta;
}

export interface CreateTerminalInput {
  cwd?: string;
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
}

async function apiJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
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

export function useTerminals() {
  return useQuery({
    queryKey: ["terminals"],
    queryFn: () =>
      apiJson<{ terminals: TerminalMeta[] }>("/api/terminals").then(
        (r) => r.terminals
      ),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

export function useCreateTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTerminalInput): Promise<string> => {
      const created = await apiJson<CreatedTerminal>("/api/terminals", {
        method: "POST",
        body: JSON.stringify(input),
      });
      // Stash the token under sessionStorage keyed by id so the TerminalView
      // can pick it up when it mounts. Tokens are localhost-scoped and
      // disappear on tab close.
      sessionStorage.setItem(`belfry:token:${created.id}`, created.token);
      return created.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminals"] });
    },
  });
}

export function useKillTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiJson(`/api/terminals/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminals"] });
    },
  });
}

export function getTerminalToken(id: string): string | null {
  return sessionStorage.getItem(`belfry:token:${id}`);
}
