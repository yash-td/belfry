import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  Coins,
  Cpu,
  FolderOpen,
  Info,
  Skull,
  TerminalSquare,
  Terminal as TerminalIcon,
  Circle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { useProjects } from "@/hooks/useApi";
import { useUsage, type DailyBucket } from "@/hooks/useUsage";
import {
  useProcesses,
  useKillProcess,
  type ClaudeProcess,
} from "@/hooks/useProcesses";
import { useTerminals, useCreateTerminal } from "@/hooks/useTerminals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime, formatTokens } from "@/lib/utils";

// Colors for the 4 token types — chosen to read well on a dark bg and to
// visually separate "real work" (output) from "replayed context" (cacheRead).
const TOKEN_COLORS = {
  output: "#4ade80", // emerald — "real work"
  input: "#60a5fa", // blue — fresh context
  cacheCreate: "#facc15", // yellow — one-time cache priming
  cacheRead: "#52525b", // zinc-600 — cheap replay, de-emphasized
} as const;

export function HomeView() {
  const { data: projects } = useProjects();
  const { data: usage } = useUsage(14);
  const { data: processes } = useProcesses();
  const { data: terminals } = useTerminals();

  const activeProcessCount = processes?.length ?? 0;
  const activeTerminalCount =
    terminals?.filter((t) => !t.exited).length ?? 0;

  const tokensThisWeek = usage ? sumDays(usage.byDay.slice(-7)) : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <TerminalIcon className="size-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Belfry</h1>
          </div>
          <p className="text-muted-foreground mt-2">
            A local dashboard for every Claude Code session on your machine.
          </p>
        </header>

        {/* Top stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={<Coins className="size-4" />}
            label="Output tokens"
            value={usage ? formatTokens(usage.totalTokens.output) : "—"}
            sub="all-time work"
          />
          <StatCard
            icon={<Coins className="size-4" />}
            label="This week output"
            value={
              usage
                ? formatTokens(
                    usage.byDay.slice(-7).reduce((a, d) => a + d.tokens.output, 0)
                  )
                : "—"
            }
            sub={
              usage
                ? `${formatTokens(tokensThisWeek)} total w/ cache`
                : ""
            }
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
            icon={<FolderOpen className="size-4" />}
            label="Projects"
            value={projects?.length ?? "—"}
            sub={
              usage ? `${usage.totalSessions} sessions total` : ""
            }
          />
        </div>

        {/* Running processes panel */}
        <ProcessesPanel />

        {/* Token breakdown explainer */}
        <TokenBreakdownCard usage={usage} />

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Tokens per day (last 14 days)
              </CardTitle>
              <p className="text-xs text-muted-foreground pt-1">
                Stacked by type. Hover for per-day breakdown.
              </p>
            </CardHeader>
            <CardContent>
              <DailyTokensChart data={usage?.byDay ?? []} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Top projects by output tokens
              </CardTitle>
              <p className="text-xs text-muted-foreground pt-1">
                Uses output tokens only — "how much work Claude actually did for you".
              </p>
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
        <ProjectsGrid projects={projects ?? []} />
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

function TokenBreakdownCard({ usage }: { usage: { totalTokens: { input: number; output: number; cacheCreate: number; cacheRead: number; total: number } } | undefined }) {
  const t = usage?.totalTokens;
  const total = t?.total ?? 0;

  const pct = (n: number): string =>
    total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Info className="size-4" />
          Token breakdown — what's actually being counted
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Claude Code reports four kinds of tokens per turn. Summing them
          looks scary, but most of the volume is{" "}
          <span className="text-foreground font-medium">cache reads</span>{" "}
          — your conversation context replayed at every step. Cache reads
          are billed at ~10% of fresh input tokens, so they are cheap and
          don't reflect "work done". The real measure of how much Claude
          wrote for you is <span className="text-foreground font-medium">output tokens</span>.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <BreakdownCell
            color={TOKEN_COLORS.output}
            label="Output"
            value={t?.output ?? 0}
            pct={pct(t?.output ?? 0)}
            desc="Tokens Claude generated. This is the honest measure of activity."
          />
          <BreakdownCell
            color={TOKEN_COLORS.input}
            label="Input"
            value={t?.input ?? 0}
            pct={pct(t?.input ?? 0)}
            desc="Fresh tokens you sent that weren't in the cache. Usually tiny."
          />
          <BreakdownCell
            color={TOKEN_COLORS.cacheCreate}
            label="Cache create"
            value={t?.cacheCreate ?? 0}
            pct={pct(t?.cacheCreate ?? 0)}
            desc="First-time context priming. Billed at ~125% of normal input. Happens at the start of each session."
          />
          <BreakdownCell
            color={TOKEN_COLORS.cacheRead}
            label="Cache read"
            value={t?.cacheRead ?? 0}
            pct={pct(t?.cacheRead ?? 0)}
            desc="Context replayed from cache. Billed at ~10% of normal input. Dominates the total but is cheap."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownCell({
  color,
  label,
  value,
  pct,
  desc,
}: {
  color: string;
  label: string;
  value: number;
  pct: string;
  desc: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="size-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="text-xs font-medium">{label}</div>
        <div className="text-xs text-muted-foreground ml-auto">{pct}</div>
      </div>
      <div className="text-lg font-semibold leading-tight">
        {formatTokens(value)}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
        {desc}
      </div>
    </div>
  );
}

function ProcessesPanel() {
  const { data: processes, isLoading } = useProcesses();

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
        <span className="text-xs text-muted-foreground">polled every 4s</span>
      </CardHeader>
      <CardContent>
        {!processes || processes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No claude processes currently running.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {processes.map((p) => (
              <ProcessRow key={p.pid} process={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessRow({ process: p }: { process: ClaudeProcess }) {
  const navigate = useNavigate();
  const killProcess = useKillProcess();
  const createTerminal = useCreateTerminal();
  const [takingOver, setTakingOver] = useState(false);

  async function handleTakeover(): Promise<void> {
    if (!p.projectPath || !p.sessionId) return;
    const ok = confirm(
      `Take over claude (pid ${p.pid}) in ${p.projectName}?\n\n` +
        `This will:\n` +
        `  1. Send SIGTERM to the external process\n` +
        `  2. Open a new embedded terminal running\n     claude --resume ${p.sessionId}\n` +
        `  3. Navigate you to that terminal\n\n` +
        `Your conversation history is preserved (it lives in the session JSONL).`
    );
    if (!ok) return;

    setTakingOver(true);
    try {
      try {
        await killProcess.mutateAsync(p.pid);
      } catch (err) {
        console.warn("kill failed, continuing anyway:", err);
      }
      // Give the kernel a moment to release file locks + let JSONL quiesce.
      await new Promise((r) => setTimeout(r, 500));
      const terminalId = await createTerminal.mutateAsync({
        cwd: p.projectPath,
        command: "claude",
        args: ["--resume", p.sessionId],
      });
      navigate(`/terminal/${terminalId}`);
    } catch (err) {
      console.error("takeover failed:", err);
      alert(`Takeover failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setTakingOver(false);
    }
  }

  function handleView(): void {
    if (p.projectSlug && p.sessionId) {
      navigate(
        `/projects/${encodeURIComponent(p.projectSlug)}/sessions/${encodeURIComponent(p.sessionId)}`
      );
    } else if (p.projectSlug) {
      navigate(`/projects/${encodeURIComponent(p.projectSlug)}`);
    }
  }

  function handleKill(): void {
    if (
      confirm(
        `Send SIGTERM to pid ${p.pid} (${p.projectName ?? "unknown"})?`
      )
    ) {
      killProcess.mutate(p.pid);
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Circle
        className={cn(
          "size-2 fill-current shrink-0",
          p.sessionIsLive ? "text-emerald-400" : "text-amber-400"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
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
          {p.startedAt && (
            <span className="text-xs text-muted-foreground">
              started {formatRelativeTime(p.startedAt)}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {p.cwd ?? "(cwd unavailable)"}
          {p.sessionId && (
            <span className="ml-2 font-mono">
              · session {p.sessionId.slice(0, 8)}
            </span>
          )}
        </div>
      </div>
      <Button
        variant="default"
        size="sm"
        onClick={handleTakeover}
        disabled={!p.projectPath || !p.sessionId || takingOver}
        title="Kill this process and reattach in an embedded terminal"
      >
        {takingOver ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            Take over
            <ArrowRight className="size-3" />
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleView}
        disabled={!p.projectSlug}
      >
        View
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={handleKill}
      >
        <Skull className="size-4" />
      </Button>
    </div>
  );
}

function DailyTokensChart({ data }: { data: DailyBucket[] }) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5), // MM-DD
    output: d.tokens.output,
    input: d.tokens.input,
    cacheCreate: d.tokens.cacheCreate,
    cacheRead: d.tokens.cacheRead,
  }));
  return (
    <div className="h-56 w-full">
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
            formatter={(value: number, name: string) => [
              formatTokens(value),
              name === "output"
                ? "Output"
                : name === "input"
                  ? "Input"
                  : name === "cacheCreate"
                    ? "Cache create"
                    : "Cache read",
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="square"
            formatter={(v) =>
              v === "output"
                ? "Output (real work)"
                : v === "input"
                  ? "Input"
                  : v === "cacheCreate"
                    ? "Cache create"
                    : "Cache read (cheap replay)"
            }
          />
          {/* Stacked: cacheRead at the bottom (usually biggest), then cacheCreate, input, output on top */}
          <Bar
            dataKey="cacheRead"
            stackId="a"
            fill={TOKEN_COLORS.cacheRead}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="cacheCreate"
            stackId="a"
            fill={TOKEN_COLORS.cacheCreate}
          />
          <Bar dataKey="input" stackId="a" fill={TOKEN_COLORS.input} />
          <Bar
            dataKey="output"
            stackId="a"
            fill={TOKEN_COLORS.output}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopProjectsChart({
  data,
  allProjects,
}: {
  data: Array<{
    slug: string;
    name: string;
    tokens: {
      input: number;
      output: number;
      cacheCreate: number;
      cacheRead: number;
      total: number;
    };
  }>;
  allProjects: Array<{ slug: string; name: string; path: string }>;
}) {
  const enriched = data
    .map((d) => {
      const canonical = allProjects.find((p) => p.slug === d.slug);
      return {
        name: canonical?.name ?? d.name,
        output: d.tokens.output,
      };
    })
    .sort((a, b) => b.output - a.output);

  return (
    <div className="h-56 w-full">
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
            width={110}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: number) => [
              formatTokens(value),
              "output tokens",
            ]}
          />
          <Bar dataKey="output" radius={[0, 4, 4, 0]}>
            {enriched.map((_, i) => (
              <Cell key={i} fill={TOKEN_COLORS.output} fillOpacity={1 - i * 0.08} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProjectsGrid({
  projects,
}: {
  projects: Array<{
    slug: string;
    name: string;
    path: string;
    sessionCount: number;
    lastActivity: string | null;
  }>;
}) {
  const [showAll, setShowAll] = useState(false);
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = projects.filter(
    (p) => p.lastActivity && Date.parse(p.lastActivity) > recentThreshold
  );
  const older = projects.filter(
    (p) => !p.lastActivity || Date.parse(p.lastActivity) <= recentThreshold
  );
  const visible = showAll ? projects : recent;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">
          Jump to a project
          <span className="text-sm text-muted-foreground font-normal ml-2">
            {showAll
              ? `all ${projects.length}`
              : `${recent.length} active in last 7 days`}
          </span>
        </h2>
        {older.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show recent only" : `Show ${older.length} older`}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((p) => (
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
  );
}

function sumDays(days: DailyBucket[]): number {
  return days.reduce((acc, d) => acc + d.tokens.total, 0);
}
