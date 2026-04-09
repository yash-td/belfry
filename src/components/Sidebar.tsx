import { NavLink } from "react-router-dom";
import { Folder, Terminal, Loader2 } from "lucide-react";
import { useProjects } from "@/hooks/useApi";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatRelativeTime } from "@/lib/utils";

export function Sidebar() {
  const { data: projects, isLoading, error } = useProjects();

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

      <div className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
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
