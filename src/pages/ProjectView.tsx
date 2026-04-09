import { useParams, useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, Coins, Clock } from "lucide-react";
import { useSessions, useProjects } from "@/hooks/useApi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, formatTokens } from "@/lib/utils";

export function ProjectView() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.slug === slug);
  const { data: sessions, isLoading, error } = useSessions(slug ?? null);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4">
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
          {project?.lastActivity && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              last active {formatRelativeTime(project.lastActivity)}
            </span>
          )}
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
        {sessions && sessions.length > 0 && (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[50%]">Title</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
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
                    <Badge variant="secondary">{s.messageCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Coins className="size-3" />
                      {formatTokens(s.tokens.total)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.lastActivity
                      ? formatRelativeTime(s.lastActivity)
                      : "—"}
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
