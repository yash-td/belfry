import { NavLink, useNavigate } from "react-router-dom";
import {
  Folder,
  Terminal,
  Loader2,
  TerminalSquare,
  Plus,
  Circle,
  Cpu,
} from "lucide-react";
import { useProjects } from "@/hooks/useApi";
import { useTerminals, useCreateTerminal } from "@/hooks/useTerminals";
import { useProcesses } from "@/hooks/useProcesses";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";

export function Sidebar() {
  const { data: projects, isLoading, error } = useProjects();
  const { data: terminals } = useTerminals();
  const { data: processes } = useProcesses();
  const createTerminal = useCreateTerminal();
  const navigate = useNavigate();

  const activeTerminals = terminals?.filter((t) => !t.exited) ?? [];
  const externalProcesses = processes ?? [];

  async function handleNewTerminal(): Promise<void> {
    const id = await createTerminal.mutateAsync({});
    navigate(`/terminal/${id}`);
  }

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-card/40 flex flex-col">
      <NavLink
        to="/"
        className="flex items-center gap-2 px-4 h-14 border-b border-border hover:bg-accent/30 transition-colors"
      >
        <Terminal className="size-5 text-primary" />
        <div>
          <div className="font-semibold leading-tight">Claude Station</div>
          <div className="text-xs text-muted-foreground leading-tight">
            local session control
          </div>
        </div>
      </NavLink>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Terminals
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={handleNewTerminal}
          disabled={createTerminal.isPending}
          title="New terminal"
        >
          {createTerminal.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Plus className="size-3" />
          )}
        </Button>
      </div>

      <nav className="px-2 space-y-0.5 pb-2">
        {activeTerminals.length === 0 && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            No open terminals.
          </div>
        )}
        {activeTerminals.map((t) => {
          const label = `${t.command} ${t.args.join(" ")}`.trim();
          return (
            <NavLink
              key={t.id}
              to={`/terminal/${t.id}`}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground/90"
                )
              }
            >
              <Circle className="size-2 fill-emerald-400 text-emerald-400" />
              <TerminalSquare className="size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 truncate font-mono text-xs">
                {label}
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="flex items-center justify-between px-4 pt-2 pb-1 border-t border-border">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Running claude
        </div>
        {externalProcesses.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {externalProcesses.length}
          </span>
        )}
      </div>

      <nav className="px-2 space-y-0.5 pb-2 max-h-48 overflow-auto">
        {externalProcesses.length === 0 && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            No external claude processes.
          </div>
        )}
        {externalProcesses.map((p) => {
          const target =
            p.projectSlug && p.sessionId
              ? `/projects/${encodeURIComponent(p.projectSlug)}/sessions/${encodeURIComponent(p.sessionId)}`
              : p.projectSlug
                ? `/projects/${encodeURIComponent(p.projectSlug)}`
                : "#";
          return (
            <NavLink
              key={p.pid}
              to={target}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground/90"
                )
              }
              title={`pid ${p.pid} — ${p.cwd ?? "unknown cwd"}`}
            >
              <Circle
                className={cn(
                  "size-2 fill-current shrink-0",
                  p.sessionIsLive ? "text-emerald-400" : "text-amber-400"
                )}
              />
              <Cpu className="size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 truncate text-xs">
                <span className="font-medium">
                  {p.projectName ?? "(unknown)"}
                </span>
                <span className="text-muted-foreground"> · {p.pid}</span>
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground border-t border-border">
        Projects
      </div>

      <ScrollArea className="flex-1">
        <nav className="px-2 pb-4 space-y-0.5">
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading projects…
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-sm text-destructive">
              Failed to load projects.
              <div className="text-xs text-muted-foreground mt-1">
                Is the backend running?
              </div>
            </div>
          )}
          {projects?.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No Claude Code projects found in ~/.claude/projects/.
            </div>
          )}
          {projects?.map((p) => (
            <NavLink
              key={p.slug}
              to={`/projects/${encodeURIComponent(p.slug)}`}
              className={({ isActive }) =>
                cn(
                  "group flex items-start gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground/90"
                )
              }
            >
              <Folder className="size-4 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
                  {p.lastActivity
                    ? ` · ${formatRelativeTime(p.lastActivity)}`
                    : ""}
                </div>
              </div>
            </NavLink>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
