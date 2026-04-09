# Claude Station

A local dashboard for managing every [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session on your machine. Browse projects, search transcripts, see token usage, and (coming soon) view live output, kill stuck sessions, and resume them from one place.

> **v0.1 status:** projects sidebar, sessions browser, and transcript viewer are live. Live tailing, process management, resume-in-terminal, and global search are on the roadmap below.

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

### Today (v0.1)
- **Projects sidebar** — every project with a Claude Code session, sorted by recent activity
- **Sessions table** — per-project browser with titles (pulled from your first message), message counts, token usage, and last-activity timestamps
- **Transcript viewer** — full rendered conversation with user/assistant messages, tool calls collapsed, markdown + code blocks
- **Accurate path decoding** — reads the authoritative `cwd` from each session's JSONL instead of naively splitting the slug (so `yash-desai` doesn't become `yash/desai`)
- **Token accounting** — input, output, cache-create, and cache-read tokens summed per session

### Roadmap
- [ ] Live tailing of sessions via SSE + chokidar file watch
- [ ] Running-process panel (via `ps` + `lsof` cwd detection) with kill buttons
- [ ] Resume-in-terminal button (spawns a new Terminal/iTerm window running `claude --resume <uuid>` in the project cwd)
- [ ] Global transcript search (naive grep → SQLite FTS5)
- [ ] Token usage dashboard with per-day / per-project charts
- [ ] Cross-platform terminal resume (Linux, Windows)
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

The backend reads JSONL files defensively — malformed lines are skipped, unknown event types are preserved as raw. It never writes to Claude Code's data.

### Stack

- **Frontend:** Vite + React 18 + TypeScript, Tailwind v3 + shadcn/ui, React Query, React Router, react-markdown, lucide-react
- **Backend:** Express + TypeScript (via tsx), no DB (in-memory streaming reads)
- **Dev runner:** `concurrently`, so `npm run dev` boots both halves

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
