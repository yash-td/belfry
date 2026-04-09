import { Terminal, FolderOpen, Activity } from "lucide-react";
import { useProjects } from "@/hooks/useApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime, formatTokens } from "@/lib/utils";
import { NavLink } from "react-router-dom";

export function HomeView() {
  const { data: projects } = useProjects();
  const totalSessions =
    projects?.reduce((acc, p) => acc + p.sessionCount, 0) ?? 0;
  const mostRecent = projects?.[0];

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-8">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <Terminal className="size-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">
              Claude Station
            </h1>
          </div>
          <p className="text-muted-foreground mt-2">
            A local dashboard for every Claude Code session on your machine.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-normal flex items-center gap-2">
                <FolderOpen className="size-4" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">
                {projects?.length ?? "–"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-normal flex items-center gap-2">
                <Activity className="size-4" />
                Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{totalSessions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-normal">
                Most recent activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-medium truncate">
                {mostRecent?.name ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {mostRecent?.lastActivity
                  ? formatRelativeTime(mostRecent.lastActivity)
                  : ""}
              </div>
            </CardContent>
          </Card>
        </div>

        <h2 className="text-lg font-semibold mb-3">Jump to a project</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects?.slice(0, 12).map((p) => (
            <NavLink
              key={p.slug}
              to={`/projects/${encodeURIComponent(p.slug)}`}
              className="block rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors p-4"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.sessionCount} sessions
                </div>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-1">
                {p.path}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                {p.lastActivity ? formatRelativeTime(p.lastActivity) : "—"}
                {p.totalTokens > 0
                  ? ` · ${formatTokens(p.totalTokens)} tokens`
                  : ""}
              </div>
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
