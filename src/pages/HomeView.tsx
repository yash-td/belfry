import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  Coins,
  Cpu,
  FolderOpen,
  MessagesSquare,
  Skull,
  TerminalSquare,
  Terminal as TerminalIcon,
  Circle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { useProjects } from "@/hooks/useApi";
import { useUsage, type DailyBucket } from "@/hooks/useUsage";
import { useProcesses, useKillProcess, type ClaudeProcess } from "@/hooks/useProcesses";
import { useTerminals } from "@/hooks/useTerminals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime, formatTokens } from "@/lib/utils";

export function HomeView() {
  const { data: projects } = useProjects();
  const { data: usage } = useUsage(14);
  const { data: processes } = useProcesses();
  const { data: terminals } = useTerminals();

  const activeProcessCount = processes?.length ?? 0;
  const activeTerminalCount =
    terminals?.filter((t) => !t.exited).length ?? 0;

  const tokensThisWeek = usage
    ? sumTokens(usage.byDay.slice(-7))
    : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <TerminalIcon className="size-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">
              Claude Station
            </h1>
          </div>
          <p className="text-muted-foreground mt-2">
            A local dashboard for every Claude Code session on your machine.
          </p>
        </header>

        {/* Top stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={<Coins className="size-4" />}
            label="Total tokens"
            value={usage ? formatTokens(usage.totalTokens.total) : "—"}
            sub={usage ? `${formatTokens(tokensThisWeek)} this week` : ""}
          />
          <StatCard
            icon={<Activity className="size-4" />}
            label="Live sessions"
            value={usage?.liveSessions ?? "—"}
            sub="modified in last 60s"
            highlight={usage ? usage.liveSessions > 0 : false}
          />
          <StatCard
            icon={<Cpu className="size-4" />}
            label="Running claude"
            value={activeProcessCount}
            sub="external processes"
            highlight={activeProcessCount > 0}
          />
          <StatCard
            icon={<TerminalSquare className="size-4" />}
            label="Terminals"
            value={activeTerminalCount}
            sub="attached to app"
          />
          <StatCard
            icon={<MessagesSquare className="size-4" />}
            label="Sessions"
            value={usage?.totalSessions ?? "—"}
            sub={usage ? `${usage.totalMessages} messages` : ""}
          />
          <StatCard
            icon={<FolderOpen className="size-4" />}
            label="Projects"
            value={projects?.length ?? "—"}
          />
        </div>

        {/* Running processes panel */}
        <ProcessesPanel />

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Tokens per day (last 14 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DailyTokensChart data={usage?.byDay ?? []} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Top projects by tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TopProjectsChart
                data={usage?.byProject.slice(0, 8) ?? []}
                allProjects={projects ?? []}
              />
            </CardContent>
          </Card>
        </div>

        {/* Recent projects grid */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Jump to a project</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects?.slice(0, 12).map((p) => (
              <NavLink
                key={p.slug}
                to={`/projects/${encodeURIComponent(p.slug)}`}
                className="block rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground shrink-0 ml-2">
                    {p.sessionCount} sessions
                  </div>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-1">
                  {p.path}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {p.lastActivity ? formatRelativeTime(p.lastActivity) : "—"}
                </div>
              </NavLink>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "transition-colors",
        highlight && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ProcessesPanel() {
  const { data: processes, isLoading } = useProcesses();
  const killProcess = useKillProcess();
  const navigate = useNavigate();

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Cpu className="size-4" />
          Running claude processes
          {processes && processes.length > 0 && (
            <Badge variant="secondary">{processes.length}</Badge>
          )}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          polled every 4s
        </span>
      </CardHeader>
      <CardContent>
        {!processes || processes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No claude processes currently running.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {processes.map((p) => (
              <ProcessRow
                key={p.pid}
                process={p}
                onKill={() => killProcess.mutate(p.pid)}
                onOpen={() => {
                  if (p.projectSlug && p.sessionId) {
                    navigate(
                      `/projects/${encodeURIComponent(p.projectSlug)}/sessions/${encodeURIComponent(p.sessionId)}`
                    );
                  } else if (p.projectSlug) {
                    navigate(
                      `/projects/${encodeURIComponent(p.projectSlug)}`
                    );
                  }
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessRow({
  process: p,
  onKill,
  onOpen,
}: {
  process: ClaudeProcess;
  onKill: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Circle
        className={cn(
          "size-2 fill-current shrink-0",
          p.sessionIsLive ? "text-emerald-400" : "text-amber-400"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {p.projectName ?? "(unknown project)"}
          </span>
          <Badge variant="outline" className="text-xs font-mono">
            pid {p.pid}
          </Badge>
          {p.sessionIsLive && (
            <Badge variant="live" className="text-xs">
              live
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {p.cwd ?? "(cwd unavailable)"}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpen}
        disabled={!p.projectSlug}
      >
        View
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={() => {
          if (
            confirm(
              `Send SIGTERM to pid ${p.pid} (${p.projectName ?? "unknown"})?`
            )
          ) {
            onKill();
          }
        }}
      >
        <Skull className="size-4" />
      </Button>
    </div>
  );
}

function DailyTokensChart({ data }: { data: DailyBucket[] }) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5), // MM-DD
    total: d.tokens.total,
  }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatTokens(v)}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(value: number) => [formatTokens(value), "tokens"]}
          />
          <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopProjectsChart({
  data,
  allProjects,
}: {
  data: Array<{ slug: string; name: string; tokens: { total: number } }>;
  allProjects: Array<{ slug: string; name: string; path: string }>;
}) {
  // Prefer the name from /api/projects (which reads the true cwd) over the
  // aggregator's slug-based guess.
  const enriched = data.map((d) => {
    const canonical = allProjects.find((p) => p.slug === d.slug);
    return {
      name: canonical?.name ?? d.name,
      total: d.tokens.total,
    };
  });

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart
          data={enriched}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            horizontal={false}
          />
          <XAxis
            type="number"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatTokens(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: number) => [formatTokens(value), "tokens"]}
          />
          <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
            {enriched.map((_, i) => (
              <Cell
                key={i}
                fill={`hsl(var(--primary) / ${1 - i * 0.08})`}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function sumTokens(days: DailyBucket[]): number {
  return days.reduce((acc, d) => acc + d.tokens.total, 0);
}
