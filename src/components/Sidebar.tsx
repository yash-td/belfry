import { useState, useEffect, useMemo } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Folder,
  Loader2,
  TerminalSquare,
  Plus,
  Circle,
  Cpu,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { useProjects } from "@/hooks/useApi";
import { useTerminals, useCreateTerminal } from "@/hooks/useTerminals";
import { useProcesses } from "@/hooks/useProcesses";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { ProjectSummary } from "@/types";

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OLDER_EXPANDED_KEY = "belfry:sidebar:olderExpanded";

export function Sidebar() {
  const { data: projects, isLoading, error } = useProjects();
  const { data: terminals } = useTerminals();
  const { data: processes } = useProcesses();
  const createTerminal = useCreateTerminal();
  const navigate = useNavigate();

  const activeTerminals = terminals?.filter((t) => !t.exited) ?? [];
  const externalProcesses = processes ?? [];

  // Which project slugs have at least one externally-running claude attached?
  // Those should count as "active" even if their lastActivity is stale.
  const liveProjectSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const p of externalProcesses) {
      if (p.projectSlug) set.add(p.projectSlug);
    }
    return set;
  }, [externalProcesses]);

  const { recent, older } = useMemo(
    () => splitProjects(projects ?? [], liveProjectSlugs),
    [projects, liveProjectSlugs]
  );

  const [olderExpanded, setOlderExpanded] = useState(false);
  useEffect(() => {
    try {
      setOlderExpanded(localStorage.getItem(OLDER_EXPANDED_KEY) === "1");
    } catch {
      // SSR / private mode
    }
  }, []);
  function toggleOlder(): void {
    setOlderExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(OLDER_EXPANDED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function handleNewTerminal(): Promise<void> {
    const id = await createTerminal.mutateAsync({});
    navigate(`/terminal/${id}`);
  }

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-card/40 flex flex-col">
      <NavLink
        to="/"
        className="flex items-center gap-2.5 px-4 h-14 border-b border-border hover:bg-accent/30 transition-colors"
      >
        <Logo className="size-8" />
        <div>
          <div className="font-semibold leading-tight">Belfry</div>
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

      <div className="flex items-center justify-between px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground border-t border-border">
        <span>Projects</span>
        {recent.length > 0 && (
          <span className="text-[10px] normal-case tracking-normal">
            {recent.length} active
          </span>
        )}
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
          {!isLoading && recent.length === 0 && older.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No Claude Code projects found in ~/.claude/projects/.
            </div>
          )}

          {recent.map((p) => (
            <ProjectNavItem
              key={p.slug}
              project={p}
              isLive={liveProjectSlugs.has(p.slug)}
            />
          ))}

          {older.length > 0 && (
            <>
              <button
                onClick={toggleOlder}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors mt-2"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    olderExpanded && "rotate-90"
                  )}
                />
                <span>Older ({older.length})</span>
              </button>
              {olderExpanded &&
                older.map((p) => (
                  <ProjectNavItem
                    key={p.slug}
                    project={p}
                    isLive={false}
                  />
                ))}
            </>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

function ProjectNavItem({
  project: p,
  isLive,
}: {
  project: ProjectSummary;
  isLive: boolean;
}) {
  return (
    <NavLink
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
      <div className="relative mt-0.5 shrink-0">
        <Folder className="size-4 text-muted-foreground group-hover:text-foreground" />
        {isLive && (
          <Circle className="absolute -top-0.5 -right-0.5 size-2 fill-emerald-400 text-emerald-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{p.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
          {p.lastActivity ? ` · ${formatRelativeTime(p.lastActivity)}` : ""}
        </div>
      </div>
    </NavLink>
  );
}

function splitProjects(
  projects: ProjectSummary[],
  liveProjectSlugs: Set<string>
): { recent: ProjectSummary[]; older: ProjectSummary[] } {
  const threshold = Date.now() - RECENT_WINDOW_MS;
  const recent: ProjectSummary[] = [];
  const older: ProjectSummary[] = [];
  for (const p of projects) {
    const isRecent =
      liveProjectSlugs.has(p.slug) ||
      (p.lastActivity !== null && Date.parse(p.lastActivity) > threshold);
    if (isRecent) recent.push(p);
    else older.push(p);
  }
  return { recent, older };
}
