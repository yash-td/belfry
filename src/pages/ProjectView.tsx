import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  MessageSquare,
  Coins,
  Clock,
  TerminalSquare,
  Circle,
} from "lucide-react";
import { useSessions, useProjects } from "@/hooks/useApi";
import { useCreateTerminal } from "@/hooks/useTerminals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime, formatTokens } from "@/lib/utils";

export function ProjectView() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.slug === slug);
  const { data: sessions, isLoading, error } = useSessions(slug ?? null);
  const createTerminal = useCreateTerminal();
  const [activeOnly, setActiveOnly] = useState(false);

  const liveCount = useMemo(
    () => sessions?.filter((s) => s.isLive).length ?? 0,
    [sessions]
  );
  const visibleSessions = useMemo(
    () => (activeOnly ? sessions?.filter((s) => s.isLive) : sessions),
    [sessions, activeOnly]
  );

  async function openInTerminal(
    sessionId: string,
    ev: React.MouseEvent
  ): Promise<void> {
    ev.stopPropagation();
    if (!project) return;
    const terminalId = await createTerminal.mutateAsync({
      cwd: project.path,
      command: "claude",
      args: ["--resume", sessionId],
    });
    navigate(`/terminal/${terminalId}`);
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {project?.name ?? slug}
              </h1>
              <span className="text-sm text-muted-foreground truncate">
                {project?.path}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3" />
                {sessions?.length ?? 0} sessions
              </span>
              {liveCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Circle className="size-2 fill-current" />
                  {liveCount} live
                </span>
              )}
              {project?.lastActivity && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  last active {formatRelativeTime(project.lastActivity)}
                </span>
              )}
            </div>
          </div>
          <Button
            variant={activeOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveOnly((v) => !v)}
          >
            <Circle
              className={cn(
                "size-2 fill-current",
                activeOnly ? "text-emerald-300" : "text-emerald-500"
              )}
            />
            Active only
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading sessions…
          </div>
        )}
        {error && (
          <div className="p-6 text-destructive">
            Failed to load sessions: {(error as Error).message}
          </div>
        )}
        {sessions && sessions.length === 0 && (
          <div className="p-6 text-muted-foreground">
            No sessions in this project.
          </div>
        )}
        {sessions && sessions.length > 0 && visibleSessions?.length === 0 && (
          <div className="p-6 text-muted-foreground">
            No active sessions right now. Toggle off "Active only" to see
            history.
          </div>
        )}
        {visibleSessions && visibleSessions.length > 0 && (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[45%]">Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="w-[1%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSessions.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate(
                      `/projects/${encodeURIComponent(
                        slug!
                      )}/sessions/${encodeURIComponent(s.id)}`
                    )
                  }
                >
                  <TableCell className="max-w-0">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="truncate text-xs text-muted-foreground font-mono">
                      {s.id}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.isLive ? (
                      <Badge variant="live" className="gap-1.5">
                        <Circle className="size-2 fill-current animate-pulse" />
                        live
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        idle
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{s.messageCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Coins className="size-3" />
                      {formatTokens(s.tokens.total)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {s.lastActivity
                      ? formatRelativeTime(s.lastActivity)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(ev) => openInTerminal(s.id, ev)}
                      title="Open in embedded terminal (claude --resume)"
                    >
                      <TerminalSquare className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
