import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, User, Bot, Wrench, Settings2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranscript } from "@/hooks/useApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatTokens } from "@/lib/utils";
import type { TranscriptEvent } from "@/types";

export function SessionView() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const { data, isLoading, error } = useTranscript(slug ?? null, id ?? null);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link to={`/projects/${encodeURIComponent(slug ?? "")}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted-foreground font-mono truncate">
            {id}
          </div>
          {data && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <span>{data.totalEvents} events</span>
              <span>·</span>
              <span>{formatTokens(data.tokens.total)} tokens total</span>
              <span>·</span>
              <span>in {formatTokens(data.tokens.input)}</span>
              <span>·</span>
              <span>out {formatTokens(data.tokens.output)}</span>
              {data.tokens.cacheRead > 0 && (
                <>
                  <span>·</span>
                  <span>cache read {formatTokens(data.tokens.cacheRead)}</span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading transcript…
          </div>
        )}
        {error && (
          <div className="p-6 text-destructive">
            Failed to load transcript: {(error as Error).message}
          </div>
        )}
        {data && (
          <div className="max-w-4xl mx-auto p-6 space-y-4">
            {data.events.map((e) => (
              <EventRow key={e.index} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: TranscriptEvent }) {
  const role = event.role ?? event.type;
  const icon =
    role === "user" ? (
      <User className="size-4" />
    ) : role === "assistant" ? (
      <Bot className="size-4" />
    ) : role === "system" ? (
      <Settings2 className="size-4" />
    ) : (
      <Wrench className="size-4" />
    );

  const isSystem = role === "system" || !event.role;
  const isUser = role === "user";

  // Tool-use-only events (no text) get collapsed into a compact badge so the
  // transcript stays readable.
  if (!event.text && event.toolName) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-10">
        <Wrench className="size-3" />
        <span>tool: </span>
        <Badge variant="outline" className="font-mono">
          {event.toolName}
        </Badge>
      </div>
    );
  }

  if (!event.text) return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isUser
          ? "border-primary/30 bg-primary/5"
          : isSystem
            ? "border-border bg-muted/30 text-muted-foreground"
            : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wider font-medium">{role}</span>
        {event.toolName && (
          <Badge variant="outline" className="font-mono">
            {event.toolName}
          </Badge>
        )}
      </div>
      <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-foreground">
        <ReactMarkdown>{event.text}</ReactMarkdown>
      </div>
    </div>
  );
}
