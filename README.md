# Claude Station

A local dashboard for managing every [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session on your machine. Browse projects, search transcripts, see token usage, and (coming soon) view live output, kill stuck sessions, and resume them from one place.

> **v0.3 status:** projects sidebar, sessions browser, transcript viewer, live session filter, embedded `xterm.js` terminal, external process detection + kill, and a token usage dashboard with charts are all live. Live transcript tailing and global search are on the roadmap below.

## Why

If you use Claude Code as heavily as I do, you end up with dozens of terminal windows open across many projects and no good way to answer questions like:

- Which sessions am I actually working in right now?
- Which session was I using yesterday to debug that thing?
- How many tokens am I burning per day? Per project?
- This one feels stuck — can I just kill it and restart?

Claude Station reads Claude Code's on-disk session data from `~/.claude/projects/<slug>/<uuid>.jsonl` and gives you a single pane of glass over all of it.

## Quick start

Requires **Node.js 20+**.

```bash
git clone https://github.com/<you>/claude-station
cd claude-station
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

The frontend runs on `127.0.0.1:5173` and the backend API on `127.0.0.1:5174`. Both are bound to localhost only.

## Features

### Today (v0.3)
- **Projects sidebar** — every project with a Claude Code session, sorted by recent activity
- **Sessions table** — per-project browser with titles, live/idle badge, message counts, token usage, last-activity timestamps
- **Active-only filter** — one click to hide stale sessions and see only what Claude Code is actively writing to (based on JSONL mtime in the last 60s)
- **Transcript viewer** — full rendered conversation with user/assistant messages, tool calls collapsed, markdown + code blocks
- **Embedded terminal** — `xterm.js` wired to a real PTY via `node-pty` + WebSockets. Spawn new shells or click "open in terminal" on any session to attach with `claude --resume <uuid>` already running in the right cwd
- **External process detection** — scans `ps` + `lsof` every 4s to find every running `claude` process owned by you, maps each to its project + best-guess current session, and lets you SIGTERM stuck ones from the UI
- **Token usage dashboard** — total tokens, tokens per day (14-day trend bar chart), top projects by tokens (horizontal bar chart), live session count, running-process count, embedded-terminal count, session and message totals
- **Accurate path decoding** — reads the authoritative `cwd` from each session's JSONL instead of naively splitting the slug (so `yash-desai` doesn't become `yash/desai`)
- **Token accounting** — input, output, cache-create, and cache-read tokens summed per session with an mtime-keyed cache so repeat polls are ~15ms

### Roadmap
- [ ] Live tailing of session transcripts via SSE + chokidar file watch (watch a session grow in real time)
- [ ] Global transcript search (naive grep → SQLite FTS5)
- [ ] Exact per-event daily bucketing for the usage chart (currently attributes each session's total to its last-activity day)
- [ ] Cross-platform terminal + process detection (Linux works for PTY, Windows needs testing; process scan currently returns empty on Windows)
- [ ] Optional packaging as a Tauri desktop app

## Architecture

```
claude-station/
├── server/          # Express + tsx backend (port 5174, 127.0.0.1 only)
│   └── src/
│       ├── index.ts        # API routes
│       ├── claude-data.ts  # Parses ~/.claude/projects JSONL files
│       └── types.ts
├── src/             # Vite + React frontend (port 5173)
│   ├── pages/       # HomeView, ProjectView, SessionView
│   ├── components/  # Sidebar + shadcn/ui primitives
│   ├── hooks/       # React Query API hooks
│   └── types.ts
├── tailwind.config.js
├── vite.config.ts
└── package.json     # concurrently runs both halves under `npm run dev`
```

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Sanity check |
| `GET` | `/api/projects` | List every project found in `~/.claude/projects/` |
| `GET` | `/api/projects/:slug/sessions` | List sessions for a project, with titles + token totals |
| `GET` | `/api/projects/:slug/sessions/:id` | Full parsed transcript for a session |
| `GET` | `/api/terminals` | List active embedded PTY sessions |
| `POST` | `/api/terminals` | Spawn a new PTY (optional `cwd`, `command`, `args`). Returns `{id, token}` — use the token to open the WebSocket |
| `DELETE` | `/api/terminals/:id` | SIGHUP a PTY |
| `WS` | `/ws/terminal?id=...&token=...` | Bidirectional PTY stream: `{type: 'input', data}` / `{type: 'resize', cols, rows}` client → server, `{type: 'output' \| 'scrollback' \| 'exit', ...}` server → client |
| `GET` | `/api/processes` | List every external `claude` process owned by the current user, with cwd + mapped project + best-guess current session |
| `POST` | `/api/processes/:pid/kill` | SIGTERM an external claude process. Only PIDs the scanner has already flagged as claude are accepted — the endpoint can't be used as a general-purpose kill. |
| `GET` | `/api/usage?days=14` | Aggregated token usage across every project: totals, per-project breakdown, per-day trend. Cached per-file by mtime. |

The backend reads JSONL files defensively — malformed lines are skipped, unknown event types are preserved as raw. It never writes to Claude Code's data. Embedded terminals run under your user account with full shell privileges, guarded by a random per-PTY token and a WebSocket `Origin` check.

### Stack

- **Frontend:** Vite + React 18 + TypeScript, Tailwind v3 + shadcn/ui, React Query, React Router, react-markdown, lucide-react, `@xterm/xterm` + `addon-fit` + `addon-web-links`
- **Backend:** Express + TypeScript (via tsx), `node-pty` for PTY, `ws` for WebSocket, no DB (in-memory streaming reads)
- **Dev runner:** `concurrently`, so `npm run dev` boots both halves

### node-pty `spawn-helper` fix

`node-pty`'s prebuilt `spawn-helper` binary sometimes loses its executable bit when extracted by certain npm clients, causing `posix_spawnp failed` on first spawn. A `postinstall` script (`scripts/fix-node-pty-perms.mjs`) detects this and runs `chmod +x` automatically. If you ever see that error, rerun `npm install` or `node scripts/fix-node-pty-perms.mjs`.

## Security

**This is a local tool. Do not expose it to the network.**

- The backend binds to `127.0.0.1` and the Vite proxy whitelists only `http://127.0.0.1:5173`. Do not change these unless you know exactly what you're doing.
- The backend has read access to `~/.claude` and, in future milestones, will be able to send signals to processes and spawn Terminal windows. Anyone with network access to the backend port would inherit that capability.
- There is no authentication. Localhost is the trust boundary.
- Do not port-forward this over SSH and do not run it inside a shared VM without firewalling these ports.

If you want remote access, wrap the whole thing in Tailscale or wireguard and keep the app bound to `127.0.0.1`.

## Development

```bash
npm run dev        # frontend + backend together
npm run dev:web    # just the Vite frontend
npm run dev:api    # just the Express backend
npm run typecheck  # tsc --noEmit across frontend and backend
npm run build      # production build (frontend only for now)
```

## Contributing

PRs welcome, especially for:
- Linux + Windows support for live-process detection and resume-in-terminal
- Additional Claude Code JSONL event types we don't handle yet
- Performance improvements for very large transcripts (>10k events)

## License

MIT. See [LICENSE](./LICENSE).
